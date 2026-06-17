import "server-only";

import { STABLECOIN_MINTS, STABLECOINS } from "@loyal-labs/actions/constants";
import { Stablecoin } from "@loyal-labs/actions/types";

import {
  FALLBACK_EARN_FORECAST,
  type EarnForecastApyHistoryResponse,
  type EarnForecastResponse,
} from "./earn-forecast.shared";
import { TimescaleReserveClient } from "./timescale-reserve-client.server";
import type {
  TimescaleReserveApySample,
  TimescaleReserveUpdateRow,
  TimescaleSupportedReserveRow,
} from "./timescale-reserve-client.server";
import {
  getLatestEarnApyHourlyForecast,
  getLatestEarnForecastSnapshot,
  snapshotRecordToEarnForecast,
  toEarnForecastSnapshotInput,
  upsertEarnForecastSnapshot,
} from "@/lib/yield-optimization/earn-forecast-snapshot-repository.server";

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_TOTAL_SUPPLY_USD_ESTIMATE = 100_000;
const MAX_SUPPLY_APY = 0.5;
const CROSS_MINT_FEE_BPS = 1;
const CROSS_MINT_FEE_RATE = CROSS_MINT_FEE_BPS / 10_000;
const HISTORY_SAMPLE_INTERVAL_MS = 60 * 60 * 1000;
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
const USDC_MINT = STABLECOIN_MINTS[Stablecoin.USDC].toBase58();
export const KAMINO_MAIN_MARKET =
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
export const KAMINO_MAIN_MARKET_USDC_RESERVE =
  "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";
export const KAMINO_MAIN_MARKET_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_ENV_ENV_NAME = "NEXT_PUBLIC_SOLANA_ENV";
const SAFE_FEE_AWARE_STRATEGY = "safe_fee_aware_1bps";
const MEDIUM_FEE_AWARE_STRATEGY = "medium_fee_aware_1bps";
const SAFE_RISK_PROFILE = "safe";
const MEDIUM_RISK_PROFILE = "medium";
const STABLECOIN_MINT_SET = new Set(
  STABLECOINS.map((stablecoin) => STABLECOIN_MINTS[stablecoin].toBase58())
);

export type MediumFeeAwareEarnForecastResult = {
  history: EarnForecastApyHistoryResponse;
  summary: EarnForecastResponse;
};

export type EarnForecastReserveRow = Pick<
  TimescaleReserveUpdateRow,
  | "liquidityMint"
  | "market"
  | "marketName"
  | "observedAt"
  | "reserve"
  | "reserveLastUpdateStale"
  | "supplyApy"
  | "symbol"
  | "totalSupplyUsdEstimate"
>;

export type EarnForecastSupportedReserveRow = Pick<
  TimescaleSupportedReserveRow,
  "active" | "liquidityMint" | "market" | "marketName" | "reserve" | "symbol"
>;

export type EarnForecastTimescaleClient = {
  close: () => Promise<void>;
  getMediumStableSupportedReserves: () => Promise<
    EarnForecastSupportedReserveRow[]
  >;
  getReserveUpdatesWithSeedRows: (args: {
    end: Date;
    reserves: readonly string[];
    start: Date;
  }) => Promise<EarnForecastReserveRow[]>;
  getReserveApyHistorySamples: (args: {
    end: Date;
    reserve: string;
    sampleIntervalSeconds?: number;
    start: Date;
  }) => Promise<TimescaleReserveApySample[]>;
};

type ReserveState = {
  apy: number;
  liquidityMint: string;
  observedAt: Date;
  reserve: string;
};

type Position = {
  apy: number;
  id: string;
  liquidityMint: string;
};

type SimulationSample = {
  observedAt: Date;
  value: number;
};

let cache: {
  expiresAt: number;
  value: MediumFeeAwareEarnForecastResult;
} | null = null;

function toBps(apy: number): number {
  return Math.round(apy * 10_000);
}

function annualizeReturn(value: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || value <= 0) {
    return 0;
  }

  return value ** (MS_PER_YEAR / elapsedMs) - 1;
}

