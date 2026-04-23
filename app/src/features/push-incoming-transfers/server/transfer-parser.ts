import "server-only";

import type { ParsedTransactionWithMeta } from "@solana/web3.js";

import type { IncomingTransferEvent } from "../types";
import { NATIVE_SOL_MINT } from "./constants";

const ZERO = BigInt(0);

/**
 * Extract incoming transfers (SOL + SPL) addressed to `walletPublicKey`
 * from a parsed transaction. Uses balance deltas from tx meta rather
 * than instruction parsing — that way we catch every incoming value
 * shift regardless of which program moved the tokens (simple transfers,
 * DEX payouts, CPIs, etc.).
 *
 * Zero or negative deltas are ignored — we only notify on credits.
 * Sender is a best-effort inference: the account with the largest
 * negative delta on the same mint in the same tx. Null if unclear.
 */
export function parseIncomingTransfersForWallet(
  tx: ParsedTransactionWithMeta,
  signature: string,
  walletPublicKey: string,
): IncomingTransferEvent[] {
  const meta = tx.meta;
  if (!meta || meta.err) return [];
  if (!tx.blockTime) return [];

  const occurredAt = new Date(tx.blockTime * 1000);
  const events: IncomingTransferEvent[] = [];

  // Native SOL: walk account keys, find the wallet's position, compare
  // preBalances[i] vs postBalances[i]. Lamport delta > 0 = incoming.
  const accountKeys = tx.transaction.message.accountKeys.map((key) =>
    typeof key === "string" ? key : key.pubkey.toBase58(),
  );
  const walletIndex = accountKeys.indexOf(walletPublicKey);

  if (walletIndex >= 0 && meta.preBalances && meta.postBalances) {
    const pre = BigInt(meta.preBalances[walletIndex] ?? 0);
    const post = BigInt(meta.postBalances[walletIndex] ?? 0);
    const delta = post - pre;
    if (delta > ZERO) {
      const sender = inferLargestSolDecrease(
        accountKeys,
        meta.preBalances,
        meta.postBalances,
        walletIndex,
      );
      events.push({
        kind: "sol",
        recipient: walletPublicKey,
        sender,
        amountRaw: delta,
        mint: NATIVE_SOL_MINT.toBase58(),
        signature,
        occurredAt,
      });
    }
  }

  // SPL tokens: compare pre/post token balances filtered to the wallet
  // as owner. One event per mint with a positive delta.
  const pre = meta.preTokenBalances ?? [];
  const post = meta.postTokenBalances ?? [];
  const balancesByKey = new Map<
    string,
    { preRaw: bigint; postRaw: bigint; mint: string }
  >();

  for (const entry of pre) {
    if (entry.owner !== walletPublicKey) continue;
    const key = `${entry.owner}|${entry.mint}`;
    const raw = BigInt(entry.uiTokenAmount.amount ?? "0");
    balancesByKey.set(key, {
      preRaw: raw,
      postRaw: ZERO,
      mint: entry.mint,
    });
  }
  for (const entry of post) {
    if (entry.owner !== walletPublicKey) continue;
    const key = `${entry.owner}|${entry.mint}`;
    const raw = BigInt(entry.uiTokenAmount.amount ?? "0");
    const existing = balancesByKey.get(key);
    if (existing) {
      existing.postRaw = raw;
    } else {
      balancesByKey.set(key, {
        preRaw: ZERO,
        postRaw: raw,
        mint: entry.mint,
      });
    }
  }

  for (const { preRaw, postRaw, mint } of balancesByKey.values()) {
    const delta = postRaw - preRaw;
    if (delta <= ZERO) continue;
    const sender = inferLargestTokenDecrease(
      meta.preTokenBalances ?? [],
      meta.postTokenBalances ?? [],
      mint,
      walletPublicKey,
    );
    events.push({
      kind: "spl",
      recipient: walletPublicKey,
      sender,
      amountRaw: delta,
      mint,
      signature,
      occurredAt,
    });
  }

  return events;
}

function inferLargestSolDecrease(
  accountKeys: string[],
  preBalances: number[],
  postBalances: number[],
  recipientIndex: number,
): string | null {
  let biggestDecreaseIdx = -1;
  let biggestDecrease = ZERO;
  for (let i = 0; i < accountKeys.length; i += 1) {
    if (i === recipientIndex) continue;
    const pre = BigInt(preBalances[i] ?? 0);
    const post = BigInt(postBalances[i] ?? 0);
    const delta = pre - post; // positive = they lost lamports
    if (delta > biggestDecrease) {
      biggestDecrease = delta;
      biggestDecreaseIdx = i;
    }
  }

  return biggestDecreaseIdx >= 0
    ? (accountKeys[biggestDecreaseIdx] ?? null)
    : null;
}

function inferLargestTokenDecrease(
  preTokenBalances: NonNullable<ParsedTransactionWithMeta["meta"]>["preTokenBalances"] extends infer T ? T : never,
  postTokenBalances: NonNullable<ParsedTransactionWithMeta["meta"]>["postTokenBalances"] extends infer T ? T : never,
  mint: string,
  recipientOwner: string,
): string | null {
  const byOwner = new Map<string, { preRaw: bigint; postRaw: bigint }>();

  for (const entry of preTokenBalances ?? []) {
    if (entry.mint !== mint) continue;
    if (!entry.owner || entry.owner === recipientOwner) continue;
    const current = byOwner.get(entry.owner) ?? {
      preRaw: ZERO,
      postRaw: ZERO,
    };
    current.preRaw += BigInt(entry.uiTokenAmount.amount ?? "0");
    byOwner.set(entry.owner, current);
  }
  for (const entry of postTokenBalances ?? []) {
    if (entry.mint !== mint) continue;
    if (!entry.owner || entry.owner === recipientOwner) continue;
    const current = byOwner.get(entry.owner) ?? {
      preRaw: ZERO,
      postRaw: ZERO,
    };
    current.postRaw += BigInt(entry.uiTokenAmount.amount ?? "0");
    byOwner.set(entry.owner, current);
  }

  let bestSender: string | null = null;
  let bestDecrease = ZERO;
  for (const [owner, { preRaw, postRaw }] of byOwner) {
    const decrease = preRaw - postRaw;
    if (decrease > bestDecrease) {
      bestDecrease = decrease;
      bestSender = owner;
    }
  }

  return bestSender;
}
