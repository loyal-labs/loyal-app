#!/usr/bin/env bun

import {
  fetchEarnEarningsRangeSet,
  invalidateEarnEarningsCache,
  resetEarnEarningsCacheForTests,
} from "@/hooks/use-earn-earnings";
import type { EarnEarningsRangeSetResponse } from "@/lib/yield-optimization/earnings.shared";
import {
  calculateEarnEarnings,
  EARNINGS_RANGE_IDS,
} from "@/lib/yield-optimization/earnings-calculator.server";

function verify(name: string, condition: boolean) {
  if (!condition) {
    throw new Error(`FAIL ${name}`);
  }
  console.log(JSON.stringify({ name, status: "PASS" }));
}

const nativeFetch = globalThis.fetch;
const nativeWindow = globalThis.window;
const day = 24 * 60 * 60 * 1000;
const deposit = new Date("2026-09-28T00:00:00Z");
function payload(now: Date): EarnEarningsRangeSetResponse {
  return {
    coverage: {
      currentReserveSampleAgeMs: 0,
      eventCount: 1,
      gappedReserves: [],
      maxSampleGapMs: 0,
      missingReserves: [],
      reserveCount: 1,
      sampleCount: 1,
      sampledReserveCount: 1,
      staleReserves: [],
    },
    freshness: "fresh",
    generatedAt: now.toISOString(),
    historyRevision: "verified-fixture",
    outcome: "ready",
    principalMatchesHistory: true,
    ranges: Object.fromEntries(
      EARNINGS_RANGE_IDS.map((range) => [
        range,
        calculateEarnEarnings({
          apySamples: [
            { observedAt: deposit, reserve: "reserve-a", supplyApy: 0.1 },
          ],
          events: [
            {
              amountRaw: BigInt(100_000_000),
              confirmedAt: deposit,
              type: "deposit",
            },
          ],
          now,
          range,
          timezone: "UTC",
        }),
      ])
    ) as EarnEarningsRangeSetResponse["ranges"],
    snapshotAgeMs: null,
    sourcePrincipalAmountRaw: "100000000",
    staleReason: null,
  };
}

let deadlineScheduled = false;
globalThis.window = {
  location: { origin: "https://fixture.invalid" },
  setTimeout: (callback: () => void, delay: number) => {
    if (delay === 30_000) {
      deadlineScheduled = true;
    }
    return setTimeout(callback, delay === 30_000 ? 50 : delay);
  },
  clearTimeout,
} as unknown as Window & typeof globalThis;
let next = payload(new Date(deposit.getTime() + day - 1000));
globalThis.fetch = Object.assign(async () => Response.json(next), { preconnect: nativeFetch.preconnect });
try {
  const key = "freshness-fixture";
  const scope = { revalidationKey: "100000000", timezone: "UTC", strict: true };
  const before = await fetchEarnEarningsRangeSet(key, scope);
  invalidateEarnEarningsCache(key);
  next = payload(new Date(deposit.getTime() + day + 1000));
  const after = await fetchEarnEarningsRangeSet(key, scope);
  verify(
    "local midnight resets today without preserving yesterday as stale",
    after.freshness === "fresh" &&
      after.generatedAt === next.generatedAt &&
      after.ranges.ALL.todayEarnedUsd < before.ranges.ALL.todayEarnedUsd &&
      after.ranges.ALL.lifetimeEarnedUsd > before.ranges.ALL.lifetimeEarnedUsd
  );
  invalidateEarnEarningsCache(key);
  next = {
    ...next,
    generatedAt: new Date(Date.parse(next.generatedAt) + 1000).toISOString(),
  };
  const unchanged = await fetchEarnEarningsRangeSet(key, scope);
  verify(
    "verified unchanged amounts remain fresh",
    unchanged.freshness === "fresh" &&
      unchanged.generatedAt === next.generatedAt
  );
  invalidateEarnEarningsCache(key);
  globalThis.fetch = (async (_url, options) =>
    new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener(
        "abort",
        () => reject(new Error("fixture timeout")),
        { once: true }
      );
    })) as typeof fetch;
  const started = Date.now();
  const stale = await fetchEarnEarningsRangeSet(key, {
    ...scope,
    strict: false,
  });
  verify(
    "a hanging request settles and preserves verified stale values",
    deadlineScheduled &&
      Date.now() - started < 2000 &&
      stale.freshness === "stale" &&
      stale.ranges.ALL.lifetimeEarnedUsd ===
        unchanged.ranges.ALL.lifetimeEarnedUsd
  );
} finally {
  globalThis.fetch = nativeFetch;
  globalThis.window = nativeWindow;
  resetEarnEarningsCacheForTests();
}
