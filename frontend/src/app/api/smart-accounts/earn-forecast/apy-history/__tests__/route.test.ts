import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const forecast = {
  history: {
    feeBps: 1,
    generatedAt: "2026-06-01T00:00:00.000Z",
    riskProfile: "medium" as const,
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
        key: "loyal" as const,
        label: "Loyal Earn",
        metadata: {
          metric: "cumulative_annualized_apy_bps",
        },
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
      },
      {
        key: "mainUsdcReserve" as const,
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
  },
  summary: {
    apyBps: 910,
    rangeHighBps: 940,
    rangeLowBps: 870,
    strategy: "medium_fee_aware_1bps" as const,
    updatedAt: "2026-06-01T00:00:00.000Z",
    window: {
      endedAt: "2026-06-01T00:00:00.000Z",
      startedAt: "2026-05-02T00:00:00.000Z",
    },
  },
};

mock.module("@/lib/kamino/earn-forecast.server", () => ({
  getMediumFeeAwareEarnForecast: mock(async () => forecast),
}));

let GET: typeof import("../route").GET;

describe("smart-account earn forecast APY history route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  test("returns ordered Medium 1bps APY samples", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(forecast.history);
  });
});