function quantile(values: readonly number[], quantileValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * quantileValue))
  );
  return sorted[index];
}

function uniqueSortedDates(dates: readonly Date[]): Date[] {
  return [...new Set(dates.map((date) => date.getTime()))]
    .sort((a, b) => a - b)
    .map((time) => new Date(time));
}

function switchCostRate(fromMint: string, toMint: string): number {
  return fromMint === toMint ? 0 : CROSS_MINT_FEE_RATE;
}

function isEligibleReserveRow(
  row: EarnForecastReserveRow,
  supportedByReserve: ReadonlyMap<string, EarnForecastSupportedReserveRow>
): boolean {
  const supported = supportedByReserve.get(row.reserve);
  return (
    supported !== undefined &&
    supported.active === true &&
    row.reserveLastUpdateStale === false &&
    row.totalSupplyUsdEstimate > MIN_TOTAL_SUPPLY_USD_ESTIMATE &&
    row.supplyApy >= 0 &&
    row.supplyApy < MAX_SUPPLY_APY &&
    row.liquidityMint === supported.liquidityMint &&
    STABLECOIN_MINT_SET.has(row.liquidityMint)
  );
}

function isSupportedStableReserve(
  row: EarnForecastSupportedReserveRow
): boolean {
  return row.active === true && STABLECOIN_MINT_SET.has(row.liquidityMint);
}

function positionsFromState(
  stateByReserve: ReadonlyMap<string, ReserveState>
): Position[] {
  return [
    { apy: 0, id: "cash:USDC", liquidityMint: USDC_MINT },
    ...[...stateByReserve.values()].map((state) => ({
      apy: state.apy,
      id: state.reserve,
      liquidityMint: state.liquidityMint,
    })),
  ];
}

function selectBestPosition(args: {
  currentLiquidityMint: string;
  durationMs: number;
  positions: readonly Position[];
  value: number;
}): { position: Position; valueAfterSegment: number } {
  let bestPosition = args.positions[0];
  let bestValue = accrue(
    args.value *
      (1 -
        switchCostRate(args.currentLiquidityMint, bestPosition.liquidityMint)),
    bestPosition.apy,
    args.durationMs
  );

  for (const position of args.positions.slice(1)) {
    const valueAfterSwitch =
      args.value *
      (1 - switchCostRate(args.currentLiquidityMint, position.liquidityMint));
    const valueAfterSegment = accrue(
      valueAfterSwitch,
      position.apy,
      args.durationMs
    );
    if (valueAfterSegment > bestValue) {
      bestPosition = position;
      bestValue = valueAfterSegment;
    }
  }

  return {
    position: bestPosition,
    valueAfterSegment: Math.max(0, bestValue),
  };
}

function accrue(value: number, apy: number, durationMs: number): number {
  if (durationMs <= 0 || apy <= 0) {
    return value;
  }

  return value * (1 + apy) ** (durationMs / MS_PER_YEAR);
}

