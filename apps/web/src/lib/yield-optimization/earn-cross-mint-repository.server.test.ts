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
    "classifies concurrent, retried, stale, ABA-stale, and missing transitions",
    async () => {
      if (!database) {
        throw new Error("Disposable database was not configured.");
      }
      const suffix = randomUUID();
      const scope = {
        cluster: "mainnet-beta",
        settings: `transition-settings-${suffix}`,
        vaultIndex: 1,
        vaultPubkey: `transition-vault-${suffix}`,
      };

      try {
        await database`
          insert into loyal_yield.cross_mint_vault_opt_ins (
            cluster,
            settings,
            vault_index,
            vault_pubkey,
            enabled,
            classic_policy_account,
            classic_policy_seed,
            token_2022_policy_account,
            token_2022_policy_seed,
            max_slippage_bps,
            daily_source_mint_spending_cap,
            generation
          ) values (
            ${scope.cluster},
            ${scope.settings},
            ${scope.vaultIndex},
            ${scope.vaultPubkey},
            true,
            'classic-policy',
            101,
            'token-2022-policy',
            202,
            50,
            100000000,
            10
          )
        `;

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
