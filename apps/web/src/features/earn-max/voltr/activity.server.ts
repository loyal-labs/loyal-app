import "server-only";

import {
  type Connection,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
  PublicKey,
  type TokenBalance,
} from "@solana/web3.js";
import bs58 from "bs58";

import type { EarnMaxActivityItem, EarnMaxPerformancePoint } from "../types";
import {
  VOLTR_IDLE_ATA,
  VOLTR_PROGRAM_ID,
  VOLTR_VAULT,
  type VoltrPosition,
} from "./program";

const HISTORY_LIMIT = 100;
const CACHE_MS = 60_000;

// First 8 data bytes of the Voltr instructions a user signs (program.ts).
const ACTIONS: [action: string, discriminator: number[]][] = [
  ["deposit", [126, 224, 21, 255, 228, 53, 117, 33]],
  ["withdraw_request", [248, 225, 47, 22, 116, 144, 23, 143]],
  ["claim", [135, 7, 237, 120, 149, 94, 95, 7]],
];

type VoltrHistoryEntry = {
  action: string;
  /** Deposit: USDC in. Claim: USDC paid out. Request: filled below. */
  amountRaw: bigint | null;
  signature: string;
  timestamp: string;
};

export type EarnMaxVoltrHistory = {
  complete: boolean;
  entries: VoltrHistoryEntry[];
};

function voltrAction(
  instruction: PartiallyDecodedInstruction,
  authority: PublicKey
): { action: string; data: Buffer } | null {
  if (
    !instruction.programId.equals(VOLTR_PROGRAM_ID) ||
    !instruction.accounts.some((key) => key.equals(VOLTR_VAULT)) ||
    !instruction.accounts.some((key) => key.equals(authority))
  ) {
    return null;
  }
  const data = Buffer.from(bs58.decode(instruction.data));
  const match = ACTIONS.find(([, discriminator]) =>
    discriminator.every((byte, index) => data[index] === byte)
  );
  return match ? { action: match[0], data } : null;
}

function idleDeltaRaw(transaction: ParsedTransactionWithMeta): bigint {
  const idle = VOLTR_IDLE_ATA.toBase58();
  const keys = transaction.transaction.message.accountKeys;
  const amount = (balances: TokenBalance[] | null | undefined) =>
    BigInt(
      balances?.find((b) => keys[b.accountIndex]?.pubkey.toBase58() === idle)
        ?.uiTokenAmount.amount ?? "0"
    );
  return (
    amount(transaction.meta?.postTokenBalances) -
    amount(transaction.meta?.preTokenBalances)
  );
}

function decode(
  transaction: ParsedTransactionWithMeta,
  signature: string,
  authority: PublicKey
): VoltrHistoryEntry[] {
  const instructions = [
    ...transaction.transaction.message.instructions,
    ...(transaction.meta?.innerInstructions ?? []).flatMap(
      (i) => i.instructions
    ),
  ];
  const timestamp = new Date((transaction.blockTime ?? 0) * 1000).toISOString();
  const entries: VoltrHistoryEntry[] = [];
  for (const instruction of instructions) {
    if (!("data" in instruction)) continue;
    const match = voltrAction(instruction, authority);
    if (!match) continue;
    entries.push({
      action: match.action,
      amountRaw:
        match.action === "deposit"
          ? match.data.readBigUInt64LE(8)
          : match.action === "claim"
          ? -idleDeltaRaw(transaction)
          : null,
      signature,
      timestamp,
    });
  }
  return entries;
}

const cache = new Map<string, { at: number; value: EarnMaxVoltrHistory }>();

/** Newest first. Deposits, withdrawal requests and claims of one authority. */
export async function readVoltrHistory(
  connection: Connection,
  authority: PublicKey
): Promise<EarnMaxVoltrHistory> {
  const key = authority.toBase58();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const signatures = (
    await connection.getSignaturesForAddress(authority, {
      limit: HISTORY_LIMIT,
    })
  ).filter((s) => s.err === null);
  const transactions = await connection.getParsedTransactions(
    signatures.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0 }
  );
  const entries = transactions.flatMap((transaction, index) =>
    transaction
      ? decode(transaction, signatures[index]!.signature, authority)
      : []
  );
  // A request moves LP, not USDC: show what its claim paid (or the pending
  // payout). Entries are newest first, so the claim precedes its request.
  let laterClaimRaw: bigint | null = null;
  for (const entry of entries) {
    if (entry.action === "claim") laterClaimRaw = entry.amountRaw;
    if (entry.action === "withdraw_request") {
      entry.amountRaw = laterClaimRaw;
      laterClaimRaw = null;
    }
  }
  // ponytail: first 100 signatures only; page with `before` once an account
  // outgrows that (the UI then treats history as incomplete).
  const value = { complete: signatures.length < HISTORY_LIMIT, entries };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Fills the pending request's amount and derives the feeds the pane charts. */
export function voltrActivity(
  history: EarnMaxVoltrHistory,
  position: Pick<VoltrPosition, "valueRaw" | "withdrawal">
): {
  earnedRaw: bigint | null;
  operations: EarnMaxActivityItem[];
  performance: EarnMaxPerformancePoint[];
} {
  const entries = history.entries.map((entry) =>
    entry.action === "withdraw_request" &&
    entry.amountRaw === null &&
    position.withdrawal
      ? { ...entry, amountRaw: position.withdrawal.payoutRaw }
      : entry
  );
  const operations = entries.map((entry) => ({
    action: entry.action,
    amountRaw: entry.amountRaw === null ? null : entry.amountRaw.toString(),
    id: `${entry.signature}:${entry.action}`,
    signature: entry.signature,
    status: "confirmed",
    timestamp: entry.timestamp,
  }));
  // Equity after each flow is the running principal (a deposit is worth what
  // went in at that moment); the last point is today's value. ponytail: all
  // yield lands on today's bar; daily share-price snapshots would spread it.
  const performance: EarnMaxPerformancePoint[] = [];
  let principal = BigInt(0);
  for (const entry of [...entries].reverse()) {
    if (entry.action === "deposit") principal += entry.amountRaw ?? BigInt(0);
    else if (entry.action === "withdraw_request")
      principal -= entry.amountRaw ?? BigInt(0);
    else continue;
    performance.push({
      equityUsd: Number(principal < 0 ? 0 : principal) / 1_000_000,
      timestamp: entry.timestamp,
    });
  }
  if (performance.length > 0) {
    performance.push({
      equityUsd: Number(position.valueRaw) / 1_000_000,
      timestamp: new Date().toISOString(),
    });
  }
  const sum = (action: string) =>
    entries
      .filter((e) => e.action === action)
      .reduce((total, e) => total + (e.amountRaw ?? BigInt(0)), BigInt(0));
  const pendingRaw = position.withdrawal?.payoutRaw ?? BigInt(0);
  return {
    // Lifetime: what the user holds + is owed + got back, minus what went in.
    earnedRaw: history.complete
      ? position.valueRaw + pendingRaw + sum("claim") - sum("deposit")
      : null,
    operations,
    performance,
  };
}