function simulateFeeAwareRouting(args: {
  rows: readonly EarnForecastReserveRow[];
  supportedReserves: readonly EarnForecastSupportedReserveRow[];
  windowEndedAt: Date;
  windowStartedAt: Date;
}): SimulationSample[] {
  const supportedByReserve = new Map(
    args.supportedReserves
      .filter(isSupportedStableReserve)
      .map((supported) => [supported.reserve, supported])
  );
  const rows = [...args.rows].sort(
    (a, b) =>
      a.observedAt.getTime() - b.observedAt.getTime() ||
      a.reserve.localeCompare(b.reserve)
  );

  const observedDates = rows
    .filter((row) => row.observedAt >= args.windowStartedAt)
    .map((row) => row.observedAt);
  const segmentDates = uniqueSortedDates([
    args.windowStartedAt,
    ...observedDates,
    args.windowEndedAt,
  ]).filter(
    (date) =>
      date.getTime() >= args.windowStartedAt.getTime() &&
      date.getTime() <= args.windowEndedAt.getTime()
  );
  const stateByReserve = new Map<string, ReserveState>();
  const samples: SimulationSample[] = [
    { observedAt: args.windowStartedAt, value: 1 },
  ];
  let currentLiquidityMint = USDC_MINT;
  let value = 1;
  let nextRowIndex = 0;

  for (let index = 0; index < segmentDates.length - 1; index += 1) {
    const observedAt = segmentDates[index];
    const nextObservedAt = segmentDates[index + 1];

    while (
      nextRowIndex < rows.length &&
      rows[nextRowIndex].observedAt.getTime() <= observedAt.getTime()
    ) {
      const row = rows[nextRowIndex];
      if (isEligibleReserveRow(row, supportedByReserve)) {
        const current = stateByReserve.get(row.reserve);
        if (!current || row.observedAt >= current.observedAt) {
          stateByReserve.set(row.reserve, {
            apy: row.supplyApy,
            liquidityMint: row.liquidityMint,
            observedAt: row.observedAt,
            reserve: row.reserve,
          });
        }
      } else if (candidateIsLatest(row, stateByReserve.get(row.reserve))) {
        stateByReserve.delete(row.reserve);
      }
      nextRowIndex += 1;
    }

    const durationMs = nextObservedAt.getTime() - observedAt.getTime();
    const { position, valueAfterSegment } = selectBestPosition({
      currentLiquidityMint,
      durationMs,
      positions: positionsFromState(stateByReserve),
      value,
    });
    value = valueAfterSegment;
    currentLiquidityMint = position.liquidityMint;
    samples.push({ observedAt: nextObservedAt, value });
  }

  return samples;
}

function candidateIsLatest(
  row: EarnForecastReserveRow,
  current: ReserveState | undefined
): boolean {
  return !current || row.observedAt >= current.observedAt;
}

function bucketHourlyHistorySamples(
  samples: EarnForecastApyHistoryResponse["samples"]
): EarnForecastApyHistoryResponse["samples"] {
  if (samples.length <= 1) {
    return samples;
  }

  const buckets = new Map<
    number,
    EarnForecastApyHistoryResponse["samples"][number]
  >();

  for (const sample of samples) {
    const observedAtMs = Date.parse(sample.observedAt);
    if (!Number.isFinite(observedAtMs)) {
      continue;
    }

    buckets.set(
      Math.floor(observedAtMs / HISTORY_SAMPLE_INTERVAL_MS) *
        HISTORY_SAMPLE_INTERVAL_MS,
      sample
    );
  }

  const lastSample = samples[samples.length - 1];
  const lastObservedAtMs = Date.parse(lastSample.observedAt);
  if (Number.isFinite(lastObservedAtMs)) {
    buckets.set(
      Math.floor(lastObservedAtMs / HISTORY_SAMPLE_INTERVAL_MS) *
        HISTORY_SAMPLE_INTERVAL_MS,
      lastSample
    );
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, sample]) => sample);
}

export function timescaleReserveApySamplesToEarnHistorySamples(
  rows: readonly TimescaleReserveApySample[],
  args: {
    windowEndedAt: Date;
    windowStartedAt: Date;
  }
): EarnForecastApyHistoryResponse["samples"] {
  const sortedRows = [...rows]
    .filter((row) => Number.isFinite(row.supplyApy))
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const windowStartedAtMs = args.windowStartedAt.getTime();
  const windowEndedAtMs = args.windowEndedAt.getTime();
  const seedRow = sortedRows
    .filter((row) => row.observedAt.getTime() <= windowStartedAtMs)
    .at(-1);
  const inWindowRows = sortedRows.filter((row) => {
    const observedAtMs = row.observedAt.getTime();
    return observedAtMs > windowStartedAtMs && observedAtMs <= windowEndedAtMs;
  });
  const outputDates = uniqueSortedDates([
    ...inWindowRows.map((row) => row.observedAt),
    args.windowEndedAt,
  ]);
  const samples: EarnForecastApyHistoryResponse["samples"] = [];
  let currentApy = seedRow?.supplyApy ?? 0;
  let nextRowIndex = 0;
  let previousObservedAtMs = windowStartedAtMs;
  let value = 1;

  for (const observedAt of outputDates) {
    const observedAtMs = observedAt.getTime();
    value = accrue(value, currentApy, observedAtMs - previousObservedAtMs);
    previousObservedAtMs = observedAtMs;

    while (
      nextRowIndex < inWindowRows.length &&
      inWindowRows[nextRowIndex].observedAt.getTime() <= observedAtMs
    ) {
      currentApy = inWindowRows[nextRowIndex].supplyApy;
      nextRowIndex += 1;
    }

    samples.push({
      apyBps: Math.max(
        0,
        toBps(annualizeReturn(value, observedAtMs - windowStartedAtMs))
      ),
      observedAt: observedAt.toISOString(),
    });
  }

  return bucketHourlyHistorySamples(samples);
}

