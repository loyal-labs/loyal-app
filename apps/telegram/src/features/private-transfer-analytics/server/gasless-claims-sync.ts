import "server-only";

import { privateTransferAnalyticsSyncState } from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";
import { getGaslessKeypair } from "@/lib/solana/wallet/gasless-keypair.server";

import type { GaslessClaimHistorySyncStats } from "../types";
import { getPrivateMainnetConnection } from "./connection";
import {
  GASLESS_CLAIMS_ANALYTICS_SYNC_KEY,
  HISTORY_PAGE_LIMIT,
  MAX_BACKFILL_PAGES_PER_RUN,
  MAX_HEAD_SYNC_PAGES_PER_RUN,
} from "./constants";
import {
  buildGaslessClaimTransactionInput,
  classifyGaslessClaimTransaction,
  fetchParsedTransactionsForSignatures,
  upsertGaslessClaimTransactions,
} from "./gasless-claims";

type SyncStateRow = typeof privateTransferAnalyticsSyncState.$inferSelect;

async function getOrCreateSyncState(syncKey: string): Promise<SyncStateRow> {
  const db = getDatabase();
  const existing = await db.query.privateTransferAnalyticsSyncState.findFirst({
    where: eq(privateTransferAnalyticsSyncState.syncKey, syncKey),
  });
  if (existing) {
    return existing;
  }

  await db
    .insert(privateTransferAnalyticsSyncState)
    .values({ syncKey })
    .onConflictDoNothing();

  const created = await db.query.privateTransferAnalyticsSyncState.findFirst({
    where: eq(privateTransferAnalyticsSyncState.syncKey, syncKey),
  });
  if (!created) {
    throw new Error("Failed to initialize gasless claims analytics sync state");
  }

  return created;
}

async function updateSyncState(
  syncKey: string,
  values: Partial<typeof privateTransferAnalyticsSyncState.$inferInsert>
): Promise<void> {
  const db = getDatabase();
  await db
    .update(privateTransferAnalyticsSyncState)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(privateTransferAnalyticsSyncState.syncKey, syncKey));
}

async function upsertGaslessClaimRows(args: {
  payerAddress: string;
  signatures: string[];
  stats: GaslessClaimHistorySyncStats;
}): Promise<void> {
  if (args.signatures.length === 0) {
    return;
  }

  const connection = getPrivateMainnetConnection();
  const parsedTransactions = await fetchParsedTransactionsForSignatures(
    connection,
    args.signatures
  );

  const rows = parsedTransactions.flatMap((transaction, index) => {
    if (!transaction) {
      args.stats.recordsSkippedUnclassified += 1;
      return [];
    }

    const classification = classifyGaslessClaimTransaction(
      transaction,
      args.payerAddress
    );
    if ("skipReason" in classification) {
      if (classification.skipReason === "excludedBpfLoader") {
        args.stats.recordsSkippedExcludedBpfLoader += 1;
      } else if (classification.skipReason === "missingBlockTime") {
        args.stats.recordsSkippedMissingBlockTime += 1;
      } else {
        args.stats.recordsSkippedUnclassified += 1;
      }
      return [];
    }

    const signature = args.signatures[index];
    if (!signature) {
      args.stats.recordsSkippedUnclassified += 1;
      return [];
    }

    const row = buildGaslessClaimTransactionInput({
      payerAddress: args.payerAddress,
      recipientAddress: classification.recipientAddress,
      signature,
      solanaEnv: "mainnet",
      transaction,
      transactionType: classification.transactionType,
    });
    if (!row) {
      args.stats.recordsSkippedUnclassified += 1;
      return [];
    }

    return [row];
  });

  args.stats.recordsUpserted += await upsertGaslessClaimTransactions(rows);
}

export async function syncGaslessClaimHistory(): Promise<GaslessClaimHistorySyncStats> {
  const connection = getPrivateMainnetConnection();
  const state = await getOrCreateSyncState(GASLESS_CLAIMS_ANALYTICS_SYNC_KEY);
  const payerPublicKey = (await getGaslessKeypair()).publicKey;
  const payerAddress = payerPublicKey.toBase58();
  const stats: GaslessClaimHistorySyncStats = {
    backfillCompleted: Boolean(state.backfillCompletedAt),
    backfillPagesProcessed: 0,
    headPagesProcessed: 0,
    latestSeenSignature: state.latestSeenSignature ?? null,
    recordsSkippedExcludedBpfLoader: 0,
    recordsSkippedMissingBlockTime: 0,
    recordsSkippedUnclassified: 0,
    recordsUpserted: 0,
    signaturesFetched: 0,
  };

  await updateSyncState(GASLESS_CLAIMS_ANALYTICS_SYNC_KEY, {
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
      const page = await connection.getSignaturesForAddress(payerPublicKey, {
        before: headBefore,
        limit: HISTORY_PAGE_LIMIT,
      });
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

      await upsertGaslessClaimRows({
        payerAddress,
        signatures: signaturesToProcess,
        stats,
      });
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
        const page = await connection.getSignaturesForAddress(payerPublicKey, {
          before: nextBackfillCursor,
          limit: HISTORY_PAGE_LIMIT,
        });
        if (page.length === 0) {
          backfillCompletedAt = new Date();
          break;
        }

        stats.backfillPagesProcessed += 1;
        stats.signaturesFetched += page.length;

        await upsertGaslessClaimRows({
          payerAddress,
          signatures: page.map((entry) => entry.signature),
          stats,
        });

        nextBackfillCursor = page[page.length - 1]?.signature;
        if (page.length < HISTORY_PAGE_LIMIT) {
          backfillCompletedAt = new Date();
          break;
        }
      }
    }

    stats.backfillCompleted = Boolean(backfillCompletedAt);
    stats.latestSeenSignature = newestSeenSignature;

    await updateSyncState(GASLESS_CLAIMS_ANALYTICS_SYNC_KEY, {
      backfillCompletedAt,
      backfillCursor: nextBackfillCursor ?? null,
      latestSeenSignature: newestSeenSignature,
      lastRunFinishedAt: new Date(),
    });

    return stats;
  } catch (error) {
    await updateSyncState(GASLESS_CLAIMS_ANALYTICS_SYNC_KEY, {
      lastError: error instanceof Error ? error.message : String(error),
      lastRunFinishedAt: new Date(),
    });
    throw error;
  }
}
