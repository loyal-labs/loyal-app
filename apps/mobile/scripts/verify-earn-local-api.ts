import {
  appendFileSync,
  closeSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { userInfo } from "node:os";

import {
  getKaminoUsdcEarnTargetForCluster,
  LoyalCluster,
} from "@loyal-labs/actions";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import postgres from "postgres";

type LocalState = {
  collateralMint: string;
  market: string;
  marketAuthority: string;
  obligation: string;
  policyAccount: string;
  policySeed: string;
  reserve: string;
  reserveLiquiditySupply: string;
  settingsPda: string;
  setupPolicyAccount: string;
  setupPolicySeed: string;
  usdcMint: string;
  vaultCollateralAta: string;
  vaultPubkey: string;
  walletAddress: string;
};

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((pairs, value, index, all) => {
    if (index % 2 === 0)
      pairs.push([value.replace(/^--/, ""), all[index + 1]!]);
    return pairs;
  }, [])
) as Record<string, string>;

for (const key of ["state", "rpc-url", "transactions", "port", "amount-raw"]) {
  if (!args[key]) throw new Error(`Missing --${key}.`);
}

const state = JSON.parse(readFileSync(args.state!, "utf8")) as LocalState;
const connection = new Connection(args["rpc-url"]!, "confirmed");
const policySigner = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;
const useRealLoyalApi = process.env.MOBILE_EARN_REAL_API === "1";
const realApiPort = Number(args.port) + 1;
const realApiLogPath =
  process.env.MOBILE_EARN_REAL_API_LOG ??
  "/tmp/loyal-earn-real-api-last-run.log";
let realApiProcess: ReturnType<typeof Bun.spawn> | null = null;
const programId = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";
const KAMINO_FARMS_PROGRAM = new PublicKey(
  "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"
);
const KAMINO_DEPOSIT_DISCRIMINATOR = Buffer.from([
  216, 224, 191, 27, 204, 151, 102, 175,
]);
const KAMINO_WITHDRAW_DISCRIMINATOR = Buffer.from([
  235, 52, 119, 152, 149, 197, 20, 7,
]);
let amountRaw = args["amount-raw"]!;

async function prepareRealLoyalApi(): Promise<void> {
  if (!useRealLoyalApi) return;

  const mobileRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const webRoot = resolve(mobileRoot, "../web");
  const databaseUrl =
    process.env.MOBILE_EARN_REAL_API_DATABASE_URL ??
    `postgresql://${encodeURIComponent(
      userInfo().username
    )}@127.0.0.1:8959/ask_2212_client_earn_local_e2e`;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.file(
      resolve(
        webRoot,
        "src/lib/yield-optimization/migrations/0008_add_managed_vault_setup_policy.sql"
      )
    );
    await sql.file(
      resolve(
        webRoot,
        "src/lib/yield-optimization/migrations/0010_add_idle_vault_balances_and_reconcile_cache.sql"
      )
    );
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await sql`
      CREATE TABLE IF NOT EXISTS app_users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider text NOT NULL,
        subject_address text NOT NULL,
        grid_user_id text,
        smart_account_address text,
        smart_account_settings_pda text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT app_users_provider_subject_uidx UNIQUE (provider, subject_address)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS app_user_wallets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        wallet_address text NOT NULL UNIQUE,
        verified_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS app_user_smart_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        solana_env text NOT NULL,
        settings_pda text NOT NULL,
        state text NOT NULL,
        creation_signature text,
        last_checked_at timestamptz,
        last_error_code text,
        last_error_message text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT app_user_smart_accounts_user_env_uidx UNIQUE (user_id, solana_env),
        CONSTRAINT app_user_smart_accounts_env_settings_uidx UNIQUE (solana_env, settings_pda)
      )
    `;
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO app_users (
        provider,
        subject_address,
        smart_account_address,
        smart_account_settings_pda
      ) VALUES (
        'solana',
        ${state.walletAddress},
        ${state.vaultPubkey},
        ${state.settingsPda}
      )
      ON CONFLICT (provider, subject_address) DO UPDATE SET
        smart_account_address = EXCLUDED.smart_account_address,
        smart_account_settings_pda = EXCLUDED.smart_account_settings_pda,
        updated_at = now()
      RETURNING id
    `;
    if (!user) throw new Error("Failed to seed the isolated app user.");
    await sql`
      INSERT INTO app_user_wallets (user_id, wallet_address)
      VALUES (${user.id}, ${state.walletAddress})
      ON CONFLICT (wallet_address) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        last_used_at = now(),
        updated_at = now()
    `;
    await sql`
      INSERT INTO app_user_smart_accounts (
        user_id,
        solana_env,
        settings_pda,
        state
      ) VALUES (
        ${user.id},
        'mainnet',
        ${state.settingsPda},
        'ready'
      )
      ON CONFLICT (user_id, solana_env) DO UPDATE SET
        settings_pda = EXCLUDED.settings_pda,
        state = EXCLUDED.state,
        updated_at = now()
    `;
  } finally {
    await sql.end();
  }

  writeFileSync(realApiLogPath, "", { mode: 0o600 });
  const realApiLog = openSync(realApiLogPath, "a");
  realApiProcess = Bun.spawn(
    ["bun", "x", "next", "dev", "--turbopack", "-p", String(realApiPort)],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        APP_LOCAL_DATABASE_URL: databaseUrl,
        DATABASE_URL: databaseUrl,
        EARN_YIELD_ROUTER_PUBLIC_KEY: policySigner.toBase58(),
        NEON_DATABASE_URL: databaseUrl,
        NEXT_PUBLIC_APP_ENVIRONMENT: "local",
        NEXT_PUBLIC_SOLANA_ENV: "mainnet",
        NODE_ENV: "development",
        PHALA_API_KEY: "isolated-mobile-e2e",
        SOLANA_MAINNET_RPC_URL: args["rpc-url"]!,
        SOLANA_MAINNET_WEBSOCKET_URL: args["rpc-url"]!.replace(
          /^http:/,
          "ws:"
        ).replace(/:\d+$/, (port) => `:${Number(port.slice(1)) + 1}`),
        YIELD_OPTIMIZATION_LOCAL_DATABASE_URL: databaseUrl,
      },
      stderr: realApiLog,
      stdout: realApiLog,
    }
  );
  closeSync(realApiLog);

  const readinessUrl = `http://127.0.0.1:${realApiPort}/api/smart-accounts/mobile/earn/state?walletAddress=${encodeURIComponent(
    state.walletAddress
  )}`;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (realApiProcess.exitCode !== null) {
      throw new Error(
        `The real loyal-app API exited with ${realApiProcess.exitCode}. See ${realApiLogPath}.`
      );
    }
    const response = await fetch(readinessUrl).catch(() => null);
    if (response?.ok) {
      console.info(`REAL_API_READY http://127.0.0.1:${realApiPort}`);
      return;
    }
    await Bun.sleep(500);
  }
  throw new Error(
    `The real loyal-app API did not become ready. See ${realApiLogPath}.`
  );
}

