import "server-only";

import { loyalStatsSnapshots } from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";

const CURRENT_SNAPSHOT_KEY = "current";
const STATS_MAX_AGE_MS = 5 * 60 * 1000;

export type AdminEarnSnapshot = {
  activeAutodepositPolicies: number;
  activeAumRaw: bigint;
  activePrincipalRaw: bigint;
  ageMs: number;
  refreshedAt: string;
  state: "current" | "stale";
  uniqueEarnPolicies: number;
  uniqueEarnUsers: number;
};

export async function getAdminEarnSnapshot(): Promise<AdminEarnSnapshot | null> {
  const rows = await getDatabase()
    .select({
      activeAutodepositPolicies: loyalStatsSnapshots.activeAutodepositPolicies,
      activeAumRaw: loyalStatsSnapshots.totalAumRaw,
      activePrincipalRaw: loyalStatsSnapshots.activePrincipalRaw,
      refreshedAt: loyalStatsSnapshots.refreshedAt,
      uniqueEarnPolicies: loyalStatsSnapshots.uniqueEarnPolicies,
      uniqueEarnUsers: loyalStatsSnapshots.uniqueEarnUsers,
    })
    .from(loyalStatsSnapshots)
    .where(eq(loyalStatsSnapshots.snapshotKey, CURRENT_SNAPSHOT_KEY))
    .limit(1);

  const snapshot = rows[0];
  if (!snapshot) {
    return null;
  }

  const ageMs = Math.max(0, Date.now() - snapshot.refreshedAt.getTime());
  return {
    ...snapshot,
    ageMs,
    refreshedAt: snapshot.refreshedAt.toISOString(),
    state: ageMs > STATS_MAX_AGE_MS ? "stale" : "current",
  };
}
