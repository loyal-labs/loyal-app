import "server-only";

import {
  privateTransferAnalyticsSyncState,
  privateTransferTokenCatalog,
} from "@loyal-labs/db-core/schema";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { eq, inArray } from "drizzle-orm";

import {
  PARSED_TX_BATCH_SIZE as ANALYTICS_BATCH_SIZE,
  PRIVATE_TRANSFER_PROGRAM_ID,
} from "@/features/private-transfer-analytics/server/constants";
import {
  buildTokenCatalogUpserts,
  upsertTokenCatalog,
} from "@/features/private-transfer-analytics/server/token-catalog";
import { getDatabase } from "@/lib/core/database";
import { sendPushToWallet } from "@/lib/push-notifications/send-to-wallet";

import type {
  PushShieldedTransfersStats,
  TransferDepositEvent,
} from "../types";
import { getPushShieldedTransfersConnection } from "./connection";
import {
  HISTORY_PAGE_LIMIT,
  MAX_HEAD_PAGES_PER_RUN,
  PARSED_TX_BATCH_SIZE,
  PUSH_SHIELDED_TRANSFERS_SYNC_KEY,
} from "./constants";
import { resolveDepositUsers } from "./deposit-account";
import { formatShieldedTransferPush } from "./format";
import { parseTransferDepositInstructions } from "./transfer-parser";

type MintMetadata = { symbol: string; decimals: number };
type SyncStateRow = typeof privateTransferAnalyticsSyncState.$inferSelect;

// Prefer the feature-local batch size but fall back to the analytics
// constant if that import path ever gets trimmed — keeps us loudly
// co-ordered with the sibling cron.
const TX_BATCH_SIZE = PARSED_TX_BATCH_SIZE ?? ANALYTICS_BATCH_SIZE;

async function getOrCreateSyncState(): Promise<SyncStateRow> {
  const db = getDatabase();
  const existing = await db.query.privateTransferAnalyticsSyncState.findFirst({
    where: eq(
      privateTransferAnalyticsSyncState.syncKey,
      PUSH_SHIELDED_TRANSFERS_SYNC_KEY
    ),
  });
  if (existing) return existing;

  await db
    .insert(privateTransferAnalyticsSyncState)
    .values({ syncKey: PUSH_SHIELDED_TRANSFERS_SYNC_KEY })
    .onConflictDoNothing();

  const created = await db.query.privateTransferAnalyticsSyncState.findFirst({
    where: eq(
      privateTransferAnalyticsSyncState.syncKey,
      PUSH_SHIELDED_TRANSFERS_SYNC_KEY
    ),
  });
  if (!created) {
    throw new Error("Failed to initialize push_shielded_transfers sync state");
  }
  return created;
}

async function updateSyncState(
  values: Partial<typeof privateTransferAnalyticsSyncState.$inferInsert>
): Promise<void> {
  const db = getDatabase();
  await db
    .update(privateTransferAnalyticsSyncState)
    .set({ ...values, updatedAt: new Date() })
    .where(
      eq(
        privateTransferAnalyticsSyncState.syncKey,
        PUSH_SHIELDED_TRANSFERS_SYNC_KEY
      )
    );
}

async function fetchHeadSignatures(
  state: SyncStateRow,
  stats: PushShieldedTransfersStats
): Promise<{ signatures: string[]; newestSignature: string | null }> {
  const connection = getPushShieldedTransfersConnection();
  const knownHead = state.latestSeenSignature ?? null;

  const collected: string[] = [];
  let before: string | undefined;
  let firstPageHead: string | null = null;

  for (let page = 0; page < MAX_HEAD_PAGES_PER_RUN; page += 1) {
    const batch = await connection.getSignaturesForAddress(
      PRIVATE_TRANSFER_PROGRAM_ID,
      {
        before,
        limit: HISTORY_PAGE_LIMIT,
        until: knownHead ?? undefined,
      }
    );
    if (batch.length === 0) break;

    stats.pagesProcessed += 1;
    stats.signaturesFetched += batch.length;
    if (page === 0) firstPageHead = batch[0]?.signature ?? null;

    for (const entry of batch) collected.push(entry.signature);

    if (batch.length < HISTORY_PAGE_LIMIT) break;
    before = batch[batch.length - 1]?.signature;
  }

  const newestSignature = firstPageHead ?? knownHead;
  return { newestSignature, signatures: collected };
}

