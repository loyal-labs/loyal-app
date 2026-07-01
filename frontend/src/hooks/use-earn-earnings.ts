"use client";

import { useEffect, useState } from "react";

import {
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache/client-cache";
import type { EarnEarningsRangeSetResponse } from "@/lib/yield-optimization/earnings.shared";

const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CACHE_KEY = "default";
const EARNINGS_EPSILON = 0.000000001;
const EARN_EARNINGS_CACHE_VERSION = 4;

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
  expectedPrincipalAmountRaw?: string | null;
  settingsPda?: string | null;
  solanaEnv?: string;
  walletAddress?: string | null;
};

const cachedEarnings = new Map<string, EarnEarningsCacheEntry>();
const inflightEarnings = new Map<
  string,
  Promise<EarnEarningsRangeSetResponse>
>();
let cacheVersion = 0;

function hasPositiveRawAmount(amountRaw: string | null | undefined): boolean {
  if (!amountRaw) {
    return false;
  }

  try {
    return BigInt(amountRaw) > BigInt(0);
  } catch {
    return false;
  }
}

function responseMatchesExpectedPrincipal(
  payload: EarnEarningsRangeSetResponse,
  expectedPrincipalAmountRaw: string | null | undefined
): boolean {
  if (!hasPositiveRawAmount(expectedPrincipalAmountRaw)) {
    return true;
  }

  return Object.values(payload.ranges).some(
    (range) => range.principalAmountRaw === expectedPrincipalAmountRaw
  );
}

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
    validate: (data): data is EarnEarningsRangeSetResponse =>
      typeof data === "object" && data !== null && "ranges" in data,
  });

  if (!payload) {
    return null;
  }

  const matches = responseMatchesExpectedPrincipal(
    payload,
    scope.expectedPrincipalAmountRaw
  );
  return matches ? payload : null;
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
    cachedEarnings.delete(cacheKey);
    inflightEarnings.delete(cacheKey);
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

  const inflight = inflightEarnings.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const staleBeforeFetch =
    cached?.value ?? readPersistentEarnEarningsCache(cacheKey, scope);
  const requestCacheVersion = cacheVersion;
  const request = fetch("/api/smart-accounts/yield-optimization/earnings", {
    cache: "no-store",
    credentials: "include",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Earn earnings request failed: ${response.status}`);
      }

      return (await response.json()) as EarnEarningsRangeSetResponse;
    })
    .then((payload) => {
      if (requestCacheVersion === cacheVersion) {
        if (
          !responseMatchesExpectedPrincipal(
            payload,
            scope.expectedPrincipalAmountRaw
          )
        ) {
          const stale = cachedEarnings.get(cacheKey)?.value ?? staleBeforeFetch;
          if (stale) {
            return stale;
          }

          throw new Error("Earn earnings response did not include principal.");
        }

        if (
          isRegressiveEarningsPayload({
            fresh: payload,
            stale: cachedEarnings.get(cacheKey)?.value ?? staleBeforeFetch,
          })
        ) {
          const stale = cachedEarnings.get(cacheKey)?.value ?? staleBeforeFetch;
          if (stale) {
            return stale;
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
            return stale;
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
    .finally(() => {
      inflightEarnings.delete(cacheKey);
    });

  inflightEarnings.set(cacheKey, request);
  return request;
}

export function useEarnEarnings({
  cacheKey = DEFAULT_CACHE_KEY,
  enabled,
  seed,
  expectedPrincipalAmountRaw,
  settingsPda,
  solanaEnv,
  walletAddress,
}: {
  cacheKey?: string;
  enabled: boolean;
  seed?: EarnEarningsRangeSetResponse | null;
  expectedPrincipalAmountRaw?: string | null;
  settingsPda?: string | null;
  solanaEnv?: string;
  walletAddress?: string | null;
}) {
  const persisted = readPersistentEarnEarningsCache(cacheKey, {
    expectedPrincipalAmountRaw,
    settingsPda,
    solanaEnv,
    walletAddress,
  });
  const cached = cachedEarnings.get(cacheKey);
  const [data, setData] = useState<EarnEarningsRangeSetResponse | null>(
    seed ??
      (cached && cached.expiresAt > Date.now() ? cached.value : null) ??
      persisted
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const freshCached = cachedEarnings.get(cacheKey);
    if (freshCached && freshCached.expiresAt > Date.now()) {
      setData(freshCached.value);
      setError(null);
      setIsLoading(false);
      return;
    }

    const freshPersisted = readPersistentEarnEarningsCache(cacheKey, {
      expectedPrincipalAmountRaw,
      settingsPda,
      solanaEnv,
      walletAddress,
    });
    if (freshPersisted) {
      setData(freshPersisted);
    }

    setIsLoading(true);
    setError(null);
    const requestCacheVersion = cacheVersion;
    fetchEarnEarningsRangeSet(cacheKey, {
      expectedPrincipalAmountRaw,
      settingsPda,
      solanaEnv,
      walletAddress,
    })
      .then((payload) => {
        if (!isMounted || requestCacheVersion !== cacheVersion) {
          return;
        }

        setData(payload);
      })
      .catch((err) => {
        if (!isMounted) {
          return;
        }

        console.warn("[earnings] failed to load Earn earnings", err);
        setData(null);
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
    cacheKey,
    enabled,
    expectedPrincipalAmountRaw,
    settingsPda,
    solanaEnv,
    walletAddress,
  ]);

  return {
    data,
    error,
    isLoading,
  };
}
