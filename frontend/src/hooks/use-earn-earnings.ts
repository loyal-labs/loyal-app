"use client";

import { useCallback, useEffect, useState } from "react";

import {
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache/client-cache";
import {
  isServerVerifiedEarnEarningsPayload,
  type EarnEarningsRangeSetResponse,
} from "@/lib/yield-optimization/earnings.shared";

const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CACHE_KEY = "default";
const EARNINGS_EPSILON = 0.000000001;
const EARN_EARNINGS_CACHE_VERSION = 5;
const RETRY_DELAYS_MS = [250, 750] as const;

type EarnEarningsCacheEntry = {
  expiresAt: number;
  value: EarnEarningsRangeSetResponse;
};

export type EarnDisplayCachePayload = {
  currentApyBps: number | null;
  displayedAt: number;
  lastDepositAt: string | null;
  lifetimeEarnedUsd: number;
  principalAmountRaw: string;
  principalUsd: number;
  sinceLastDepositEarnedUsd: number;
};

type EarnEarningsCacheScope = {
  revalidationKey?: string | null;
  settingsPda?: string | null;
  solanaEnv?: string;
  walletAddress?: string | null;
  timezone?: string;
};

const cachedEarnings = new Map<string, EarnEarningsCacheEntry>();
const inflightEarnings = new Map<
  string,
  Promise<EarnEarningsRangeSetResponse>
>();
let cacheVersion = 0;

function summarizeEarningsPayload(payload: EarnEarningsRangeSetResponse): {
  earnedBarCount: number;
  lifetimeEarnedUsd: number;
  nonCurrentEarnedBarCount: number;
  nonCurrentEarnedUsd: number;
  principalAmountRaws: string[];
  rangeEarnedUsd: number;
  todayEarnedUsd: number;
} {
  const ranges = Object.values(payload.ranges);
  const bars = ranges.flatMap((range) =>
    Array.isArray(range.bars) ? range.bars : []
  );
  const earnedBars = bars.filter(
    (bar) => Number.isFinite(bar.earnedUsd) && bar.earnedUsd > EARNINGS_EPSILON
  );
  const nonCurrentEarnedBars = earnedBars.filter((bar) => !bar.isCurrent);
  return {
    earnedBarCount: earnedBars.length,
    lifetimeEarnedUsd: Math.max(
      0,
      ...ranges.map((range) =>
        Number.isFinite(range.lifetimeEarnedUsd) ? range.lifetimeEarnedUsd : 0
      )
    ),
    nonCurrentEarnedBarCount: nonCurrentEarnedBars.length,
    nonCurrentEarnedUsd: nonCurrentEarnedBars.reduce(
      (sum, bar) => sum + Math.max(0, bar.earnedUsd),
      0
    ),
    principalAmountRaws: Array.from(
      new Set(ranges.map((range) => range.principalAmountRaw))
    ),
    rangeEarnedUsd: Math.max(
      0,
      ...ranges.map((range) =>
        Number.isFinite(range.rangeEarnedUsd) ? range.rangeEarnedUsd : 0
      )
    ),
    todayEarnedUsd: Math.max(
      0,
      ...ranges.map((range) =>
        Number.isFinite(range.todayEarnedUsd) ? range.todayEarnedUsd : 0
      )
    ),
  };
}

function hasRicherHistoricalEarningsBars(args: {
  fresh: ReturnType<typeof summarizeEarningsPayload>;
  stale: ReturnType<typeof summarizeEarningsPayload>;
}): boolean {
  return (
    args.fresh.nonCurrentEarnedUsd >
      args.stale.nonCurrentEarnedUsd + EARNINGS_EPSILON ||
    args.fresh.nonCurrentEarnedBarCount > args.stale.nonCurrentEarnedBarCount ||
    (args.fresh.earnedBarCount > args.stale.earnedBarCount &&
      args.fresh.nonCurrentEarnedBarCount > 0)
  );
}

function isRegressiveEarningsPayload(args: {
  fresh: EarnEarningsRangeSetResponse;
  stale: EarnEarningsRangeSetResponse | null;
}): boolean {
  if (!args.stale) {
    return false;
  }

  const stale = summarizeEarningsPayload(args.stale);
  const fresh = summarizeEarningsPayload(args.fresh);

  if (hasRicherHistoricalEarningsBars({ fresh, stale })) {
    return false;
  }

  return (
    fresh.lifetimeEarnedUsd + EARNINGS_EPSILON < stale.lifetimeEarnedUsd ||
    fresh.rangeEarnedUsd + EARNINGS_EPSILON < stale.rangeEarnedUsd ||
    fresh.todayEarnedUsd + EARNINGS_EPSILON < stale.todayEarnedUsd
  );
}

function isEqualRecordedEarningsWithNewerTimestamp(args: {
  fresh: EarnEarningsRangeSetResponse;
  stale: EarnEarningsRangeSetResponse | null;
}): boolean {
  if (!args.stale) {
    return false;
  }

  const stale = summarizeEarningsPayload(args.stale);
  const fresh = summarizeEarningsPayload(args.fresh);
  const staleGeneratedAt = Date.parse(args.stale.generatedAt);
  const freshGeneratedAt = Date.parse(args.fresh.generatedAt);

  if (
    !Number.isFinite(staleGeneratedAt) ||
    !Number.isFinite(freshGeneratedAt) ||
    freshGeneratedAt <= staleGeneratedAt
  ) {
    return false;
  }

  if (hasRicherHistoricalEarningsBars({ fresh, stale })) {
    return false;
  }

  return (
    fresh.lifetimeEarnedUsd <= stale.lifetimeEarnedUsd + EARNINGS_EPSILON &&
    fresh.rangeEarnedUsd <= stale.rangeEarnedUsd + EARNINGS_EPSILON &&
    fresh.todayEarnedUsd <= stale.todayEarnedUsd + EARNINGS_EPSILON
  );
}

function getPersistentEarnEarningsCacheKey(cacheKey: string): string {
  return ["loyal", "earn-earnings", EARN_EARNINGS_CACHE_VERSION, cacheKey].join(
    ":"
  );
}

function markPayloadStale(
  payload: EarnEarningsRangeSetResponse,
  staleReason: string
): EarnEarningsRangeSetResponse {
  const generatedAtMs = Date.parse(payload.generatedAt);
  return {
    ...payload,
    freshness: "stale",
    snapshotAgeMs: Number.isFinite(generatedAtMs)
      ? Math.max(0, Date.now() - generatedAtMs)
      : null,
    staleReason,
  };
}

class EarnEarningsRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "EarnEarningsRequestError";
    this.retryable = retryable;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function requestEarnEarnings(timezone: string) {
  const url = new URL(
    "/api/smart-accounts/yield-optimization/earnings",
    window.location.origin
  );
  url.searchParams.set("timezone", timezone);
  const response = await fetch(url.toString(), {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    throw new EarnEarningsRequestError(
      `Earn earnings request failed: ${response.status}`,
      response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
    );
  }
  const payload: unknown = await response.json();
  if (!isServerVerifiedEarnEarningsPayload(payload)) {
    throw new EarnEarningsRequestError(
      "Earn earnings response was not server-verified.",
      false
    );
  }
  return payload;
}

async function requestEarnEarningsWithRetry(timezone: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await requestEarnEarnings(timezone);
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof EarnEarningsRequestError) ||
        !error.retryable ||
        attempt === RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

function readPersistentEarnEarningsCache(
  cacheKey: string,
  scope: EarnEarningsCacheScope
): EarnEarningsRangeSetResponse | null {
  if (!scope.solanaEnv) {
    return null;
  }

  const key = getPersistentEarnEarningsCacheKey(cacheKey);
  const payload = readClientCache<EarnEarningsRangeSetResponse>({
    key,
    version: EARN_EARNINGS_CACHE_VERSION,
    solanaEnv: scope.solanaEnv,
    walletAddress: scope.walletAddress,
    settingsPda: scope.settingsPda,
    validate: isServerVerifiedEarnEarningsPayload,
  });

  if (!payload) {
    return null;
  }

  return payload;
}

function writePersistentEarnEarningsCache(
  cacheKey: string,
  scope: EarnEarningsCacheScope,
  payload: EarnEarningsRangeSetResponse
) {
  if (!scope.solanaEnv) {
    return;
  }

  writeClientCache<EarnEarningsRangeSetResponse>({
    key: getPersistentEarnEarningsCacheKey(cacheKey),
    version: EARN_EARNINGS_CACHE_VERSION,
    solanaEnv: scope.solanaEnv,
    walletAddress: scope.walletAddress,
    settingsPda: scope.settingsPda,
    data: payload,
  });
}

export function invalidateEarnEarningsCache(cacheKey?: string) {
  cacheVersion += 1;

  if (cacheKey) {
    for (const [key, cached] of cachedEarnings) {
      if (key === cacheKey || key.startsWith(`${cacheKey}:`)) {
        cachedEarnings.set(key, { ...cached, expiresAt: 0 });
      }
    }
    for (const key of inflightEarnings.keys()) {
      if (key === cacheKey || key.startsWith(`${cacheKey}:`)) {
        inflightEarnings.delete(key);
      }
    }
    return;
  }

  cachedEarnings.clear();
  inflightEarnings.clear();
}

export function resetEarnEarningsCacheForTests() {
  invalidateEarnEarningsCache();
}

export async function fetchEarnEarningsRangeSet(
  cacheKey = DEFAULT_CACHE_KEY,
  scope: EarnEarningsCacheScope = {}
): Promise<EarnEarningsRangeSetResponse> {
  const now = Date.now();
  const cached = cachedEarnings.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inflightKey = `${cacheKey}:request:${scope.revalidationKey ?? "stable"}`;
  const inflight = inflightEarnings.get(inflightKey);
  if (inflight) {
    return inflight;
  }

  const staleBeforeFetch =
    cached?.value ?? readPersistentEarnEarningsCache(cacheKey, scope);
  const requestCacheVersion = cacheVersion;
  const request = requestEarnEarningsWithRetry(scope.timezone ?? "UTC")
    .then((payload) => {
      if (requestCacheVersion === cacheVersion) {
        if (
          isRegressiveEarningsPayload({
            fresh: payload,
            stale: cachedEarnings.get(cacheKey)?.value ?? staleBeforeFetch,
          })
        ) {
          const stale = cachedEarnings.get(cacheKey)?.value ?? staleBeforeFetch;
          if (stale) {
            return markPayloadStale(stale, "regressive_revalidation");
          }
        }

        if (
          isEqualRecordedEarningsWithNewerTimestamp({
            fresh: payload,
            stale: cachedEarnings.get(cacheKey)?.value ?? staleBeforeFetch,
          })
        ) {
          const stale = cachedEarnings.get(cacheKey)?.value ?? staleBeforeFetch;
          if (stale) {
            return markPayloadStale(stale, "unchanged_revalidation");
          }
        }

        cachedEarnings.set(cacheKey, {
          expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
          value: payload,
        });
        writePersistentEarnEarningsCache(cacheKey, scope, payload);
      }
      return payload;
    })
    .catch((error) => {
      const stale = cachedEarnings.get(cacheKey)?.value ?? staleBeforeFetch;
      if (stale) {
        return markPayloadStale(stale, "client_revalidation_failed");
      }
      throw error;
    })
    .finally(() => {
      if (inflightEarnings.get(inflightKey) === request) {
        inflightEarnings.delete(inflightKey);
      }
    });

  inflightEarnings.set(inflightKey, request);
  return request;
}

export function useEarnEarnings({
  cacheKey = DEFAULT_CACHE_KEY,
  enabled,
  seed,
  revalidationKey,
  settingsPda,
  solanaEnv,
  walletAddress,
}: {
  cacheKey?: string;
  enabled: boolean;
  seed?: EarnEarningsRangeSetResponse | null;
  revalidationKey?: string | null;
  settingsPda?: string | null;
  solanaEnv?: string;
  walletAddress?: string | null;
}) {
  const [timezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  const scopedCacheKey = `${cacheKey}:${timezone}`;
  const persisted = readPersistentEarnEarningsCache(scopedCacheKey, {
    revalidationKey,
    settingsPda,
    solanaEnv,
    walletAddress,
    timezone,
  });
  const cached = cachedEarnings.get(scopedCacheKey);
  const [dataState, setDataState] = useState<{
    scopeKey: string;
    value: EarnEarningsRangeSetResponse | null;
  }>(() => ({
    scopeKey: scopedCacheKey,
    value:
      seed ??
      (cached && cached.expiresAt > Date.now() ? cached.value : null) ??
      persisted,
  }));
  const data =
    dataState.scopeKey === scopedCacheKey ? dataState.value : null;
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const refresh = useCallback(() => {
    invalidateEarnEarningsCache(scopedCacheKey);
    setRefreshNonce((value) => value + 1);
  }, [scopedCacheKey]);

  useEffect(() => {
    if (!enabled) {
      setDataState({ scopeKey: scopedCacheKey, value: null });
      setError(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const freshCached = cachedEarnings.get(scopedCacheKey);
    if (freshCached && freshCached.expiresAt > Date.now()) {
      setDataState({ scopeKey: scopedCacheKey, value: freshCached.value });
      setError(null);
      setIsLoading(false);
      return;
    }

    const freshPersisted = readPersistentEarnEarningsCache(scopedCacheKey, {
      revalidationKey,
      settingsPda,
      solanaEnv,
      walletAddress,
      timezone,
    });
    if (freshPersisted) {
      setDataState({ scopeKey: scopedCacheKey, value: freshPersisted });
    } else if (dataState.scopeKey !== scopedCacheKey) {
      setDataState({ scopeKey: scopedCacheKey, value: seed ?? null });
    }

    setIsLoading(true);
    setError(null);
    fetchEarnEarningsRangeSet(scopedCacheKey, {
      revalidationKey,
      settingsPda,
      solanaEnv,
      walletAddress,
      timezone,
    })
      .then((payload) => {
        if (!isMounted) {
          return;
        }

        setDataState({ scopeKey: scopedCacheKey, value: payload });
      })
      .catch((err) => {
        if (!isMounted) {
          return;
        }

        console.warn("[earnings] failed to load Earn earnings", err);
        setDataState((current) => ({
          scopeKey: scopedCacheKey,
          value:
            current.scopeKey === scopedCacheKey && current.value
              ? markPayloadStale(
                  current.value,
                  "client_revalidation_failed"
                )
              : null,
        }));
        setError("Earnings are unavailable.");
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [
    scopedCacheKey,
    enabled,
    revalidationKey,
    settingsPda,
    solanaEnv,
    walletAddress,
    timezone,
    refreshNonce,
    seed,
    dataState.scopeKey,
  ]);

  return {
    data,
    error,
    freshness: data?.freshness ?? (error ? "unavailable" : null),
    isLoading,
    outcome: data?.outcome ?? (error ? "unavailable" : null),
    refresh,
  };
}