function withEarnForecastSeries(args: {
  forecast: MediumFeeAwareEarnForecastResult;
  mainUsdcReserveSamples: EarnForecastApyHistoryResponse["samples"];
}): MediumFeeAwareEarnForecastResult {
  return {
    history: {
      ...args.forecast.history,
      series: [
        {
          key: "loyal",
          label: "Loyal Earn",
          metadata: {
            metric: "cumulative_annualized_apy_bps",
          },
          samples: args.forecast.history.samples,
        },
        {
          key: "mainUsdcReserve",
          label: "Kamino Main USDC",
          metadata: {
            liquidityMint: KAMINO_MAIN_MARKET_USDC_MINT,
            market: KAMINO_MAIN_MARKET,
            metric: "cumulative_annualized_apy_bps",
            reserve: KAMINO_MAIN_MARKET_USDC_RESERVE,
          },
          samples: args.mainUsdcReserveSamples,
        },
      ],
    },
    summary: args.forecast.summary,
  };
}

export function computeMediumFeeAwareEarnForecast(
  args: {
    rows: readonly EarnForecastReserveRow[];
    supportedReserves: readonly EarnForecastSupportedReserveRow[];
  },
  now = new Date()
): MediumFeeAwareEarnForecastResult | null {
  const windowEndedAt = now;
  const windowStartedAt = new Date(now.getTime() - DEFAULT_WINDOW_MS);
  const supportedReserves = args.supportedReserves.filter(
    isSupportedStableReserve
  );
  const supportedByReserve = new Map(
    supportedReserves.map((supported) => [supported.reserve, supported])
  );
  const eligibleRows = args.rows.filter((row) =>
    isEligibleReserveRow(row, supportedByReserve)
  );

  if (supportedReserves.length === 0 || eligibleRows.length === 0) {
    return null;
  }

  const simulationSamples = simulateFeeAwareRouting({
    rows: args.rows,
    supportedReserves,
    windowEndedAt,
    windowStartedAt,
  });
  const historySamples = simulationSamples
    .filter((sample) => sample.observedAt > windowStartedAt)
    .map((sample) => ({
      apyBps: Math.max(
        0,
        toBps(
          annualizeReturn(
            sample.value,
            sample.observedAt.getTime() - windowStartedAt.getTime()
          )
        )
      ),
      observedAt: sample.observedAt.toISOString(),
    }));
  const chartSamples = bucketHourlyHistorySamples(historySamples);
  const finalValue =
    simulationSamples[simulationSamples.length - 1]?.value ?? 1;
  const apyBps = Math.max(
    0,
    toBps(annualizeReturn(finalValue, DEFAULT_WINDOW_MS))
  );
  const sampleBps = historySamples.map((sample) => sample.apyBps);

  return {
    history: {
      feeBps: CROSS_MINT_FEE_BPS,
      generatedAt: now.toISOString(),
      riskProfile: MEDIUM_RISK_PROFILE,
      samples: chartSamples,
      window: {
        endedAt: windowEndedAt.toISOString(),
        startedAt: windowStartedAt.toISOString(),
      },
    },
    summary: {
      apyBps,
      rangeHighBps:
        sampleBps.length > 0
          ? Math.max(apyBps, quantile(sampleBps, 0.75))
          : apyBps,
      rangeLowBps:
        sampleBps.length > 0
          ? Math.min(apyBps, quantile(sampleBps, 0.25))
          : apyBps,
      strategy: MEDIUM_FEE_AWARE_STRATEGY,
      updatedAt: now.toISOString(),
      window: {
        endedAt: windowEndedAt.toISOString(),
        startedAt: windowStartedAt.toISOString(),
      },
    },
  };
}

