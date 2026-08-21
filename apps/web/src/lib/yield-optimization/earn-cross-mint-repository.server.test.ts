import { afterAll, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

mock.module("server-only", () => ({}));

const databaseUrl = process.env.YIELD_OPTIMIZATION_LOCAL_DATABASE_URL?.trim();
const isDisposableDatabase = (() => {
  if (!databaseUrl) {
    return false;
  }
  const url = new URL(databaseUrl);
  return (
    ["127.0.0.1", "::1", "localhost"].includes(url.hostname) &&
    url.pathname.slice(1).startsWith("loyal_autoswap_api_verify_")
  );
})();

if (databaseUrl && !isDisposableDatabase) {
  throw new Error(
    "Autoswap repository tests only run against a localhost loyal_autoswap_api_verify_* database."
  );
}
if (isDisposableDatabase) {
  process.env.NEON_DATABASE_URL = "postgresql://unused";
}

const repository = await import("./earn-cross-mint-repository.server");
const database = databaseUrl ? postgres(databaseUrl, { max: 4 }) : null;

afterAll(async () => {
  await database?.end({ timeout: 5 });
});

describe("Autoswap enrollment transition authority", () => {
  test.skipIf(!isDisposableDatabase)(
    "reads projected policy state for a nullable opt-in and classifies transitions",
    async () => {
      if (!database) {
        throw new Error("Disposable database was not configured.");
      }
      const suffix = randomUUID();
      const scope = {
        authority: `transition-authority-${suffix}`,
        cluster: "mainnet-beta",
        settings: `transition-settings-${suffix}`,
        vaultIndex: 1,
        vaultPubkey: `transition-vault-${suffix}`,
      };
      const policies = [
        {
          account: `classic-policy-${suffix}`,
          seed: BigInt(101),
          sourceShard: "classic",
        },
        {
          account: `token-2022-policy-${suffix}`,
          seed: BigInt(202),
          sourceShard: "token_2022",
        },
      ] as const;

      try {
        await database`
          insert into loyal_yield.cross_mint_vault_opt_ins (
            cluster,
            settings,
            vault_index,
            vault_pubkey,
            enabled,
            generation
          ) values (
            ${scope.cluster},
            ${scope.settings},
            ${scope.vaultIndex},
            ${scope.vaultPubkey},
            true,
            10
          )
        `;
        for (const policy of policies) {
          await database`
            insert into loyal_yield.cross_mint_swap_policies (
              cluster,
              settings,
              authority,
              policy_seed,
              policy_account,
              vault_index,
              vault_pubkey,
              delegated_signer,
              source_shard,
              max_slippage_bps,
              daily_source_mint_spending_cap,
              manifest_fingerprint,
              active,
              start_eligible,
              last_mutation,
              source_commitment,
              last_seen_slot,
              last_seen_signature
            ) values (
              ${scope.cluster},
              ${scope.settings},
              ${scope.authority},
              ${policy.seed.toString()},
              ${policy.account},
              ${scope.vaultIndex},
              ${scope.vaultPubkey},
              'transition-signer',
              ${policy.sourceShard},
              50,
              100000000,
              'transition-test',
              true,
              true,
              'create',
              'finalized',
              100,
              ${`transition-signature-${policy.sourceShard}`}
            )
          `;
        }

        const initial = await repository.findEarnCrossMintState(scope);
        expect(initial).toMatchObject({
          boundPolicies: [
            {
              account: policies[0].account,
              seed: policies[0].seed.toString(),
              sourceShard: "classic",
            },
            {
              account: policies[1].account,
              seed: policies[1].seed.toString(),
              sourceShard: "token_2022",
            },
          ],
          dailySourceMintSpendingCap: "100000000",
          enabled: true,
          generation: "10",
          maxSlippageBps: 50,
          status: "on",
        });

        const concurrent = await Promise.all([
          repository.setEarnCrossMintEnabled({
            ...scope,
            enabled: false,
            expectedGeneration: BigInt(10),
          }),
          repository.setEarnCrossMintEnabled({
            ...scope,
            enabled: false,
            expectedGeneration: BigInt(10),
          }),
        ]);
        expect(concurrent.map((result) => result.kind).sort()).toEqual([
          "applied",
          "idempotent",
        ]);
        expect(
          concurrent.every(
            (result) =>
              result.enrollment?.enabled === false &&
              result.enrollment.generation === "11"
          )
        ).toBe(true);

        const exactRetry = await repository.setEarnCrossMintEnabled({
          ...scope,
          enabled: false,
          expectedGeneration: BigInt(10),
        });
        expect(exactRetry.kind).toBe("idempotent");
        expect(exactRetry.enrollment?.generation).toBe("11");

        const stale = await repository.setEarnCrossMintEnabled({
          ...scope,
          enabled: true,
          expectedGeneration: BigInt(9),
        });
        expect(stale.kind).toBe("stale");
        expect(stale.enrollment?.generation).toBe("11");

        const resume = await repository.setEarnCrossMintEnabled({
          ...scope,
          enabled: true,
          expectedGeneration: BigInt(11),
        });
        expect(resume.kind).toBe("applied");
        expect(resume.enrollment?.generation).toBe("12");

        const abaStale = await repository.setEarnCrossMintEnabled({
          ...scope,
          enabled: false,
          expectedGeneration: BigInt(10),
        });
        expect(abaStale.kind).toBe("stale");
        expect(abaStale.enrollment?.generation).toBe("12");

        await database`
          delete from loyal_yield.cross_mint_vault_opt_ins
          where cluster = ${scope.cluster}
            and settings = ${scope.settings}
            and vault_index = ${scope.vaultIndex}
            and vault_pubkey = ${scope.vaultPubkey}
        `;
        const missing = await repository.setEarnCrossMintEnabled({
          ...scope,
          enabled: false,
          expectedGeneration: BigInt(12),
        });
        expect(missing).toEqual({ enrollment: null, kind: "missing" });
      } finally {
        await database`
          delete from loyal_yield.cross_mint_swap_policies
          where cluster = ${scope.cluster}
            and policy_account in ${database(
              policies.map((policy) => policy.account)
            )}
        `;
        await database`
          delete from loyal_yield.cross_mint_vault_opt_ins
          where cluster = ${scope.cluster}
            and settings = ${scope.settings}
            and vault_index = ${scope.vaultIndex}
            and vault_pubkey = ${scope.vaultPubkey}
        `;
      }
    }
  );
});
