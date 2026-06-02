import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const forecast = {
  apyBps: 1197,
  rangeHighBps: 1325,
  rangeLowBps: 856,
  strategy: "safe_no_fees" as const,
  updatedAt: "2026-06-01T00:00:00.000Z",
  window: {
    endedAt: "2026-06-01T00:00:00.000Z",
    startedAt: "2026-05-25T00:00:00.000Z",
  },
};

mock.module("@/lib/kamino/earn-forecast.server", () => ({
  getSafeNoFeeEarnForecast: mock(async () => forecast),
}));

let GET: typeof import("../route").GET;

describe("smart-account earn forecast route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  test("returns the Safe no-fee forecast shape", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(forecast);
  });
});
