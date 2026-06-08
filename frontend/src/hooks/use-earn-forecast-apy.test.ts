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
          apyBps: 910,
          rangeHighBps: 940,
          rangeLowBps: 870,
          strategy: "medium_fee_aware_1bps",
          updatedAt: "2026-06-01T00:00:00.000Z",
          window: {
            endedAt: "2026-06-01T00:00:00.000Z",
            startedAt: "2026-05-02T00:00:00.000Z",
          },
        })
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const firstForecast = await fetchEarnForecastApy();
    const secondForecast = await fetchEarnForecastApy();

    expect(firstForecast).toMatchObject({
      apyBps: 910,
      rangeHighBps: 940,
      rangeLowBps: 870,
    });
    expect(secondForecast).toBe(firstForecast);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/smart-accounts/earn-forecast", {
      cache: "no-store",
    });
  });
});