async function fetchParsedTransactionsBatched(
  signatures: string[]
): Promise<(ParsedTransactionWithMeta | null)[]> {
  const connection = getPushShieldedTransfersConnection();
  const parsed: (ParsedTransactionWithMeta | null)[] = [];
  for (let i = 0; i < signatures.length; i += TX_BATCH_SIZE) {
    const slice = signatures.slice(i, i + TX_BATCH_SIZE);
    parsed.push(
      ...(await connection.getParsedTransactions(slice, {
        maxSupportedTransactionVersion: 0,
      }))
    );
  }
  return parsed;
}

async function resolveMintMetadata(
  mints: Iterable<string>
): Promise<Map<string, MintMetadata>> {
  const uniqueMints = Array.from(new Set(Array.from(mints).filter(Boolean)));
  if (uniqueMints.length === 0) return new Map();

  const db = getDatabase();
  const existing = await db
    .select({
      decimals: privateTransferTokenCatalog.decimals,
      symbol: privateTransferTokenCatalog.symbol,
      tokenMint: privateTransferTokenCatalog.tokenMint,
    })
    .from(privateTransferTokenCatalog)
    .where(inArray(privateTransferTokenCatalog.tokenMint, uniqueMints));

  const resolved = new Map<string, MintMetadata>();
  for (const row of existing) {
    resolved.set(row.tokenMint, {
      decimals: row.decimals ?? 0,
      symbol: row.symbol ?? row.tokenMint,
    });
  }

  const missing = uniqueMints.filter((mint) => !resolved.has(mint));
  if (missing.length > 0) {
    const entries = await buildTokenCatalogUpserts(missing);
    await upsertTokenCatalog(entries);
    for (const entry of entries) {
      resolved.set(entry.tokenMint, {
        decimals: entry.decimals ?? 0,
        symbol: entry.symbol,
      });
    }
  }

  return resolved;
}

export async function runPushShieldedTransfersCron(): Promise<PushShieldedTransfersStats> {
  const stats: PushShieldedTransfersStats = {
    errors: 0,
    eventsDetected: 0,
    firstRunPinned: false,
    notificationsSent: 0,
    pagesProcessed: 0,
    recipientsResolved: 0,
    signaturesFetched: 0,
  };

  const state = await getOrCreateSyncState();
  await updateSyncState({ lastError: null, lastRunStartedAt: new Date() });

  try {
    const { signatures, newestSignature } = await fetchHeadSignatures(
      state,
      stats
    );

    // First run (no cursor yet): don't dispatch pushes for historical
    // transfers — just pin the cursor at current head and wait for the
    // next tick. Mirrors the first-run policy in push-incoming-transfers.
    if (!state.latestSeenSignature) {
      stats.firstRunPinned = true;
      await updateSyncState({
        lastRunFinishedAt: new Date(),
        latestSeenSignature: newestSignature,
      });
      return stats;
    }

    if (signatures.length === 0) {
      await updateSyncState({
        lastRunFinishedAt: new Date(),
        latestSeenSignature: newestSignature,
      });
      return stats;
    }

    const parsedTransactions = await fetchParsedTransactionsBatched(signatures);

    const events: TransferDepositEvent[] = [];
    for (let i = 0; i < parsedTransactions.length; i += 1) {
      const tx = parsedTransactions[i];
      const sig = signatures[i];
      if (!tx || !sig) continue;
      events.push(...parseTransferDepositInstructions(tx, sig));
    }
    stats.eventsDetected = events.length;

    if (events.length === 0) {
      await updateSyncState({
        lastRunFinishedAt: new Date(),
        latestSeenSignature: newestSignature,
      });
      return stats;
    }

    const connection = getPushShieldedTransfersConnection();
    const depositUserByAddress = await resolveDepositUsers(
      connection,
      events.map((event) => event.destinationDepositAddress)
    );

    const metadataByMint = await resolveMintMetadata(
      events.map((event) => event.tokenMint)
    );

    for (const event of events) {
      const recipientWallet = depositUserByAddress.get(
        event.destinationDepositAddress
      );
      if (!recipientWallet) continue;
      stats.recipientsResolved += 1;

      const payload = formatShieldedTransferPush(
        event,
        metadataByMint.get(event.tokenMint) ?? null
      );
      try {
        const result = await sendPushToWallet(recipientWallet, payload);
        stats.notificationsSent += result.sentTo;
      } catch (error) {
        stats.errors += 1;
        console.error(
          `[push-shielded-transfers] dispatch failed for ${recipientWallet}`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    await updateSyncState({
      lastRunFinishedAt: new Date(),
      latestSeenSignature: newestSignature,
    });

    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateSyncState({
      lastError: message,
      lastRunFinishedAt: new Date(),
    });
    throw error;
  }
}
