import "server-only";

import {
  computeRealizedApy,
  type EarnAllocationHistory,
  REALIZED_WINDOW_MS,
  type RealizedApyResult,
  SERIES_WINDOW_MS,
  type SharePricePoint,
} from "./earn-realized-apy.shared";
import {
  hasEarnSharePriceHistory,
  loadEarnAllocationHistory,
  loadReserveSharePriceHistories,
} from "./earn-reserve-share-price-repository.server";
import {
  FALLBACK_EARN_FORECAST,
  type EarnForecastApyHistoryResponse,
  type EarnForecastResponse,
} from "./earn-forecast.shared";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";

const CACHE_TTL_MS = 5 * 60 * 1000;
const CROSS_MINT_FEE_BPS = 1;
// Extra lookback so the point just before the first series hour's window
// start is not dropped, which would null the first realized-series sample(s).
const HISTORY_LOOKBACK_SLACK_MS = 2 * 60 * 60 * 1000;
// Diagnostic-only threshold for the "realized APY unavailable" warning below;
// mirrors computeRealizedApy's own staleness cutoff so the log reports the
// same reserves it silently excluded.
const REALIZED_APY_STALE_LOG_THRESHOLD_MS = 3 * 60 * 60 * 1000;
export const KAMINO_MAIN_MARKET =
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
export const KAMINO_MAIN_MARKET_USDC_RESERVE =
  "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";
export const KAMINO_MAIN_MARKET_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const REALIZED_STRATEGY = "realized_7d_share_price";
const REALIZED_METRIC = "realized_7d_apy_bps";
const SAFE_RISK_PROFILE = "safe";
const MEDIUM_RISK_PROFILE = "medium";

export type MediumFeeAwareEarnForecastResult = {
  history: EarnForecastApyHistoryResponse;
  summary: EarnForecastResponse;
};

let cache: {
  expiresAt: number;
  value: MediumFeeAwareEarnForecastResult;
} | null = null;
let lastRealized: MediumFeeAwareEarnForecastResult | null = null;

function resolveEarnForecastCluster(): string {
  return resolveLoyalWebSolanaEnvFromEnv(process.env) === "devnet"
    ? "devnet"
    : "mainnet-beta";
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
  lastRealized = null;
}

export type RealizedEarnForecastDependencies = {
  cluster: string;
  hasRecentPrices?: (sinceMs: number) => Promise<boolean>;
  loadAllocations: (
    sinceMs: number,
    nowMs: number
  ) => Promise<EarnAllocationHistory>;
  loadHistories: (
    reserves: string[],
    sinceMs: number
  ) => Promise<Map<string, SharePricePoint[]>>;
};

function createRealizedDependencies(): RealizedEarnForecastDependencies {
  const cluster = resolveEarnForecastCluster();
  return {
    cluster,
    hasRecentPrices: (sinceMs) => hasEarnSharePriceHistory(cluster, sinceMs),
    loadAllocations: (sinceMs, nowMs) =>
      loadEarnAllocationHistory(cluster, sinceMs, nowMs),
    loadHistories: (reserves, sinceMs) =>
      loadReserveSharePriceHistories(cluster, reserves, sinceMs),
  };
}

function realizedResultToForecast(
  result: RealizedApyResult,
  now: Date
): MediumFeeAwareEarnForecastResult {
  const window = {
    endedAt: new Date(result.measuredAtMs).toISOString(),
    startedAt: result.loyalSeries[0]?.observedAt ?? now.toISOString(),
  };
  const seriesBps = result.loyalSeries.map((sample) => sample.apyBps);

  return {
    history: {
      feeBps: CROSS_MINT_FEE_BPS,
      generatedAt: now.toISOString(),
      riskProfile: SAFE_RISK_PROFILE,
      samples: result.loyalSeries,
      series: [
        {
          key: "loyal",
          label: "Loyal Earn",
          metadata: { metric: REALIZED_METRIC },
          samples: result.loyalSeries,
        },
        {
          key: "mainUsdcReserve",
          label: "Kamino Main USDC",
          metadata: {
            liquidityMint: KAMINO_MAIN_MARKET_USDC_MINT,
            market: KAMINO_MAIN_MARKET,
            metric: REALIZED_METRIC,
            reserve: KAMINO_MAIN_MARKET_USDC_RESERVE,
          },
          samples: result.mainUsdcReserveSeries,
        },
      ],
      window,
    },
    summary: {
      apyBps: result.headlineBps,
      availability: "available",
      rangeHighBps: Math.max(result.headlineBps, ...seriesBps),
      rangeLowBps: Math.min(result.headlineBps, ...seriesBps),
      source: result.source,
      strategy: REALIZED_STRATEGY,
      updatedAt: new Date(result.measuredAtMs).toISOString(),
      window,
    },
  };
}

