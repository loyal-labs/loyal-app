import { afterEach, describe, expect, mock, test } from "bun:test";

import type { EarnForecastApyHistoryResponse } from "@/lib/kamino/earn-forecast.shared";

import {
  fetchEarnForecastApyHistory,
  resetEarnForecastApyHistoryCacheForTests,
} from "./use-earn-forecast-apy-history";

const originalFetch = globalThis.fetch;

describe("earn forecast APY history cache", () => {
  afterEach(() => {
    resetEarnForecastApyHistoryCacheForTests();
    globalThis.fetch = originalFetch;
  });

  test("reuses the client-side history cache", async () => {
    const history: EarnForecastApyHistoryResponse = {
      feeBps: 1,
      generatedAt: "2026-06-01T00:00:00.000Z",
      riskProfile: "medium",
      samples: [
        {
          apyBps: 870,
          observedAt: "2026-05-15T00:00:00.000Z",
        },
        {
          apyBps: 910,
          observedAt: "2026-05-31T00:00:00.000Z",
        },
      ],
      series: [
        {
          key: "loyal",
          label: "Loyal Earn",
          metadata: {
            metric: "cumulative_annualized_apy_bps",
          },
          samples: [
            {
              apyBps: 870,
              observedAt: "2026-05-15T00:00:00.000Z",
            },
          ],
        },
        {
          key: "mainUsdcReserve",
          label: "Kamino Main USDC",
          metadata: {
            metric: "cumulative_annualized_apy_bps",
          },
          samples: [
            {
              apyBps: 560,
              observedAt: "2026-05-31T00:00:00.000Z",
            },
          ],
        },
      ],
      window: {
        endedAt: "2026-06-01T00:00:00.000Z",
        startedAt: "2026-05-02T00:00:00.000Z",
      },
    };
    const fetchMock = mock(async () => {
      return new Response(JSON.stringify(history));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const firstHistory = await fetchEarnForecastApyHistory();
    const secondHistory = await fetchEarnForecastApyHistory();

    expect(firstHistory.samples).toHaveLength(2);
    expect(firstHistory.series?.map((series) => series.key)).toEqual([
      "loyal",
      "mainUsdcReserve",
    ]);
    expect(secondHistory).toBe(firstHistory);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/smart-accounts/earn-forecast/apy-history",
      { cache: "no-store" }
    );
  });
});