function resolveEarnForecastCluster(): string {
  const cluster = process.env[SOLANA_ENV_ENV_NAME];
  if (cluster === "devnet" || cluster === "localnet") {
    return cluster;
  }
  return "mainnet-beta";
}

function getTimescaleDatabaseUrl(): string | null {
  return process.env.TIMESCALEDB_URL ?? null;
}

function fallbackResult(now: Date): MediumFeeAwareEarnForecastResult {
  return {
    history: {
      feeBps: CROSS_MINT_FEE_BPS,
      generatedAt: now.toISOString(),
      riskProfile: MEDIUM_RISK_PROFILE,
      samples: [],
      series: [
        {
          key: "loyal",
          label: "Loyal Earn",
          metadata: {
            metric: "cumulative_annualized_apy_bps",
          },
          samples: [],
        },
        {
          key: "mainUsdcReserve",
          label: "Kamino Main USDC",
          metadata: {
            liquidityMint: KAMINO_MAIN_MARKET_USDC_MINT,
            market: KAMINO_MAIN_MARKET,
            metric: "cumulative_annualized_apy_bps",
            reserve: KAMINO_MAIN_MARKET_USDC_RESERVE,
          },
          samples: [],
        },
      ],
      window: FALLBACK_EARN_FORECAST.window,
    },
    summary: FALLBACK_EARN_FORECAST,
  };
}

export function resetEarnForecastCacheForTests() {
  cache = null;
}

export async function getMediumFeeAwareEarnForecastFromClient(
  client: EarnForecastTimescaleClient,
  now = new Date()
): Promise<MediumFeeAwareEarnForecastResult> {
  try {
    const windowStartedAt = new Date(now.getTime() - DEFAULT_WINDOW_MS);
    const supportedReserves = await client.getMediumStableSupportedReserves();
    const [rows, mainUsdcReserveRows] = await Promise.all([
      client.getReserveUpdatesWithSeedRows({
        end: now,
        reserves: supportedReserves.map((reserve) => reserve.reserve),
        start: windowStartedAt,
      }),
      client.getReserveApyHistorySamples({
        end: now,
        reserve: KAMINO_MAIN_MARKET_USDC_RESERVE,
        sampleIntervalSeconds: HISTORY_SAMPLE_INTERVAL_MS / 1000,
        start: windowStartedAt,
      }),
    ]);
    const forecast =
      computeMediumFeeAwareEarnForecast({ rows, supportedReserves }, now) ??
      fallbackResult(now);

    return withEarnForecastSeries({
      forecast,
      mainUsdcReserveSamples: timescaleReserveApySamplesToEarnHistorySamples(
        mainUsdcReserveRows,
        {
          windowEndedAt: now,
          windowStartedAt,
        }
      ),
    });
  } catch (error) {
    console.warn("[earn-forecast] failed to load Timescale forecast", error);
    return fallbackResult(now);
  } finally {
    await client.close().catch((error) => {
      console.warn("[earn-forecast] failed to close Timescale client", error);
    });
  }
}

