import "server-only";

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";

import type {
  EarnForecastApyHistoryResponse,
  EarnForecastApyHistorySample,
  EarnForecastApyHistorySeries,
  EarnForecastResponse,
} from "@/lib/kamino/earn-forecast.shared";

import {
  earnApyHourlySnapshots,
  earnForecastSnapshots,
  getYieldOptimizationClient,
  type YieldOptimizationClient,
} from "./yield-neon-client.server";

export type EarnForecastSnapshotRecord =
  typeof earnForecastSnapshots.$inferSelect;
export type EarnApyHourlySnapshotRecord =
  typeof earnApyHourlySnapshots.$inferSelect;

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
      riskProfile:
        snapshot.riskProfile as EarnForecastApyHistoryResponse["riskProfile"],
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
      strategy: snapshot.strategy as EarnForecastResponse["strategy"],
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

export async function getLatestEarnApyHourlyForecast(
  input: EarnForecastSnapshotLookupInput,
  dependencies: EarnForecastSnapshotRepositoryDependencies = createDependencies()
): Promise<EarnForecastSnapshotResult | null> {
  const latestRows = await dependencies.client.db
    .select()
    .from(earnApyHourlySnapshots)
    .where(
      and(
        eq(earnApyHourlySnapshots.strategy, input.strategy),
        eq(earnApyHourlySnapshots.riskProfile, input.riskProfile),
        eq(earnApyHourlySnapshots.feeBps, input.feeBps)
      )
    )
    .orderBy(desc(earnApyHourlySnapshots.sampleHour))
    .limit(1);
  const latest = latestRows[0];
  if (!latest) {
    return null;
  }

  const windowStartedAt = new Date(latest.sampleHour);
  windowStartedAt.setUTCDate(windowStartedAt.getUTCDate() - 30);
  const rows = await dependencies.client.db
    .select()
    .from(earnApyHourlySnapshots)
    .where(
      and(
        eq(earnApyHourlySnapshots.strategy, input.strategy),
        eq(earnApyHourlySnapshots.riskProfile, input.riskProfile),
        eq(earnApyHourlySnapshots.feeBps, input.feeBps),
        gte(earnApyHourlySnapshots.sampleHour, windowStartedAt)
      )
    )
    .orderBy(asc(earnApyHourlySnapshots.sampleHour));

  if (rows.length === 0) {
    return null;
  }

  return hourlyRowsToEarnForecast(rows);
}

function hourlyRowsToEarnForecast(
  rows: EarnApyHourlySnapshotRecord[]
): EarnForecastSnapshotResult {
  const latest = rows[rows.length - 1];
  const loyalSamples = rows.map((row) => ({
    apyBps: row.loyalApyBps,
    observedAt: row.sampleHour.toISOString(),
  }));
  const mainUsdcReserveSamples = rows.map((row) => ({
    apyBps: row.mainUsdcReserveApyBps,
    observedAt: row.sampleHour.toISOString(),
  }));
  const sampleBps = loyalSamples.map((sample) => sample.apyBps);
  const rangeLowBps = Math.min(...sampleBps, latest.loyalApyBps);
  const rangeHighBps = Math.max(...sampleBps, latest.loyalApyBps);

  return {
    history: {
      feeBps: 1,
      generatedAt: latest.generatedAt.toISOString(),
      riskProfile:
        latest.riskProfile as EarnForecastApyHistoryResponse["riskProfile"],
      samples: loyalSamples,
      series: [
        {
          key: "loyal",
          label: "Loyal Earn",
          metadata: {
            metric: "rolling_time_weighted_apy_bps",
          },
          samples: loyalSamples,
        },
        {
          key: "mainUsdcReserve",
          label: "Main Kamino USDC",
          metadata: {
            metric: "rolling_time_weighted_apy_bps",
          },
          samples: mainUsdcReserveSamples,
        },
      ],
      window: {
        endedAt: latest.windowEndedAt.toISOString(),
        startedAt: rows[0].windowStartedAt.toISOString(),
      },
    },
    summary: {
      apyBps: latest.loyalApyBps,
      rangeHighBps,
      rangeLowBps,
      strategy: latest.strategy as EarnForecastResponse["strategy"],
      updatedAt: latest.generatedAt.toISOString(),
      window: {
        endedAt: latest.windowEndedAt.toISOString(),
        startedAt: rows[0].windowStartedAt.toISOString(),
      },
    },
  };
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