export async function getRealizedEarnForecastFromDependencies(
  deps: RealizedEarnForecastDependencies,
  now = new Date()
): Promise<MediumFeeAwareEarnForecastResult | null> {
  const sinceMs =
    now.getTime() -
    SERIES_WINDOW_MS -
    REALIZED_WINDOW_MS -
    HISTORY_LOOKBACK_SLACK_MS;
  if (deps.hasRecentPrices && !(await deps.hasRecentPrices(sinceMs))) {
    return null;
  }
  const allocations = await deps.loadAllocations(sinceMs, now.getTime());
  const reserves = [
    ...new Set([
      ...allocations.snapshots.flatMap((snapshot) => [
        ...snapshot.weights.keys(),
      ]),
      KAMINO_MAIN_MARKET_USDC_RESERVE,
    ]),
  ];
  const histories = await deps.loadHistories(reserves, sinceMs);
  const result = computeRealizedApy({
    benchmarkReserve: KAMINO_MAIN_MARKET_USDC_RESERVE,
    allocations,
    histories,
    nowMs: now.getTime(),
  });
  if (!result) {
    const nowMs = now.getTime();
    const latestWeights = allocations.snapshots.at(-1)?.weights ?? new Map();
    const staleOrMissingReserves = [...latestWeights.keys()].filter(
      (reserve) => {
        const points = histories.get(reserve);
        const latest = points?.[points.length - 1];
        return (
          !latest ||
          nowMs - latest.observedAtMs > REALIZED_APY_STALE_LOG_THRESHOLD_MS
        );
      }
    );
    console.warn("[earn-forecast] realized APY unavailable", {
      staleOrMissingReserves,
      weightedReserveCount: latestWeights.size,
    });
    return null;
  }
  return realizedResultToForecast(result, now);
}

export async function getMediumFeeAwareEarnForecast(
  now = new Date(),
  deps: RealizedEarnForecastDependencies = createRealizedDependencies()
): Promise<MediumFeeAwareEarnForecastResult> {
  if (cache && cache.expiresAt > now.getTime()) {
    return cache.value;
  }

  let realized: MediumFeeAwareEarnForecastResult | null = null;
  try {
    realized = await getRealizedEarnForecastFromDependencies(deps, now);
  } catch (error) {
    console.warn("[earn-forecast] realized APY read failed", error);
  }
  if (realized) {
    lastRealized = realized;
  }

  const recentLastRealized =
    lastRealized &&
    now.getTime() - Date.parse(lastRealized.summary.updatedAt) <=
      REALIZED_APY_STALE_LOG_THRESHOLD_MS
      ? lastRealized
      : null;
  const value =
    realized ??
    (recentLastRealized
      ? {
          ...recentLastRealized,
          summary: {
            ...recentLastRealized.summary,
            availability: "stale" as const,
          },
        }
      : fallbackResult(now));
  const remainingFreshMs =
    value.summary.availability === "unavailable"
      ? CACHE_TTL_MS
      : Math.max(
          0,
          REALIZED_APY_STALE_LOG_THRESHOLD_MS -
            (now.getTime() - Date.parse(value.summary.updatedAt))
        );
  cache = {
    expiresAt: now.getTime() + Math.min(CACHE_TTL_MS, remainingFreshMs),
    value,
  };
  return value;
}
