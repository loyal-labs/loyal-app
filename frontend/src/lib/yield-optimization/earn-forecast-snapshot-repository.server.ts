import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import type {
  EarnForecastApyHistoryResponse,
  EarnForecastApyHistorySample,
  EarnForecastApyHistorySeries,
  EarnForecastResponse,
} from "@/lib/kamino/earn-forecast.shared";

import {
  earnForecastSnapshots,
  getYieldOptimizationClient,
  type YieldOptimizationClient,
} from "./yield-neon-client.server";

export type EarnForecastSnapshotRecord =
  typeof earnForecastSnapshots.$inferSelect;

export type EarnForecastSnapshotLookupInput = {
  cluster: string;
  feeBps: number;
  riskProfile: string;
  strategy: string;
};

export type EarnForecastSnapshotInput = EarnForecastSnapshotLookupInput & {
  apyBps: number;
  generatedAt: Date;
  rangeHighBps: number;
  rangeLowBps: number;
  samples: EarnForecastApyHistorySample[];
  series: EarnForecastApyHistorySeries[];
  snapshotDate: Date;
  windowEndedAt: Date;
  windowStartedAt: Date;
};

export type EarnForecastSnapshotResult = {
  history: EarnForecastApyHistoryResponse;
  summary: EarnForecastResponse;
};

type EarnForecastSnapshotRepositoryDependencies = {
  client: YieldOptimizationClient;
};

function createDependencies(): EarnForecastSnapshotRepositoryDependencies {
  return {
    client: getYieldOptimizationClient(),
  };
}

function getUtcDate(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

function normalizeSnapshotSeries(args: {
  samples: EarnForecastApyHistorySample[];
  series: EarnForecastApyHistorySeries[] | undefined;
}): EarnForecastApyHistorySeries[] {
  if (args.series && args.series.length > 0) {
    return args.series;
  }

  return [
    {
      key: "loyal",
      label: "Loyal Earn",
      samples: args.samples,
    },
  ];
}

export function toEarnForecastSnapshotInput(args: {
  cluster: string;
  forecast: EarnForecastSnapshotResult;
}): EarnForecastSnapshotInput {
  const windowEndedAt = new Date(args.forecast.summary.window.endedAt);

  return {
    apyBps: args.forecast.summary.apyBps,
    cluster: args.cluster,
    feeBps: args.forecast.history.feeBps,
    generatedAt: new Date(args.forecast.history.generatedAt),
    rangeHighBps: args.forecast.summary.rangeHighBps,
    rangeLowBps: args.forecast.summary.rangeLowBps,
    riskProfile: args.forecast.history.riskProfile,
    samples: args.forecast.history.samples,
    series: normalizeSnapshotSeries({
      samples: args.forecast.history.samples,
      series: args.forecast.history.series,
    }),
    snapshotDate: getUtcDate(windowEndedAt),
    strategy: args.forecast.summary.strategy,
    windowEndedAt,
    windowStartedAt: new Date(args.forecast.summary.window.startedAt),
  };
}

export function snapshotRecordToEarnForecast(
  snapshot: EarnForecastSnapshotRecord
): EarnForecastSnapshotResult {
  const series = normalizeSnapshotSeries({
    samples: snapshot.samples,
    series: snapshot.series,
  });

  return {
    history: {
      feeBps: 1,
      generatedAt: snapshot.generatedAt.toISOString(),
      riskProfile: "medium",
      samples: snapshot.samples,
      series,
      window: {
        endedAt: snapshot.windowEndedAt.toISOString(),
        startedAt: snapshot.windowStartedAt.toISOString(),
      },
    },
    summary: {
      apyBps: snapshot.apyBps,
      rangeHighBps: snapshot.rangeHighBps,
      rangeLowBps: snapshot.rangeLowBps,
      strategy: "medium_fee_aware_1bps",
      updatedAt: snapshot.generatedAt.toISOString(),
      window: {
        endedAt: snapshot.windowEndedAt.toISOString(),
        startedAt: snapshot.windowStartedAt.toISOString(),
      },
    },
  };
}

export async function getLatestEarnForecastSnapshot(
  input: EarnForecastSnapshotLookupInput,
  dependencies: EarnForecastSnapshotRepositoryDependencies = createDependencies()
): Promise<EarnForecastSnapshotRecord | null> {
  const [snapshot] = await dependencies.client.db
    .select()
    .from(earnForecastSnapshots)
    .where(
      and(
        eq(earnForecastSnapshots.strategy, input.strategy),
        eq(earnForecastSnapshots.riskProfile, input.riskProfile),
        eq(earnForecastSnapshots.feeBps, input.feeBps)
      )
    )
    .orderBy(
      desc(earnForecastSnapshots.snapshotDate),
      desc(earnForecastSnapshots.generatedAt)
    )
    .limit(1);

  return snapshot ?? null;
}

export async function upsertEarnForecastSnapshot(
  input: EarnForecastSnapshotInput,
  dependencies: EarnForecastSnapshotRepositoryDependencies = createDependencies()
): Promise<EarnForecastSnapshotRecord> {
  const [snapshot] = await dependencies.client.db
    .insert(earnForecastSnapshots)
    .values({
      apyBps: input.apyBps,
      feeBps: input.feeBps,
      generatedAt: input.generatedAt,
      rangeHighBps: input.rangeHighBps,
      rangeLowBps: input.rangeLowBps,
      riskProfile: input.riskProfile,
      samples: input.samples,
      series: input.series,
      snapshotDate: input.snapshotDate,
      strategy: input.strategy,
      windowEndedAt: input.windowEndedAt,
      windowStartedAt: input.windowStartedAt,
    })
    .onConflictDoUpdate({
      target: [
        earnForecastSnapshots.strategy,
        earnForecastSnapshots.riskProfile,
        earnForecastSnapshots.feeBps,
        earnForecastSnapshots.snapshotDate,
      ],
      set: {
        apyBps: sql`excluded.apy_bps`,
        generatedAt: sql`excluded.generated_at`,
        rangeHighBps: sql`excluded.range_high_bps`,
        rangeLowBps: sql`excluded.range_low_bps`,
        samples: sql`excluded.samples`,
        series: sql`excluded.series`,
        windowEndedAt: sql`excluded.window_ended_at`,
        windowStartedAt: sql`excluded.window_started_at`,
      },
    })
    .returning();

  if (!snapshot) {
    throw new Error("Failed to upsert Earn forecast snapshot.");
  }

  return snapshot;
}