async function getPersistedMediumFeeAwareEarnForecast(): Promise<MediumFeeAwareEarnForecastResult | null> {
  try {
    try {
      const hourly = await getLatestEarnApyHourlyForecast({
        cluster: resolveEarnForecastCluster(),
        feeBps: CROSS_MINT_FEE_BPS,
        riskProfile: SAFE_RISK_PROFILE,
        strategy: SAFE_FEE_AWARE_STRATEGY,
      });
      if (hourly) {
        return hourly;
      }
    } catch (error) {
      console.warn(
        "[earn-forecast] failed to load hourly persisted snapshot",
        error
      );
    }

    const snapshot = await getLatestEarnForecastSnapshot({
      cluster: resolveEarnForecastCluster(),
      feeBps: CROSS_MINT_FEE_BPS,
      riskProfile: MEDIUM_RISK_PROFILE,
      strategy: MEDIUM_FEE_AWARE_STRATEGY,
    });

    return snapshot ? snapshotRecordToEarnForecast(snapshot) : null;
  } catch (error) {
    console.warn("[earn-forecast] failed to load persisted snapshot", error);
    return null;
  }
}

async function persistMediumFeeAwareEarnForecast(
  forecast: MediumFeeAwareEarnForecastResult
): Promise<void> {
  if (forecast.summary.strategy !== MEDIUM_FEE_AWARE_STRATEGY) {
    return;
  }
  const hasLoyalSamples = forecast.history.samples.length > 0;
  const hasMainUsdcReserveSamples =
    forecast.history.series?.some(
      (series) => series.key === "mainUsdcReserve" && series.samples.length > 0
    ) ?? false;
  if (!hasLoyalSamples || !hasMainUsdcReserveSamples) {
    return;
  }

  try {
    await upsertEarnForecastSnapshot(
      toEarnForecastSnapshotInput({
        cluster: resolveEarnForecastCluster(),
        forecast,
      })
    );
  } catch (error) {
    console.warn("[earn-forecast] failed to persist snapshot", error);
  }
}

export async function refreshMediumFeeAwareEarnForecastSnapshot(
  now = new Date()
): Promise<{
  forecast: MediumFeeAwareEarnForecastResult;
  generatedAt: string;
  insertedOrUpdated: boolean;
  sampleCount: number;
  loyalSampleCount: number;
  mainUsdcReserveSampleCount: number;
}> {
  const databaseUrl = getTimescaleDatabaseUrl();
  const forecast = databaseUrl
    ? await getMediumFeeAwareEarnForecastFromClient(
        new TimescaleReserveClient({ databaseUrl, maxConnections: 1 }),
        now
      )
    : fallbackResult(now);

  await persistMediumFeeAwareEarnForecast(forecast);
  cache = { expiresAt: now.getTime() + CACHE_TTL_MS, value: forecast };

  return {
    forecast,
    generatedAt: forecast.history.generatedAt,
    insertedOrUpdated:
      forecast.summary.strategy === MEDIUM_FEE_AWARE_STRATEGY &&
      forecast.history.samples.length > 0 &&
      (forecast.history.series?.some(
        (series) =>
          series.key === "mainUsdcReserve" && series.samples.length > 0
      ) ??
        false),
    loyalSampleCount: forecast.history.samples.length,
    mainUsdcReserveSampleCount:
      forecast.history.series?.find(
        (series) => series.key === "mainUsdcReserve"
      )?.samples.length ?? 0,
    sampleCount: forecast.history.samples.length,
  };
}

export async function getMediumFeeAwareEarnForecast(
  now = new Date()
): Promise<MediumFeeAwareEarnForecastResult> {
  if (cache && cache.expiresAt > now.getTime()) {
    return cache.value;
  }

  const persisted = await getPersistedMediumFeeAwareEarnForecast();
  if (persisted) {
    cache = { expiresAt: now.getTime() + CACHE_TTL_MS, value: persisted };
    return persisted;
  }

  const databaseUrl = getTimescaleDatabaseUrl();
  if (!databaseUrl) {
    const value = fallbackResult(now);
    cache = {
      expiresAt: now.getTime() + CACHE_TTL_MS,
      value,
    };
    return value;
  }

  const client = new TimescaleReserveClient({ databaseUrl, maxConnections: 1 });
  const value = await getMediumFeeAwareEarnForecastFromClient(client, now);
  await persistMediumFeeAwareEarnForecast(value);
  cache = { expiresAt: now.getTime() + CACHE_TTL_MS, value };

  return value;
}
