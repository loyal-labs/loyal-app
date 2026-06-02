import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  fetchEarnForecastApy,
  resetEarnForecastApyCacheForTests,
} from "./use-earn-forecast-apy";

const originalFetch = globalThis.fetch;

describe("earn forecast APY cache", () => {
  afterEach(() => {
    resetEarnForecastApyCacheForTests();
    globalThis.fetch = originalFetch;
  });

  test("reuses the client-side forecast cache", async () => {
    const fetchMock = mock(async () => {
      return new Response(
        JSON.stringify({
          apyBps: 1197,
          rangeHighBps: 1325,
          rangeLowBps: 856,
          strategy: "safe_no_fees",
          updatedAt: "2026-06-01T00:00:00.000Z",
          window: {
            endedAt: "2026-06-01T00:00:00.000Z",
            startedAt: "2026-05-25T00:00:00.000Z",
          },
        })
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchEarnForecastApy()).resolves.toEqual({
      apyBps: 1197,
      rangeHighBps: 1325,
      rangeLowBps: 856,
    });
    await expect(fetchEarnForecastApy()).resolves.toEqual({
      apyBps: 1197,
      rangeHighBps: 1325,
      rangeLowBps: 856,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
