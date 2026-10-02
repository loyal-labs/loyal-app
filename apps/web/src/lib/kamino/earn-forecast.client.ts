"use client";

import {
  readClientCacheEntry,
  writeClientCache,
} from "@/lib/client-cache/client-cache";

import {
  FALLBACK_EARN_FORECAST,
  type EarnForecastApy,
  type EarnForecastApyHistoryResponse,
  type EarnForecastSummaryResponse,
} from "./earn-forecast.shared";

// APY forecasts move over hours; a 30-minute window is invisible in the UI.
const CLIENT_CACHE_TTL_MS = 30 * 60 * 1000;
// Retry failed loads sooner so a transient outage doesn't pin the fallback.
const ERROR_CACHE_TTL_MS = 5 * 60 * 1000;
const PERSIST_TTL_MS = 24 * 60 * 60 * 1000;
export const REALIZED_MAX_AGE_MS = 3 * 60 * 60 * 1000;

const EARN_FORECAST_CACHE_KEY = "loyal.earnForecastSummary.v2";
const EARN_FORECAST_CACHE_VERSION = 2;
// The forecast route reads cluster-scoped data; NEXT_PUBLIC_SOLANA_ENV is
// inlined at build time, so this statically resolves per deployment.
const EARN_FORECAST_CACHE_SCOPE =
  process.env.NEXT_PUBLIC_SOLANA_ENV ?? "mainnet";

function isEarnForecastSummaryResponse(
  data: unknown
): data is EarnForecastSummaryResponse {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const candidate = data as EarnForecastSummaryResponse;
  return (
    typeof candidate.forecast === "object" &&
    candidate.forecast !== null &&
    typeof candidate.forecast.apyBps === "number" &&
    typeof candidate.history === "object" &&
    candidate.history !== null &&
    Array.isArray(candidate.history.samples)
  );
}

function readPersistedEarnForecastSummary() {
  return readClientCacheEntry<EarnForecastSummaryResponse>({
    key: EARN_FORECAST_CACHE_KEY,
    version: EARN_FORECAST_CACHE_VERSION,
    solanaEnv: EARN_FORECAST_CACHE_SCOPE,
    validate: isEarnForecastSummaryResponse,
  });
}

export const FALLBACK_EARN_APY = {
  apyBps: FALLBACK_EARN_FORECAST.apyBps,
  availability: "unavailable",
  rangeHighBps: FALLBACK_EARN_FORECAST.rangeHighBps,
  rangeLowBps: FALLBACK_EARN_FORECAST.rangeLowBps,
} as const satisfies EarnForecastApy;

export const EMPTY_EARN_FORECAST_HISTORY: EarnForecastApyHistoryResponse = {
  feeBps: 1,
  generatedAt: "2026-06-01T00:00:00.000Z",
  riskProfile: "safe",
  samples: [],
  window: {
    endedAt: "2026-06-01T00:00:00.000Z",
    startedAt: "2026-05-02T00:00:00.000Z",
  },
};

const FALLBACK_SUMMARY: EarnForecastSummaryResponse = {
  forecast: FALLBACK_EARN_FORECAST,
  history: EMPTY_EARN_FORECAST_HISTORY,
};

let cachedSummary: {
  expiresAt: number;
  value: EarnForecastSummaryResponse;
} | null = null;
let inflightSummary: Promise<EarnForecastSummaryResponse> | null = null;

export function toForecastApy(
  payload: EarnForecastSummaryResponse["forecast"]
): EarnForecastApy {
  const expired =
    payload.strategy === "realized_7d_share_price" &&
    (!Number.isFinite(Date.parse(payload.updatedAt)) ||
      Date.now() - Date.parse(payload.updatedAt) >= REALIZED_MAX_AGE_MS);
  return {
    apyBps: payload.apyBps,
    availability: expired
      ? "unavailable"
      : payload.availability ??
        (payload.strategy === "safe_no_fees" ? "unavailable" : "available"),
    rangeHighBps: payload.rangeHighBps,
    rangeLowBps: payload.rangeLowBps,
  };
}

function validCachedSummary(
  summary: EarnForecastSummaryResponse,
  now: number,
  allowUnavailable = false
): boolean {
  if (summary.forecast.availability === "unavailable" && !allowUnavailable) {
    return false;
  }
  if (summary.forecast.strategy !== "realized_7d_share_price") {
    return true;
  }
  const measuredAt = Date.parse(summary.forecast.updatedAt);
  return Number.isFinite(measuredAt) && now - measuredAt < REALIZED_MAX_AGE_MS;
}

export async function fetchEarnForecastSummary(): Promise<EarnForecastSummaryResponse> {
  const now = Date.now();
  if (
    cachedSummary &&
    cachedSummary.expiresAt > now &&
    validCachedSummary(cachedSummary.value, now, true)
  ) {
    return cachedSummary.value;
  }

  if (inflightSummary) {
    return inflightSummary;
  }

  const persisted = readPersistedEarnForecastSummary();
  if (
    persisted &&
    now - persisted.savedAt < CLIENT_CACHE_TTL_MS &&
    validCachedSummary(persisted.data, now)
  ) {
    cachedSummary = {
      expiresAt: persisted.savedAt + CLIENT_CACHE_TTL_MS,
      value: persisted.data,
    };
    return persisted.data;
  }

  inflightSummary = fetch("/api/smart-accounts/earn-forecast/summary", {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Earn forecast summary request failed: ${response.status}`
        );
      }

      return (await response.json()) as EarnForecastSummaryResponse;
    })
    .then((summary) => {
      const receivedAt = Date.now();
      const remainingMs =
        summary.forecast.availability === "unavailable"
          ? ERROR_CACHE_TTL_MS
          : summary.forecast.strategy === "realized_7d_share_price"
          ? REALIZED_MAX_AGE_MS -
            (receivedAt - Date.parse(summary.forecast.updatedAt))
          : CLIENT_CACHE_TTL_MS;
      cachedSummary = {
        expiresAt:
          receivedAt + Math.max(0, Math.min(CLIENT_CACHE_TTL_MS, remainingMs)),
        value: summary,
      };
      if (summary.forecast.availability !== "unavailable") {
        writeClientCache({
          key: EARN_FORECAST_CACHE_KEY,
          version: EARN_FORECAST_CACHE_VERSION,
          solanaEnv: EARN_FORECAST_CACHE_SCOPE,
          data: summary,
          ttlMs: PERSIST_TTL_MS,
        });
      }
      return summary;
    })
    .catch((error) => {
      console.warn("[earn-forecast] failed to load summary", error);
      // Prefer day-old real data over the hardcoded fallback; never persist
      // either fallback path.
      const value =
        persisted && validCachedSummary(persisted.data, Date.now())
          ? persisted.data
          : FALLBACK_SUMMARY;
      cachedSummary = {
        expiresAt: Date.now() + ERROR_CACHE_TTL_MS,
        value,
      };
      return value;
    })
    .finally(() => {
      inflightSummary = null;
    });

  return inflightSummary;
}

export function getCachedEarnForecastSummaryForTests() {
  return cachedSummary?.value ?? null;
}

export function resetEarnForecastSummaryCacheForTests() {
  cachedSummary = null;
  inflightSummary = null;
}
