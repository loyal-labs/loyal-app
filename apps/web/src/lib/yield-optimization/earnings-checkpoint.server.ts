import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import type { YieldPortfolioSnapshot } from "./earnings-calculator.server";
import type { EarnEarningsRangeSetResponse } from "./earnings.shared";
import { getYieldOptimizationClient } from "./yield-neon-client.server";

export type EarningsCheckpoint = {
  version: 1;
  at: string;
  firstDepositAt: string;
  historyFingerprint: string;
  ledgerFingerprint: string;
  apyFingerprint: string;
  reserves: string[];
  ranges: EarnEarningsRangeSetResponse["ranges"];
  seed: {
    observedSlot: string;
    exposures: {
      amountRaw: string;
      kind: "idle" | "kamino";
      liquidityMint: string;
      reserve: string | null;
      sourceId: string;
    }[];
  };
};

export function earningsFingerprint(value: unknown) {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        typeof item === "bigint" ? item.toString() : item
      )
    )
    .digest("hex");
}

export function checkpointSeed(
  checkpoint: EarningsCheckpoint
): YieldPortfolioSnapshot {
  return {
    observedAt: new Date(checkpoint.at),
    observedSlot: BigInt(checkpoint.seed.observedSlot),
    exposures: checkpoint.seed.exposures.map((exposure) => ({
      ...exposure,
      amountRaw: BigInt(exposure.amountRaw),
    })),
  };
}

// APY buckets are anchored to the first deposit. Only completed buckets are stable.
export function earningsCheckpointTime(firstDepositAt: Date, now: Date) {
  const day = 86_400_000;
  const closedApyPeriod =
    firstDepositAt.getTime() +
    Math.floor((now.getTime() - firstDepositAt.getTime()) / day) * day;
  return new Date(Math.floor(closedApyPeriod / day) * day);
}

// The yield migration increments these counters for inserts, updates and deletes.
export async function loadEarningsHistoryFingerprint(
  input: { walletAddress: string; settings: string; vaultIndex: number },
  before: Date,
  client = getYieldOptimizationClient()
): Promise<string> {
  const [row] = await client.db
    .select({
      fingerprint: sql<string>`(
    SELECT md5(coalesce(string_agg(history_day::text || ':' || revision::text, ',' ORDER BY history_day), ''))
    FROM loyal_yield.earn_history_day_revisions
    WHERE settings = ${input.settings} AND vault_index = ${input.vaultIndex}
      AND history_day < (${before.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date
  )`,
    })
    .from(sql`(SELECT 1) AS singleton`);
  return row.fingerprint;
}