async function stopRealLoyalApi(
  child: ReturnType<typeof Bun.spawn> | null
): Promise<void> {
  if (!child) return;
  child.kill();
  await child.exited;
}

function decimalAmountToRaw(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  return (
    BigInt(whole || "0") * BigInt(1_000_000) +
    BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0")
  );
}

function encodedAmount(discriminator: Buffer, raw: bigint): string {
  const data = Buffer.alloc(16);
  discriminator.copy(data);
  data.writeBigUInt64LE(raw, 8);
  return data.toString("base64");
}

function kaminoInstructions(deposit: boolean, raw: bigint) {
  const lendProgramId = getKaminoUsdcEarnTargetForCluster(
    LoyalCluster.MainnetBeta
  ).lendProgramId.toBase58();
  const vaultUsdcAta = getAssociatedTokenAddressSync(
    new PublicKey(state.usdcMint),
    new PublicKey(state.vaultPubkey),
    true,
    TOKEN_PROGRAM_ID
  ).toBase58();
  const ro = (address: string) => ({ address, role: "READONLY" });
  const rw = (address: string) => ({ address, role: "WRITABLE" });
  const signer = (address: string) => ({
    address,
    role: "WRITABLE_SIGNER",
  });
  const common = [
    signer(state.vaultPubkey),
    rw(state.obligation),
    ro(state.market),
    ro(state.marketAuthority),
    rw(state.reserve),
    ro(state.usdcMint),
  ];
  const accounts = deposit
    ? [
        ...common,
        rw(state.reserveLiquiditySupply),
        rw(state.collateralMint),
        rw(state.vaultCollateralAta),
        rw(vaultUsdcAta),
      ]
    : [
        ...common,
        rw(state.vaultCollateralAta),
        rw(state.collateralMint),
        rw(state.reserveLiquiditySupply),
        rw(vaultUsdcAta),
      ];
  accounts.push(
    ro(lendProgramId),
    ro(TOKEN_PROGRAM_ID.toBase58()),
    ro(TOKEN_PROGRAM_ID.toBase58()),
    ro("Sysvar1nstructions1111111111111111111111111"),
    ro(lendProgramId),
    ro(lendProgramId),
    ro(KAMINO_FARMS_PROGRAM.toBase58())
  );
  return {
    instructions: [
      {
        accounts,
        data: encodedAmount(
          deposit
            ? KAMINO_DEPOSIT_DISCRIMINATOR
            : KAMINO_WITHDRAW_DISCRIMINATOR,
          raw
        ),
        programAddress: lendProgramId,
      },
    ],
  };
}

