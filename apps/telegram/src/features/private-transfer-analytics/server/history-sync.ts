import "server-only";

import {
  privateTransferAnalyticsSyncState,
  privateTransferModifyBalanceEvents,
} from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";

import type { PrivateTransferHistorySyncStats } from "../types";
import { getPrivateMainnetConnection } from "./connection";
import {
  HISTORY_PAGE_LIMIT,
  MAX_BACKFILL_PAGES_PER_RUN,
  MAX_HEAD_SYNC_PAGES_PER_RUN,
  PARSED_TX_BATCH_SIZE,
  PRIVATE_TRANSFER_ANALYTICS_SYNC_KEY,
  PRIVATE_TRANSFER_PROGRAM_ID,
} from "./constants";
import { buildTokenCatalogUpserts, upsertTokenCatalog } from "./token-catalog";
import { parseModifyBalanceEventsFromTransaction } from "./transaction-parser";

type SyncStateRow = typeof privateTransferAnalyticsSyncState.$inferSelect;

async function getOrCreateSyncState(): Promise<SyncStateRow> {
  const db = getDatabase();
  const existing = await db.query.privateTransferAnalyticsSyncState.findFirst({
    where: eq(
      privateTransferAnalyticsSyncState.syncKey,
      PRIVATE_TRANSFER_ANALYTICS_SYNC_KEY
    ),
  });
  if (existing) {
    return existing;
  }

  await db
    .insert(privateTransferAnalyticsSyncState)
    .values({ syncKey: PRIVATE_TRANSFER_ANALYTICS_SYNC_KEY })
    .onConflictDoNothing();

  const created = await db.query.privateTransferAnalyticsSyncState.findFirst({
    where: eq(
      privateTransferAnalyticsSyncState.syncKey,
      PRIVATE_TRANSFER_ANALYTICS_SYNC_KEY
    ),
  });
  if (!created) {
    throw new Error(
      "Failed to initialize private transfer analytics sync state"
    );
  }

  return created;
}

async function insertModifyBalanceEvents(
  stats: PrivateTransferHistorySyncStats,
  signatures: string[]
): Promise<{
  latestSeenSignature: string | null;
}> {
  if (signatures.length === 0) {
    return { latestSeenSignature: null };
  }

  const connection = getPrivateMainnetConnection();

  // Chunk signatures to avoid 429s on large batches
  const parsedTransactions: (
    | import("@solana/web3.js").ParsedTransactionWithMeta
    | null
  )[] = [];
  for (let i = 0; i < signatures.length; i += PARSED_TX_BATCH_SIZE) {
    const batch = signatures.slice(i, i + PARSED_TX_BATCH_SIZE);
    parsedTransactions.push(
      ...(await connection.getParsedTransactions(batch, {
        maxSupportedTransactionVersion: 0,
      }))
    );
  }

  const parsedEvents = parsedTransactions.flatMap((tx, index) => {
    if (!tx) {
      return [];
    }
    const result = parseModifyBalanceEventsFromTransaction(
      tx,
      signatures[index]!
    );
    stats.eventsSkippedMissingBlockTime += result.skippedMissingBlockTime;
    return result.events;
  });

  if (parsedEvents.length > 0) {
    const db = getDatabase();
    const inserted = await db
      .insert(privateTransferModifyBalanceEvents)
      .values(parsedEvents)
      .onConflictDoNothing()
      .returning({ id: privateTransferModifyBalanceEvents.id });

    stats.eventsInserted += inserted.length;

    const tokenCatalogEntries = await buildTokenCatalogUpserts(
      parsedEvents.map((event) => event.tokenMint)
    );
    await upsertTokenCatalog(tokenCatalogEntries);
  }

  return { latestSeenSignature: signatures[0] ?? null };
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
        PRIVATE_TRANSFER_ANALYTICS_SYNC_KEY
      )
    );
}

export async function syncPrivateTransferHistory(): Promise<PrivateTransferHistorySyncStats> {
  const connection = getPrivateMainnetConnection();
  const state = await getOrCreateSyncState();
  const stats: PrivateTransferHistorySyncStats = {
    backfillCompleted: Boolean(state.backfillCompletedAt),
    backfillPagesProcessed: 0,
    eventsInserted: 0,
    eventsSkippedMissingBlockTime: 0,
    headPagesProcessed: 0,
    latestSeenSignature: state.latestSeenSignature ?? null,
    signaturesFetched: 0,
  };

  await updateSyncState({
    lastError: null,
    lastRunStartedAt: new Date(),
  });

  try {
    let newestSeenSignature = state.latestSeenSignature ?? null;
    let headBefore: string | undefined;
    let reachedKnownHead = false;
    const latestKnownSignature = state.latestSeenSignature ?? undefined;

    for (
      let pageIndex = 0;
      pageIndex < MAX_HEAD_SYNC_PAGES_PER_RUN && !reachedKnownHead;
      pageIndex += 1
    ) {
      const page = await connection.getSignaturesForAddress(
        PRIVATE_TRANSFER_PROGRAM_ID,
        {
          before: headBefore,
          limit: HISTORY_PAGE_LIMIT,
        }
      );
      if (page.length === 0) {
        break;
      }

      stats.headPagesProcessed += 1;
      stats.signaturesFetched += page.length;

      if (pageIndex === 0 && page[0]) {
        newestSeenSignature = page[0].signature;
      }

      let signaturesToProcess = page.map((entry) => entry.signature);
      if (latestKnownSignature) {
        const knownIndex = signaturesToProcess.indexOf(latestKnownSignature);
        if (knownIndex >= 0) {
          signaturesToProcess = signaturesToProcess.slice(0, knownIndex);
          reachedKnownHead = true;
        }
      }

      await insertModifyBalanceEvents(stats, signaturesToProcess);
      headBefore = page[page.length - 1]?.signature;

      if (!latestKnownSignature && page.length < HISTORY_PAGE_LIMIT) {
        reachedKnownHead = true;
      }
    }

    const backfillCursor =
      state.backfillCursor ??
      headBefore ??
      state.latestSeenSignature ??
      undefined;
    let nextBackfillCursor = backfillCursor;
    let backfillCompletedAt = state.backfillCompletedAt;

    if (!backfillCompletedAt) {
      for (
        let pageIndex = 0;
        pageIndex < MAX_BACKFILL_PAGES_PER_RUN;
        pageIndex += 1
      ) {
        const page = await connection.getSignaturesForAddress(
          PRIVATE_TRANSFER_PROGRAM_ID,
          {
            before: nextBackfillCursor,
            limit: HISTORY_PAGE_LIMIT,
          }
        );

        if (page.length === 0) {
          backfillCompletedAt = new Date();
          break;
        }

        stats.backfillPagesProcessed += 1;
        stats.signaturesFetched += page.length;

        await insertModifyBalanceEvents(
          stats,
          page.map((entry) => entry.signature)
        );

        nextBackfillCursor = page[page.length - 1]?.signature;
        if (page.length < HISTORY_PAGE_LIMIT) {
          backfillCompletedAt = new Date();
          break;
        }
      }
    }

    stats.backfillCompleted = Boolean(backfillCompletedAt);
    stats.latestSeenSignature = newestSeenSignature;

    await updateSyncState({
      backfillCompletedAt,
      backfillCursor: nextBackfillCursor ?? null,
      latestSeenSignature: newestSeenSignature,
      lastRunFinishedAt: new Date(),
    });

    return stats;
  } catch (error) {
    await updateSyncState({
      lastError: error instanceof Error ? error.message : String(error),
      lastRunFinishedAt: new Date(),
    });
    throw error;
  }
}
