import { afterEach, expect, test } from "bun:test";

import {
  fetchEarnForecastSummary,
  resetEarnForecastSummaryCacheForTests,
  toForecastApy,
} from "./earn-forecast.client";

afterEach(() => {
  resetEarnForecastSummaryCacheForTests();
});

test("fetches combined Earn forecast summary once for concurrent readers", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          forecast: {
            apyBps: 1200,
            rangeHighBps: 1300,
            rangeLowBps: 900,
            strategy: "medium_fee_aware_1bps",
            updatedAt: "2026-06-01T00:00:00.000Z",
            window: {
              endedAt: "2026-06-01T00:00:00.000Z",
              startedAt: "2026-05-02T00:00:00.000Z",
            },
          },
          history: {
            feeBps: 1,
            generatedAt: "2026-06-01T00:00:00.000Z",
            riskProfile: "medium",
            samples: [],
            window: {
              endedAt: "2026-06-01T00:00:00.000Z",
              startedAt: "2026-05-02T00:00:00.000Z",
            },
          },
        })
      )
    );
  }) as unknown as typeof fetch;

  try {
    const [left, right] = await Promise.all([
      fetchEarnForecastSummary(),
      fetchEarnForecastSummary(),
    ]);
    expect(toForecastApy(left.forecast)).toEqual({
      apyBps: 1200,
      rangeHighBps: 1300,
      rangeLowBps: 900,
    });
    expect(right.history.riskProfile).toBe("medium");
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(calls).toBe(1);
});
