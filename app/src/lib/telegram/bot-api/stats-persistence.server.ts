import "server-only";

import {
  loyalStatsSnapshots,
  telegramCommandReceipts,
  type TelegramCommandReceiptStatus,
} from "@loyal-labs/db-core/schema";
import { eq, sql } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";

import type { LoyalStats } from "./stats-command";

const CURRENT_SNAPSHOT_KEY = "current";

export const LOYAL_STATS_MAX_AGE_MS = 5 * 60 * 1000;

export type StatsCommandClaim = {
  chatId: number;
  telegramUserId?: number;
  updateId: number;
};

export type StatsCommandCompletion = {
  messageId?: number;
  status: Exclude<TelegramCommandReceiptStatus, "processing">;
  updateId: number;
};

export type LoyalStatsSnapshotResult = {
  ageMs: number;
  refreshedAt: Date;
  stats: LoyalStats;
};

export async function claimStatsCommand(
  input: StatsCommandClaim
): Promise<boolean> {
  const database = getDatabase();
  const inserted = await database
    .insert(telegramCommandReceipts)
    .values({
      chatId: BigInt(input.chatId),
      command: "/stats",
      telegramUpdateId: BigInt(input.updateId),
      telegramUserId:
        input.telegramUserId === undefined
          ? null
          : BigInt(input.telegramUserId),
    })
    .onConflictDoNothing()
    .returning({ id: telegramCommandReceipts.id });

  return inserted.length === 1;
}

export async function completeStatsCommand(
  input: StatsCommandCompletion
): Promise<void> {
  const completedAt = new Date();
  await getDatabase()
    .update(telegramCommandReceipts)
    .set({
      completedAt,
      status: input.status,
      telegramMessageId: input.messageId,
      updatedAt: completedAt,
    })
    .where(
      eq(telegramCommandReceipts.telegramUpdateId, BigInt(input.updateId))
    );
}

export async function loadLoyalStatsSnapshot(
  now: Date = new Date()
): Promise<LoyalStatsSnapshotResult> {
  const rows = await getDatabase()
    .select({
      refreshedAt: loyalStatsSnapshots.refreshedAt,
      totalAumRaw: loyalStatsSnapshots.totalAumRaw,
      totalOptimizedVolumeRaw: loyalStatsSnapshots.totalOptimizedVolumeRaw,
      totalUsers: loyalStatsSnapshots.totalUsers,
    })
    .from(loyalStatsSnapshots)
    .where(eq(loyalStatsSnapshots.snapshotKey, CURRENT_SNAPSHOT_KEY))
    .limit(1);

  const snapshot = rows[0];
  if (!snapshot) {
    throw new Error("Loyal stats snapshot is unavailable");
  }

  const ageMs = Math.max(0, now.getTime() - snapshot.refreshedAt.getTime());
  if (ageMs > LOYAL_STATS_MAX_AGE_MS) {
    throw new Error("Loyal stats snapshot is stale");
  }

  return {
    ageMs,
    refreshedAt: snapshot.refreshedAt,
    stats: {
      totalAumRaw: snapshot.totalAumRaw,
      totalOptimizedVolumeRaw: snapshot.totalOptimizedVolumeRaw,
      totalUsers: snapshot.totalUsers,
    },
  };
}

export async function upsertLoyalStatsSnapshot(
  stats: LoyalStats,
  refreshedAt: Date = new Date()
): Promise<void> {
  const values = {
    refreshedAt,
    snapshotKey: CURRENT_SNAPSHOT_KEY,
    totalAumRaw: stats.totalAumRaw,
    totalOptimizedVolumeRaw: stats.totalOptimizedVolumeRaw,
    totalUsers: stats.totalUsers,
    updatedAt: refreshedAt,
  };

  await getDatabase()
    .insert(loyalStatsSnapshots)
    .values(values)
    .onConflictDoUpdate({
      set: values,
      setWhere: sql`${loyalStatsSnapshots.refreshedAt} <= ${refreshedAt}`,
      target: loyalStatsSnapshots.snapshotKey,
    });
}