async function assertConfirmed(signature: string): Promise<number> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];
    if (status?.err) {
      throw new Error(
        `Signature ${signature} failed: ${JSON.stringify(status.err)}.`
      );
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      const transaction = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction) {
        throw new Error(`Confirmed transaction ${signature} is absent.`);
      }
      return transaction.slot;
    }
    await Bun.sleep(10);
  }
  throw new Error(`Signature ${signature} was not confirmed in time.`);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function forwardToRealLoyalApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestBody =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  const response = await fetch(
    new URL(`${url.pathname}${url.search}`, `http://127.0.0.1:${realApiPort}`),
    {
      body: requestBody,
      headers,
      method: request.method,
      redirect: "manual",
    }
  );

  if (
    response.ok &&
    request.method === "POST" &&
    url.pathname.endsWith("/withdraw/confirm") &&
    requestBody
  ) {
    const body = JSON.parse(new TextDecoder().decode(requestBody)) as {
      withdrawalSignature?: string;
    };
    if (body.withdrawalSignature) {
      const slot = await assertConfirmed(body.withdrawalSignature);
      appendFileSync(
        args.transactions!,
        `${JSON.stringify({
          signature: body.withdrawalSignature,
          slot,
          stage: "full_withdrawal",
        })}\n`
      );
      amountRaw = "0";
    }
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");
  responseHeaders.set("x-loyal-e2e-api", "real-loyal-app");
  return new Response(response.body, {
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  });
}

function positionResponse() {
  return {
    position: {
      currentAmountRaw: amountRaw,
      currentSupplyApyBps: "300",
      principalAmountRaw: amountRaw,
      status: amountRaw === "0" ? "withdrawn" : "active",
    },
    settingsPda: state.settingsPda,
    smartAccountAddress: state.vaultPubkey,
  };
}

function holding() {
  return {
    amountRaw,
    kind: "kamino",
    label: "Kamino USDC",
    liquidityMint: state.usdcMint,
    market: state.market,
    marketName: "Kamino",
    reserve: state.reserve,
  };
}

