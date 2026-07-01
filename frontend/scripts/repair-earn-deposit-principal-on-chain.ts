import { mock } from "bun:test";

import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { sql } from "drizzle-orm";
import {
  Connection,
  type ParsedTransactionWithMeta,
  type TokenBalance,
} from "@solana/web3.js";

mock.module("server-only", () => ({}));

type DepositRow = {
  confirmed_slot: string | number | bigint;
  deposit_mint: string;
  deposit_signature: string;
  id: string | number | bigint;
  principal_amount_raw: string | number | bigint;
  smart_account_address: string;
  vault_pubkey: string;
  wallet_address: string;
};

type PrincipalMismatch = {
  actualConfirmedSlot: bigint;
  actualPrincipalRaw: bigint;
  depositId: bigint;
  storedConfirmedSlot: bigint;
  signature: string;
  storedPrincipalRaw: bigint;
  walletAddress: string;
};

function parseSolanaEnvArg(): Extract<SolanaEnv, "devnet" | "mainnet"> | null {
  const envArg = process.argv.find((arg) => arg.startsWith("--solana-env="));
  if (!envArg) {
    return null;
  }

  const value = envArg.slice("--solana-env=".length);
  if (value === "devnet" || value === "mainnet") {
    return value;
  }

  throw new Error("--solana-env must be mainnet or devnet.");
}

function toBigInt(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function readTokenBalanceAmountRaw(balance: TokenBalance | undefined): bigint {
  const amount = balance?.uiTokenAmount.amount;
  return typeof amount === "string" && /^\d+$/.test(amount)
    ? BigInt(amount)
    : BigInt(0);
}

function getExecuteRows(result: unknown): Record<string, unknown>[] {
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }

  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }

  return [];
}

function getTokenBalanceDeltasByOwner(args: {
  mint: string;
  transaction: ParsedTransactionWithMeta;
}): Map<string, bigint> {
  const preBalances = args.transaction.meta?.preTokenBalances ?? [];
  const postBalances = args.transaction.meta?.postTokenBalances ?? [];
  const indexes = new Set<number>();

  for (const balance of [...preBalances, ...postBalances]) {
    if (balance.mint === args.mint) {
      indexes.add(balance.accountIndex);
    }
  }

  const deltasByOwner = new Map<string, bigint>();
  for (const accountIndex of indexes) {
    const pre = preBalances.find(
      (balance) =>
        balance.accountIndex === accountIndex && balance.mint === args.mint
    );
    const post = postBalances.find(
      (balance) =>
        balance.accountIndex === accountIndex && balance.mint === args.mint
    );
    const owner = post?.owner ?? pre?.owner ?? null;

    if (!owner) {
      continue;
    }

    deltasByOwner.set(
      owner,
      (deltasByOwner.get(owner) ?? BigInt(0)) +
        readTokenBalanceAmountRaw(post) -
        readTokenBalanceAmountRaw(pre)
    );
  }

  return deltasByOwner;
}

const applyRepair = process.argv.includes("--apply");
if (
  applyRepair &&
  process.env.CONFIRM_EARN_DEPOSIT_PRINCIPAL_REPAIR !== "1"
) {
  throw new Error(
    "Set CONFIRM_EARN_DEPOSIT_PRINCIPAL_REPAIR=1 with --apply to write repairs."
  );
}

const { resolveLoyalWebSolanaEnvFromEnv } = await import(
  "@/lib/core/config/solana-env-override"
);
const { getFrontendSolanaEndpoints } = await import(
  "@/lib/solana/rpc-endpoints"
);
const { getFrontendSolanaRpcFetch } = await import(
  "@/lib/solana/rpc-rate-limit"
);
const { getYieldOptimizationClient } = await import(
  "@/lib/yield-optimization/yield-neon-client.server"
);

const solanaEnv: SolanaEnv =
  parseSolanaEnvArg() ?? resolveLoyalWebSolanaEnvFromEnv(process.env);
const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
const envPrefix = solanaEnv.toUpperCase();
const frontendEndpoints = getFrontendSolanaEndpoints(solanaEnv);
const rpcEndpoint =
  process.env[`SOLANA_${envPrefix}_RPC_URL`]?.trim() ||
  frontendEndpoints.rpcEndpoint;
const websocketEndpoint =
  process.env[`SOLANA_${envPrefix}_WEBSOCKET_URL`]?.trim() ||
  frontendEndpoints.websocketEndpoint;
const connection = new Connection(rpcEndpoint, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
  wsEndpoint: websocketEndpoint,
});
const client = getYieldOptimizationClient();
const queryResult = await client.db.execute(sql`
  SELECT
    id::text,
    deposit_signature,
    confirmed_slot::text,
    wallet_address,
    smart_account_address,
    vault_pubkey,
    deposit_mint,
    principal_amount_raw::text
  FROM loyal_yield.user_yield_position_deposits
  ORDER BY confirmed_at ASC, id ASC
`);
const deposits = getExecuteRows(queryResult) as DepositRow[];
const mismatches: PrincipalMismatch[] = [];

