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
  confirmed_at: string;
  confirmed_slot: string | number | bigint;
  deposit_mint: string;
  deposit_signature: string;
  smart_account_address: string;
  id: string | number | bigint;
  principal_amount_raw: string | number | bigint;
  vault_pubkey: string;
  wallet_address: string;
};

type VerificationFailure = {
  acceptedOwnerDeltas?: Record<string, string>;
  depositId: bigint;
  expectedDebitRaw?: bigint;
  reason:
    | "deposit_debit_missing"
    | "principal_mismatch"
    | "transaction_error"
    | "transaction_unavailable";
  signature: string;
  walletAddress: string;
};

type SlotWarning = {
  actualSlot: bigint;
  depositId: bigint;
  recordedSlot: bigint;
  signature: string;
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

function parseLimitArg(): number | null {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  if (!limitArg) {
    return null;
  }

  const value = Number(limitArg.slice("--limit=".length));
  if (!(Number.isInteger(value) && value > 0)) {
    throw new Error("--limit must be a positive integer.");
  }

  return value;
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

function createAcceptedOwnerDeltas(
  deltasByOwner: Map<string, bigint>,
  acceptedOwners: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const owner of acceptedOwners) {
    result[owner] = (deltasByOwner.get(owner) ?? BigInt(0)).toString();
  }
  return result;
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

const limit = parseLimitArg();
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
const queryResult = await getYieldOptimizationClient().db.execute(sql`
  SELECT
    id::text,
    deposit_signature,
    confirmed_slot::text,
    wallet_address,
    smart_account_address,
    vault_pubkey,
    deposit_mint,
    principal_amount_raw::text,
    confirmed_at::text
  FROM loyal_yield.user_yield_position_deposits
  ORDER BY confirmed_at ASC, id ASC
`);
const depositRows = (getExecuteRows(queryResult) as DepositRow[]).slice(
  0,
  limit ?? undefined
);

const failures: VerificationFailure[] = [];
const slotWarnings: SlotWarning[] = [];

for (const row of depositRows) {
  const transaction = await connection.getParsedTransaction(
    row.deposit_signature,
    {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    }
  );
  const depositId = toBigInt(row.id);

  if (!transaction || !transaction.meta) {
    failures.push({
      depositId,
      reason: "transaction_unavailable",
      signature: row.deposit_signature,
      walletAddress: row.wallet_address,
    });
    continue;
  }

  if (transaction.meta.err) {
    failures.push({
      depositId,
      reason: "transaction_error",
      signature: row.deposit_signature,
      walletAddress: row.wallet_address,
    });
    continue;
  }

  const actualSlot = BigInt(transaction.slot);
  const recordedSlot = toBigInt(row.confirmed_slot);
  if (actualSlot !== recordedSlot) {
    slotWarnings.push({
      actualSlot,
      depositId,
      recordedSlot,
      signature: row.deposit_signature,
    });
  }

  const expectedDebitRaw = -toBigInt(row.principal_amount_raw);
  const deltasByOwner = getTokenBalanceDeltasByOwner({
    mint: row.deposit_mint,
    transaction,
  });
  const acceptedOwners = [
    ...new Set([
      row.wallet_address,
      row.smart_account_address,
      row.vault_pubkey,
    ]),
  ];
  const acceptedOwnerDeltas = createAcceptedOwnerDeltas(
    deltasByOwner,
    acceptedOwners
  );
  const hasExpectedDebit = acceptedOwners.some(
    (owner) => deltasByOwner.get(owner) === expectedDebitRaw
  );
  const hasAcceptedDebit = acceptedOwners.some(
    (owner) => (deltasByOwner.get(owner) ?? BigInt(0)) < BigInt(0)
  );

  if (!hasExpectedDebit) {
    failures.push({
      acceptedOwnerDeltas,
      depositId,
      expectedDebitRaw,
      reason: hasAcceptedDebit ? "principal_mismatch" : "deposit_debit_missing",
      signature: row.deposit_signature,
      walletAddress: row.wallet_address,
    });
  }
}

if (failures.length === 0) {
  console.log(
    [
      "All Earn deposit principal rows match confirmed accepted-owner token deltas.",
      `cluster=${cluster}`,
      `checked=${depositRows.length}`,
      `slotWarnings=${slotWarnings.length}`,
    ].join(" ")
  );
  for (const warning of slotWarnings) {
    console.log(
      [
        `slotWarningDeposit=${warning.depositId.toString()}`,
        `signature=${warning.signature}`,
        `recordedSlot=${warning.recordedSlot.toString()}`,
        `actualSlot=${warning.actualSlot.toString()}`,
      ].join(" ")
    );
  }
  process.exit(0);
}

for (const failure of failures) {
  console.log(
    [
      `deposit=${failure.depositId.toString()}`,
      `wallet=${failure.walletAddress}`,
      `signature=${failure.signature}`,
      `reason=${failure.reason}`,
      failure.expectedDebitRaw === undefined
        ? null
        : `expectedDebit=${failure.expectedDebitRaw.toString()}`,
      failure.acceptedOwnerDeltas === undefined
        ? null
        : `acceptedOwnerDeltas=${JSON.stringify(failure.acceptedOwnerDeltas)}`,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

process.exit(1);