const realLoyalApiReady = prepareRealLoyalApi();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(args.port),
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (
        request.method === "POST" &&
        (path.endsWith("/klend/deposit-instructions") ||
          path.endsWith("/klend/withdraw-instructions"))
      ) {
        const body = (await request.json()) as {
          amount?: string;
          wallet?: string;
        };
        if (!body.amount || body.wallet !== state.vaultPubkey) {
          return json(
            { error: { code: "invalid_kamino_fixture_request" } },
            400
          );
        }
        return json(
          kaminoInstructions(
            path.endsWith("/deposit-instructions"),
            decimalAmountToRaw(body.amount)
          )
        );
      }
      if (
        useRealLoyalApi &&
        path.startsWith("/api/smart-accounts/mobile/earn/")
      ) {
        await realLoyalApiReady;
        return forwardToRealLoyalApi(request);
      }
      if (request.method === "GET" && path.endsWith("/earn/state")) {
        return json(positionResponse());
      }
      if (request.method === "GET" && path.endsWith("/earn/holdings")) {
        const slot = await connection.getSlot("confirmed");
        return json({
          currentTotalAmountRaw: amountRaw,
          holdings: amountRaw === "0" ? [] : [holding()],
          observedAt: new Date().toISOString(),
          observedSlot: String(slot),
          settingsPda: state.settingsPda,
          smartAccountAddress: state.vaultPubkey,
        });
      }
      if (request.method === "GET" && path.endsWith("/withdraw/sources")) {
        return json({
          sources:
            amountRaw === "0"
              ? []
              : [
                  {
                    ...holding(),
                    id: state.reserve,
                    sourceId: `reserve:${state.reserve}`,
                    tokenAccount: null,
                    type: "reserve",
                  },
                ],
          settingsPda: state.settingsPda,
          smartAccountAddress: state.vaultPubkey,
        });
      }
      if (request.method === "GET" && path.endsWith("/autodeposit/state")) {
        return json({
          autodeposit: null,
          prepareContext: {
            cluster: "mainnet-beta",
            policySigner: policySigner.toBase58(),
            programId,
          },
          settingsPda: state.settingsPda,
          smartAccountAddress: state.vaultPubkey,
        });
      }
      if (request.method === "GET" && path.endsWith("/earn-forecast/summary")) {
        const now = new Date().toISOString();
        return json({
          forecast: {
            apyBps: 300,
            rangeHighBps: 300,
            rangeLowBps: 300,
            window: { startedAt: now, endedAt: now },
          },
          history: { samples: [] },
        });
      }
      if (
        request.method === "POST" &&
        path.endsWith("/withdraw/prepare-context")
      ) {
        return json({
          cluster: "mainnet-beta",
          programId,
          settingsPda: state.settingsPda,
          smartAccountAddress: state.vaultPubkey,
          withdrawInput: {
            amountRaw,
            mode: "full",
            closePoliciesOnFullWithdrawal: false,
            policySigner: policySigner.toBase58(),
            source: {
              type: "reserve",
              id: state.reserve,
              amountRaw,
              liquidityMint: state.usdcMint,
              market: state.market,
              reserve: state.reserve,
            },
            target: {
              reserve: state.reserve,
              market: state.market,
              liquidityMint: state.usdcMint,
              supplyApyBps: "300",
            },
            fullWithdrawalTargets: [
              {
                amountRaw,
                liquidityMint: state.usdcMint,
                market: state.market,
                reserve: state.reserve,
                reserveCollateralMint: state.collateralMint,
                reserveLiquiditySupply: state.reserveLiquiditySupply,
                supplyApyBps: "300",
                vaultCollateralAta: state.vaultCollateralAta,
              },
            ],
            yieldRoutingPolicy: {
              account: state.policyAccount,
              seed: state.policySeed,
              setupPolicy: {
                account: state.setupPolicyAccount,
                seed: state.setupPolicySeed,
              },
            },
            autodepositClose: null,
          },
        });
      }
      if (request.method === "POST" && path.endsWith("/withdraw/confirm")) {
        const body = (await request.json()) as { withdrawalSignature?: string };
        if (!body.withdrawalSignature)
          return json({ error: { code: "invalid_request" } }, 400);
        const slot = await assertFinalized(body.withdrawalSignature);
        appendFileSync(
          args.transactions!,
          `${JSON.stringify({
            signature: body.withdrawalSignature,
            slot,
            stage: "full_withdrawal",
          })}\n`
        );
        amountRaw = "0";
        return json({
          ok: true,
          status: "full_exit_verified",
          position: positionResponse().position,
        });
      }
      if (
        request.method === "POST" &&
        path.endsWith("/cleanup/prepare-context")
      ) {
        if (amountRaw !== "0")
          return json({ error: { code: "full_exit_incomplete" } }, 409);
        const vaultUsdcAta = getAssociatedTokenAddressSync(
          new PublicKey(state.usdcMint),
          new PublicKey(state.vaultPubkey),
          true,
          TOKEN_PROGRAM_ID
        );
        return json({
          cluster: "mainnet-beta",
          programId,
          settingsPda: state.settingsPda,
          cleanupInput: {
            policySigner: policySigner.toBase58(),
            vaultTokenAccounts: [
              {
                address: state.vaultCollateralAta,
                amountRaw: "0",
                decimals: 6,
                mint: state.collateralMint,
                tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
              },
              {
                address: vaultUsdcAta.toBase58(),
                amountRaw: "0",
                decimals: 6,
                mint: state.usdcMint,
                tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
              },
            ],
            yieldRoutingPolicy: {
              account: state.policyAccount,
              seed: state.policySeed,
              setupPolicy: {
                account: state.setupPolicyAccount,
                seed: state.setupPolicySeed,
              },
            },
          },
        });
      }
      if (request.method === "POST" && path.endsWith("/cleanup/confirm")) {
        const body = (await request.json()) as { cleanupSignature?: string };
        if (!body.cleanupSignature)
          return json({ error: { code: "invalid_request" } }, 400);
        await assertConfirmed(body.cleanupSignature);
        const accounts = await connection.getMultipleAccountsInfo(
          [state.policyAccount, state.setupPolicyAccount].map(
            (value) => new PublicKey(value)
          ),
          "confirmed"
        );
        if (accounts.some(Boolean)) {
          return json(
            {
              error: {
                code: "cleanup_not_confirmed",
                message: "Policy remains open.",
              },
            },
            409
          );
        }
        return json({ ok: true, status: "full_exit_closed" });
      }
      if (request.method === "GET" && path.includes("/earn/earnings")) {
        return json({ bars: [], summary: null });
      }
      return json(
        { error: { code: "isolated_fixture_route_missing", path } },
        404
      );
    } catch (error) {
      return json(
        {
          error: {
            code: "isolated_fixture_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        500
      );
    }
  },
});

console.info(`READY http://${server.hostname}:${server.port}`);
await realLoyalApiReady;
await new Promise<void>((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});
server.stop(true);
await stopRealLoyalApi(realApiProcess);
