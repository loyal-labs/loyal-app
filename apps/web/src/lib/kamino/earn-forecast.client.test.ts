import { expect, test } from "bun:test";

import {
  fetchEarnForecastSummary,
  resetEarnForecastSummaryCacheForTests,
  toForecastApy,
} from "./earn-forecast.client";

const NOW = Date.parse("2026-10-01T12:00:00Z");

test("a measured APY expires on its source timestamp and an unavailable response is briefly cached", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = NOW;
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = (async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        forecast:
          calls === 1
            ? {
                apyBps: 650,
                strategy: "realized_7d_share_price",
                source: "live",
                updatedAt: new Date(NOW - 179 * 60_000).toISOString(),
                availability: "available",
              }
            : {
                apyBps: 600,
                strategy: "safe_no_fees",
                updatedAt: new Date(now).toISOString(),
                availability: "unavailable",
              },
        history: { samples: [] },
      }),
    } as Response;
  }) as unknown as typeof fetch;
  try {
    resetEarnForecastSummaryCacheForTests();
    const first = await fetchEarnForecastSummary();
    expect(toForecastApy(first.forecast).availability).toBe("available");
    expect(toForecastApy(first.forecast).source).toBe("live");
    now += 2 * 60_000;
    const second = await fetchEarnForecastSummary();
    expect(toForecastApy(second.forecast).availability).toBe("unavailable");
    await fetchEarnForecastSummary();
    expect(calls).toBe(2);
  } finally {
    resetEarnForecastSummaryCacheForTests();
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

test("an outage fallback is cached for its retry interval", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("offline");
  }) as unknown as typeof fetch;
  try {
    resetEarnForecastSummaryCacheForTests();
    const first = await fetchEarnForecastSummary();
    const second = await fetchEarnForecastSummary();
    expect(toForecastApy(first.forecast).availability).toBe("unavailable");
    expect(second).toBe(first);
    expect(calls).toBe(1);
  } finally {
    resetEarnForecastSummaryCacheForTests();
    globalThis.fetch = originalFetch;
  }
});
