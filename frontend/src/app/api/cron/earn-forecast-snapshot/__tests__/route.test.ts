import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const refreshMediumFeeAwareEarnForecastSnapshot = mock(async () => ({
  forecast: {
    summary: {
      window: {
        endedAt: "2026-06-01T00:00:00.000Z",
        startedAt: "2026-05-02T00:00:00.000Z",
      },
    },
  },
  generatedAt: "2026-06-01T00:00:00.000Z",
  insertedOrUpdated: true,
  loyalSampleCount: 2,
  mainUsdcReserveSampleCount: 2,
  sampleCount: 2,
}));

mock.module("@/lib/kamino/earn-forecast.server", () => ({
  refreshMediumFeeAwareEarnForecastSnapshot,
}));

let GET: typeof import("../route").GET;
let POST: typeof import("../route").POST;

describe("Earn forecast snapshot cron route", () => {
  beforeAll(async () => {
    ({ GET, POST } = await import("../route"));
  });

  beforeEach(() => {
    process.env.CRON_SECRET = "expected-secret";
    refreshMediumFeeAwareEarnForecastSnapshot.mockClear();
  });

  test("rejects missing auth", async () => {
    const response = await POST(
      new Request("https://app.askloyal.com/api/cron/earn-forecast-snapshot")
    );

    expect(response.status).toBe(401);
    expect(refreshMediumFeeAwareEarnForecastSnapshot).not.toHaveBeenCalled();
  });

  test("rejects invalid auth", async () => {
    const response = await POST(
      new Request("https://app.askloyal.com/api/cron/earn-forecast-snapshot", {
        headers: { authorization: "Bearer wrong-secret" },
      })
    );

    expect(response.status).toBe(401);
    expect(refreshMediumFeeAwareEarnForecastSnapshot).not.toHaveBeenCalled();
  });

  test("computes and persists on POST success", async () => {
    const response = await POST(
      new Request("https://app.askloyal.com/api/cron/earn-forecast-snapshot", {
        headers: { authorization: "Bearer expected-secret" },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      generatedAt: "2026-06-01T00:00:00.000Z",
      insertedOrUpdated: true,
      loyalSampleCount: 2,
      mainUsdcReserveSampleCount: 2,
      sampleCount: 2,
      window: {
        endedAt: "2026-06-01T00:00:00.000Z",
        startedAt: "2026-05-02T00:00:00.000Z",
      },
    });
    expect(refreshMediumFeeAwareEarnForecastSnapshot).toHaveBeenCalledTimes(1);
  });

  test("supports Vercel Cron GET requests", async () => {
    const response = await GET(
      new Request("https://app.askloyal.com/api/cron/earn-forecast-snapshot", {
        headers: { authorization: "Bearer expected-secret" },
      })
    );

    expect(response.status).toBe(200);
    expect(refreshMediumFeeAwareEarnForecastSnapshot).toHaveBeenCalledTimes(1);
  });
});