for (const deposit of deposits) {
  const transaction = await connection.getParsedTransaction(
    deposit.deposit_signature,
    {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    }
  );

  if (!transaction || !transaction.meta || transaction.meta.err) {
    throw new Error(
      `Cannot repair deposit ${toBigInt(deposit.id).toString()}: transaction proof is unavailable.`
    );
  }

  const actualConfirmedSlot = BigInt(transaction.slot);
  const storedConfirmedSlot = toBigInt(deposit.confirmed_slot);

  const deltasByOwner = getTokenBalanceDeltasByOwner({
    mint: deposit.deposit_mint,
    transaction,
  });
  const acceptedOwners = [
    ...new Set([
      deposit.wallet_address,
      deposit.smart_account_address,
      deposit.vault_pubkey,
    ]),
  ];
  const actualPrincipalRaw = acceptedOwners.reduce((total, owner) => {
    const deltaRaw = deltasByOwner.get(owner) ?? BigInt(0);
    return deltaRaw < BigInt(0) ? total - deltaRaw : total;
  }, BigInt(0));
  const storedPrincipalRaw = toBigInt(deposit.principal_amount_raw);

  if (actualPrincipalRaw <= BigInt(0)) {
    throw new Error(
      `Cannot repair deposit ${toBigInt(deposit.id).toString()}: no accepted-owner debit found.`
    );
  }

  if (
    actualPrincipalRaw !== storedPrincipalRaw ||
    actualConfirmedSlot !== storedConfirmedSlot
  ) {
    mismatches.push({
      actualConfirmedSlot,
      actualPrincipalRaw,
      depositId: toBigInt(deposit.id),
      signature: deposit.deposit_signature,
      storedConfirmedSlot,
      storedPrincipalRaw,
      walletAddress: deposit.wallet_address,
    });
  }
}

if (mismatches.length === 0) {
  console.log(
    [
      "No Earn deposit principal repairs needed.",
      `cluster=${cluster}`,
      `checked=${deposits.length}`,
    ].join(" ")
  );
  process.exit(0);
}

for (const mismatch of mismatches) {
  console.log(
    [
      `deposit=${mismatch.depositId.toString()}`,
      `wallet=${mismatch.walletAddress}`,
      `signature=${mismatch.signature}`,
      `storedPrincipal=${mismatch.storedPrincipalRaw.toString()}`,
      `actualPrincipal=${mismatch.actualPrincipalRaw.toString()}`,
      `storedSlot=${mismatch.storedConfirmedSlot.toString()}`,
      `actualSlot=${mismatch.actualConfirmedSlot.toString()}`,
      `delta=${(
        mismatch.actualPrincipalRaw - mismatch.storedPrincipalRaw
      ).toString()}`,
    ].join(" ")
  );
}

const totalDeltaRaw = mismatches.reduce(
  (total, mismatch) =>
    total + mismatch.actualPrincipalRaw - mismatch.storedPrincipalRaw,
  BigInt(0)
);

if (!applyRepair) {
  console.log(
    [
      "Dry run only; pass --apply with CONFIRM_EARN_DEPOSIT_PRINCIPAL_REPAIR=1 to write.",
      `mismatches=${mismatches.length}`,
      `totalDelta=${totalDeltaRaw.toString()}`,
    ].join(" ")
  );
  process.exit(1);
}

const fixValues = mismatches.map(
  (mismatch) =>
    sql`(${mismatch.depositId}, ${mismatch.actualPrincipalRaw}, ${mismatch.actualConfirmedSlot})`
);
const repairResult = await client.db.execute(sql`
  WITH fixes(deposit_id, actual_principal_raw, actual_confirmed_slot) AS (
    VALUES ${sql.join(fixValues, sql`, `)}
  ),
  event_deltas AS (
    SELECT
      event.position_id,
      event.id AS event_id,
      fixes.deposit_id,
      event.principal_delta_raw AS old_principal_delta_raw,
      fixes.actual_principal_raw,
      fixes.actual_confirmed_slot,
      fixes.actual_principal_raw - event.principal_delta_raw AS delta_raw
    FROM loyal_yield.user_yield_position_holding_events AS event
    INNER JOIN fixes
      ON fixes.deposit_id = event.source_deposit_id
  ),
  updated_deposits AS (
    UPDATE loyal_yield.user_yield_position_deposits AS deposit
    SET
      confirmed_slot = fixes.actual_confirmed_slot,
      principal_amount_raw = fixes.actual_principal_raw
    FROM fixes
    WHERE deposit.id = fixes.deposit_id
    RETURNING deposit.id
  ),
  updated_events AS (
    UPDATE loyal_yield.user_yield_position_holding_events AS event
    SET
      observed_slot = event_deltas.actual_confirmed_slot,
      principal_delta_raw = event_deltas.actual_principal_raw
    FROM event_deltas
    WHERE event.id = event_deltas.event_id
    RETURNING event.id
  ),
  position_deltas AS (
    SELECT
      position_id,
      SUM(delta_raw)::bigint AS principal_adjustment_raw
    FROM event_deltas
    GROUP BY position_id
  ),
  updated_positions AS (
    UPDATE loyal_yield.user_yield_positions AS position
    SET
      principal_amount_raw =
        position.principal_amount_raw + position_deltas.principal_adjustment_raw,
      updated_at = now()
    FROM position_deltas
    WHERE position.id = position_deltas.position_id
    RETURNING position.id
  )
  SELECT
    (SELECT COUNT(*) FROM updated_deposits)::text AS updated_deposit_count,
    (SELECT COUNT(*) FROM updated_events)::text AS updated_event_count,
    (SELECT COUNT(*) FROM updated_positions)::text AS updated_position_count,
    COALESCE((SELECT SUM(delta_raw) FROM event_deltas), 0)::text AS total_delta_raw
`);
const [repairRow] = getExecuteRows(repairResult);

console.log(
  [
    "Earn deposit principal repair applied.",
    `updatedDeposits=${repairRow?.updated_deposit_count ?? "0"}`,
    `updatedEvents=${repairRow?.updated_event_count ?? "0"}`,
    `updatedPositions=${repairRow?.updated_position_count ?? "0"}`,
    `totalDelta=${repairRow?.total_delta_raw ?? "0"}`,
  ].join(" ")
);
