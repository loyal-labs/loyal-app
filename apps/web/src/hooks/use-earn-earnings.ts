"use client";

import { useCallback, useEffect, useState } from "react";

import {
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache/client-cache";
import {
  isEarnEarningsCacheRevisionCurrent,
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
  revalidationKey: string | null;
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
  strict?: boolean;
  walletAddress?: string | null;
  timezone?: string;
};

const cachedEarnings = new Map<string, EarnEarningsCacheEntry>();
const inflightEarnings = new Map<
  string,
  Promise<EarnEarningsRangeSetResponse>
>();
const latestRequestByCacheKey = new Map<string, string>();
const dirtyEarningsCacheKeys = new Set<string>();
const earnEarningsInvalidationListeners = new Set<
  (cacheKey?: string) => void
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
    for (const key of latestRequestByCacheKey.keys()) {
      if (key === cacheKey || key.startsWith(`${cacheKey}:`)) {
        dirtyEarningsCacheKeys.add(key);
      }
    }
  } else {
    cachedEarnings.clear();
    for (const key of latestRequestByCacheKey.keys()) {
      dirtyEarningsCacheKeys.add(key);
    }
  }

  for (const listener of earnEarningsInvalidationListeners) {
    listener(cacheKey);
  }
}

export function resetEarnEarningsCacheForTests() {
  cacheVersion += 1;
  cachedEarnings.clear();
  inflightEarnings.clear();
  latestRequestByCacheKey.clear();
  dirtyEarningsCacheKeys.clear();
}

export async function fetchEarnEarningsRangeSet(
  cacheKey = DEFAULT_CACHE_KEY,
  scope: EarnEarningsCacheScope = {}
): Promise<EarnEarningsRangeSetResponse> {
  const now = Date.now();
  const cached = cachedEarnings.get(cacheKey);
  if (
    cached &&
    cached.expiresAt > now &&
    isEarnEarningsCacheRevisionCurrent(
      cached.revalidationKey,
      scope.revalidationKey
    )
  ) {
    return cached.value;
  }

  // The server response is already verified against its source principal. A
  // client-side principal revision must not split one canonical network read
  // into two requests while the position refresh commits a new value.
  const inflightKey = `${cacheKey}:request`;
  const fallbackBeforeFetch =
    cached?.value ?? readPersistentEarnEarningsCache(cacheKey, scope);
  const withCallerFallback = (request: Promise<EarnEarningsRangeSetResponse>) =>
    scope.strict
      ? request
      : request.catch((error) => {
          const stale =
            cachedEarnings.get(cacheKey)?.value ?? fallbackBeforeFetch;
          if (stale) {
            return markPayloadStale(stale, "client_revalidation_failed");
          }
          throw error;
        });
  const inflight = inflightEarnings.get(inflightKey);
  if (inflight) {
    return withCallerFallback(inflight);
  }

  latestRequestByCacheKey.set(cacheKey, inflightKey);
  const request = (async () => {
    let result: EarnEarningsRangeSetResponse | undefined;
    let lastError: unknown;
    do {
      dirtyEarningsCacheKeys.delete(cacheKey);
      lastError = undefined;
      const requestCacheVersion = cacheVersion;
      const comparableBeforeFetch = cachedEarnings.get(cacheKey);
      try {
        const payload = await requestEarnEarningsWithRetry(
          scope.timezone ?? "UTC"
        );
        result = payload;
        if (
          requestCacheVersion === cacheVersion &&
          latestRequestByCacheKey.get(cacheKey) === inflightKey &&
          !dirtyEarningsCacheKeys.has(cacheKey)
        ) {
          const latestCached = cachedEarnings.get(cacheKey);
          const comparableStale =
            latestCached &&
            isEarnEarningsCacheRevisionCurrent(
              latestCached.revalidationKey,
              scope.revalidationKey
            )
              ? latestCached.value
              : comparableBeforeFetch &&
                isEarnEarningsCacheRevisionCurrent(
                  comparableBeforeFetch.revalidationKey,
                  scope.revalidationKey
                )
              ? comparableBeforeFetch.value
              : null;
          if (
            comparableStale &&
            isRegressiveEarningsPayload({
              fresh: payload,
              stale: comparableStale,
            })
          ) {
            result = markPayloadStale(
              comparableStale,
              "regressive_revalidation"
            );
          } else if (
            comparableStale &&
            isEqualRecordedEarningsWithNewerTimestamp({
              fresh: payload,
              stale: comparableStale,
            })
          ) {
            result = markPayloadStale(
              comparableStale,
              "unchanged_revalidation"
            );
          } else {
            const summary = summarizeEarningsPayload(payload);
            const responseRevision =
              summary.principalAmountRaws.length === 1
                ? summary.principalAmountRaws[0]
                : scope.revalidationKey ?? null;
            cachedEarnings.set(cacheKey, {
              expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
              revalidationKey: responseRevision,
              value: payload,
            });
            writePersistentEarnEarningsCache(cacheKey, scope, payload);
          }
        }
      } catch (error) {
        lastError = error;
      }
    } while (dirtyEarningsCacheKeys.has(cacheKey));

    if (lastError !== undefined) {
      throw lastError;
    }
    if (!result) {
      throw new Error("Earnings are unavailable.");
    }
    return result;
  })().finally(() => {
    if (inflightEarnings.get(inflightKey) === request) {
      inflightEarnings.delete(inflightKey);
    }
    if (latestRequestByCacheKey.get(cacheKey) === inflightKey) {
      latestRequestByCacheKey.delete(cacheKey);
    }
  });

  inflightEarnings.set(inflightKey, request);
  return withCallerFallback(request);
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
  const cachedForRevision =
    cached &&
    isEarnEarningsCacheRevisionCurrent(cached.revalidationKey, revalidationKey)
      ? cached
      : null;
  const [dataState, setDataState] = useState<{
    scopeKey: string;
    value: EarnEarningsRangeSetResponse | null;
  }>(() => ({
    scopeKey: scopedCacheKey,
    value:
      seed ??
      (cachedForRevision && cachedForRevision.expiresAt > Date.now()
        ? cachedForRevision.value
        : null) ??
      persisted,
  }));
  const data = dataState.scopeKey === scopedCacheKey ? dataState.value : null;
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const refresh = useCallback(() => {
    invalidateEarnEarningsCache(scopedCacheKey);
  }, [scopedCacheKey]);

  useEffect(() => {
    const handleInvalidation = (invalidatedCacheKey?: string) => {
      if (
        !invalidatedCacheKey ||
        scopedCacheKey === invalidatedCacheKey ||
        scopedCacheKey.startsWith(`${invalidatedCacheKey}:`)
      ) {
        setRefreshNonce((value) => value + 1);
      }
    };
    earnEarningsInvalidationListeners.add(handleInvalidation);
    return () => {
      earnEarningsInvalidationListeners.delete(handleInvalidation);
    };
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
    if (
      freshCached &&
      freshCached.expiresAt > Date.now() &&
      isEarnEarningsCacheRevisionCurrent(
        freshCached.revalidationKey,
        revalidationKey
      )
    ) {
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
              ? markPayloadStale(current.value, "client_revalidation_failed")
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
