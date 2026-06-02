import "server-only";

import {
  FALLBACK_EARN_FORECAST,
  type EarnForecastResponse,
} from "./earn-forecast.shared";
import { TimescaleReserveClient } from "./timescale-reserve-client.server";
import type { TimescaleReserveUpdateRow } from "./timescale-reserve-client.server";

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const SAFE_EARN_MARKET_NAMES = [
  "Main",
  "Figure",
  "Maple",
  "OnRe",
  "Ethena",
] as const;

export const SAFE_EARN_STABLE_SYMBOLS = [
  "USDC",
  "USDT",
  "PYUSD",
  "USDS",
  "USDE",
  "SUSDE",
  "USDG",
  "USDY",
  "USD1",
  "FDUSD",
  "DAI",
] as const;

export type EarnForecastReserveRow = Pick<
  TimescaleReserveUpdateRow,
  | "market"
  | "marketName"
  | "observedAt"
  | "reserve"
  | "reserveLastUpdateStale"
  | "supplyApy"
  | "symbol"
  | "totalSupplyUsdEstimate"
>;

type WeightedPoint = {
  apy: number;
  durationMs: number;
};

export type EarnForecastTimescaleClient = {
  close: () => Promise<void>;
  getSafeNoFeeReserveUpdates: (args: {
    marketNames: readonly string[];
    stableSymbols: readonly string[];
    since: Date;
  }) => Promise<EarnForecastReserveRow[]>;
};

let cache:
  | {
      expiresAt: number;
      value: EarnForecastResponse;
    }
  | null = null;

function normalizeSymbol(symbol: string | null): string {
  return symbol?.trim().toUpperCase() ?? "";
}

function isSafeMarket(row: EarnForecastReserveRow): boolean {
  return SAFE_EARN_MARKET_NAMES.some(
    (marketName) => row.marketName === marketName || row.market === marketName
  );
}

function isStableSymbol(row: EarnForecastReserveRow): boolean {
  return SAFE_EARN_STABLE_SYMBOLS.includes(
    normalizeSymbol(row.symbol) as (typeof SAFE_EARN_STABLE_SYMBOLS)[number]
  );
}

function toBps(apy: number): number {
  return Math.round(apy * 10_000);
}

function weightedAverage(points: readonly WeightedPoint[]): number {
  const totalWeight = points.reduce((sum, point) => sum + point.durationMs, 0);
  if (totalWeight <= 0) {
    return 0;
  }

  return (
    points.reduce((sum, point) => sum + point.apy * point.durationMs, 0) /
    totalWeight
  );
}

function weightedQuantile(
  points: readonly WeightedPoint[],
  quantile: number
): number {
  const totalWeight = points.reduce((sum, point) => sum + point.durationMs, 0);
  if (totalWeight <= 0) {
    return 0;
  }

  const targetWeight = totalWeight * quantile;
  let cumulativeWeight = 0;

  for (const point of [...points].sort((a, b) => a.apy - b.apy)) {
    cumulativeWeight += point.durationMs;
    if (cumulativeWeight >= targetWeight) {
      return point.apy;
    }
  }

  return points[points.length - 1]?.apy ?? 0;
}

export function computeSafeNoFeeEarnForecast(
  rows: readonly EarnForecastReserveRow[],
  now = new Date()
): EarnForecastResponse | null {
  const eligibleRows = rows.filter(
    (row) =>
      row.reserveLastUpdateStale === false &&
      row.totalSupplyUsdEstimate > 100_000 &&
      row.supplyApy >= 0 &&
      row.supplyApy < 0.5 &&
      isSafeMarket(row) &&
      isStableSymbol(row)
  );

  if (eligibleRows.length === 0) {
    return null;
  }

  const bestByObservedAt = new Map<string, EarnForecastReserveRow>();
  for (const row of eligibleRows) {
    const observedAt = row.observedAt.toISOString();
    const current = bestByObservedAt.get(observedAt);
    if (!current || row.supplyApy > current.supplyApy) {
      bestByObservedAt.set(observedAt, row);
    }
  }

  const bestRows = [...bestByObservedAt.values()].sort(
    (a, b) => a.observedAt.getTime() - b.observedAt.getTime()
  );
  const windowStartedAt = bestRows[0].observedAt;
  const windowEndedAt = bestRows[bestRows.length - 1].observedAt;
  const weightedPoints = bestRows.map((row, index) => {
    const nextObservedAt = bestRows[index + 1]?.observedAt.getTime();
    const durationMs =
      nextObservedAt !== undefined
        ? nextObservedAt - row.observedAt.getTime()
        : Math.max(1, now.getTime() - row.observedAt.getTime());

    return {
      apy: row.supplyApy,
      durationMs: Math.max(1, durationMs),
    };
  });

  return {
    apyBps: toBps(weightedAverage(weightedPoints)),
    rangeHighBps: toBps(weightedQuantile(weightedPoints, 0.75)),
    rangeLowBps: toBps(weightedQuantile(weightedPoints, 0.25)),
    strategy: "safe_no_fees",
    updatedAt: now.toISOString(),
    window: {
      endedAt: windowEndedAt.toISOString(),
      startedAt: windowStartedAt.toISOString(),
    },
  };
}

function getTimescaleDatabaseUrl(): string | null {
  return (
    process.env.KAMINO_TIMESCALE_DATABASE_URL ??
    process.env.TIMESCALE_DATABASE_URL ??
    null
  );
}

export function resetEarnForecastCacheForTests() {
  cache = null;
}

export async function getSafeNoFeeEarnForecastFromClient(
  client: EarnForecastTimescaleClient,
  now = new Date()
): Promise<EarnForecastResponse> {
  try {
    const rows = await client.getSafeNoFeeReserveUpdates({
      marketNames: SAFE_EARN_MARKET_NAMES,
      stableSymbols: SAFE_EARN_STABLE_SYMBOLS,
      since: new Date(now.getTime() - DEFAULT_WINDOW_MS),
    });
    return computeSafeNoFeeEarnForecast(rows, now) ?? FALLBACK_EARN_FORECAST;
  } catch (error) {
    console.warn("[earn-forecast] failed to load Timescale forecast", error);
    return FALLBACK_EARN_FORECAST;
  } finally {
    await client.close().catch((error) => {
      console.warn("[earn-forecast] failed to close Timescale client", error);
    });
  }
}

export async function getSafeNoFeeEarnForecast(
  now = new Date()
): Promise<EarnForecastResponse> {
  if (cache && cache.expiresAt > now.getTime()) {
    return cache.value;
  }

  const databaseUrl = getTimescaleDatabaseUrl();
  if (!databaseUrl) {
    cache = {
      expiresAt: now.getTime() + CACHE_TTL_MS,
      value: FALLBACK_EARN_FORECAST,
    };
    return FALLBACK_EARN_FORECAST;
  }

  const client = new TimescaleReserveClient({ databaseUrl, maxConnections: 1 });
  const value = await getSafeNoFeeEarnForecastFromClient(client, now);
  cache = { expiresAt: now.getTime() + CACHE_TTL_MS, value };

  return value;
}
