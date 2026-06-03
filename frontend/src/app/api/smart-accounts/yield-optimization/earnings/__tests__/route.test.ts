import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const canonicalTargetReserve = "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy";

const resolveAuthenticatedPrincipalFromRequest = mock(async () => ({
  authMethod: "wallet" as const,
  displayAddress: "wallet-1",
  provider: "solana" as const,
  settingsPda: "settings-1",
  smartAccountAddress: "smart-account-1",
  subjectAddress: "wallet-1",
  walletAddress: "wallet-1",
}));

const findYieldPositionEvents = mock(async () => [
  {
    amountRaw: BigInt(100_000_000),
    confirmedAt: new Date("2026-06-01T00:00:00.000Z"),
    type: "deposit" as const,
  },
]);

const getReserveApyHistorySamples = mock(async () => [
  {
    observedAt: new Date("2026-06-01T00:00:00.000Z"),
    supplyApy: 0.1,
  },
]);
const close = mock(async () => {});

class MockTimescaleReserveClient {
  getReserveApyHistorySamples = getReserveApyHistorySamples;
  close = close;
}

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module("@/lib/kamino/timescale-reserve-client.server", () => ({
  TimescaleReserveClient: MockTimescaleReserveClient,
  getTimescaleReserveDatabaseUrl: () => process.env.TIMESCALEDB_URL ?? null,
}));

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findYieldPositionEvents,
}));

let GET: typeof import("../route").GET;

describe("smart-account Earn earnings route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "devnet";
    process.env.TIMESCALEDB_URL = "postgres://timescale/test";
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    findYieldPositionEvents.mockClear();
    getReserveApyHistorySamples.mockClear();
    close.mockClear();
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(async () => ({
      authMethod: "wallet" as const,
      displayAddress: "wallet-1",
      provider: "solana" as const,
      settingsPda: "settings-1",
      smartAccountAddress: "smart-account-1",
      subjectAddress: "wallet-1",
      walletAddress: "wallet-1",
    }));
    findYieldPositionEvents.mockImplementation(async () => [
      {
        amountRaw: BigInt(100_000_000),
        confirmedAt: new Date("2026-06-01T00:00:00.000Z"),
        type: "deposit" as const,
      },
    ]);
    getReserveApyHistorySamples.mockImplementation(async () => [
      {
        observedAt: new Date("2026-06-01T00:00:00.000Z"),
        supplyApy: 0.1,
      },
    ]);
    close.mockImplementation(async () => {});
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earnings"
      )
    );

    expect(response.status).toBe(401);
    expect(findYieldPositionEvents).not.toHaveBeenCalled();
  });

  test("rejects invalid ranges", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earnings?range=1M"
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_range",
        message: "Range must be one of 7D, 30D, 1Y, or ALL.",
      },
    });
  });

  test("loads events for the authenticated canonical Earn target", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earnings?range=7D"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findYieldPositionEvents.mock.calls[0]?.[0]).toEqual({
      cluster: "devnet",
      settings: "settings-1",
      targetReserve: canonicalTargetReserve,
      vaultIndex: 1,
      walletAddress: "wallet-1",
    });
    expect(getReserveApyHistorySamples).toHaveBeenCalledWith({
      end: expect.any(Date),
      reserve: canonicalTargetReserve,
      start: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(body.bars).toHaveLength(7);
    expect(Number.isNaN(body.lifetimeEarnedUsd)).toBe(false);
  });

  test("returns all graph ranges in one request when no range is provided", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earnings"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body.ranges)).toEqual(["7D", "30D", "1Y", "ALL"]);
    expect(body.ranges["7D"].bars).toHaveLength(7);
    expect(body.ranges["30D"].bars).toHaveLength(30);
    expect(body.ranges["1Y"].bars).toHaveLength(12);
    expect(getReserveApyHistorySamples).toHaveBeenCalledTimes(1);
  });

  test("returns an empty zero series without confirmed events", async () => {
    findYieldPositionEvents.mockImplementationOnce(async () => []);

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earnings?range=30D"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getReserveApyHistorySamples).not.toHaveBeenCalled();
    expect(body.bars).toHaveLength(30);
    expect(body.lifetimeEarnedUsd).toBe(0);
    expect(body.principalAmountRaw).toBe("0");
  });

  test("uses UTC buckets and ignores timezone input", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earnings?range=7D&timezone=America%2FLos_Angeles"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bars.at(-1).startAt.endsWith("T00:00:00.000Z")).toBe(true);
  });

  test("returns 503 when Timescale fails", async () => {
    getReserveApyHistorySamples.mockImplementationOnce(async () => {
      throw new Error("timescale unavailable");
    });

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earnings?range=7D"
      )
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "earnings_unavailable",
        message: "Earn earnings are unavailable.",
      },
    });
  });

  test("returns 503 with diagnostic logging when Timescale is not configured", async () => {
    delete process.env.TIMESCALEDB_URL;
    const warn = console.warn;
    const warnMock = mock(() => {});
    console.warn = warnMock as typeof console.warn;

    try {
      const response = await GET(
        new Request(
          "https://app.askloyal.com/api/smart-accounts/yield-optimization/earnings?range=7D"
        )
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "earnings_timescale_unconfigured",
          message: "Earn earnings require Timescale configuration.",
        },
      });
      expect(warnMock).toHaveBeenCalledWith(
        "[earnings] failed to load Earn earnings",
        expect.any(Error)
      );
    } finally {
      console.warn = warn;
    }
  });

  test("uses TIMESCALEDB_URL for local Timescale configuration", async () => {
    process.env.TIMESCALEDB_URL = "postgres://timescaledb/test";

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earnings?range=7D"
      )
    );

    expect(response.status).toBe(200);
    expect(getReserveApyHistorySamples).toHaveBeenCalled();
  });

  test("returns 503 when Yield Neon fails", async () => {
    findYieldPositionEvents.mockImplementationOnce(async () => {
      throw new Error("yield unavailable");
    });

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earnings?range=7D"
      )
    );

    expect(response.status).toBe(503);
  });
});
