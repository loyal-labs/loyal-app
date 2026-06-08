import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const TEST_ENV_KEYS = ["CRON_SECRET"] as const;

function clearTestEnv(): void {
  for (const key of TEST_ENV_KEYS) {
    delete process.env[key];
  }
}

const runPrivateTransferAnalyticsCron = mock(async () => ({
  gaslessClaims: {
    backfillCompleted: true,
    backfillPagesProcessed: 1,
    headPagesProcessed: 1,
    latestSeenSignature: "gasless-sig-1",
    recordsSkippedExcludedBpfLoader: 0,
    recordsSkippedMissingBlockTime: 0,
    recordsSkippedUnclassified: 1,
    recordsUpserted: 2,
    signaturesFetched: 3,
  },
  history: {
    backfillCompleted: true,
    backfillPagesProcessed: 1,
    eventsInserted: 2,
    eventsSkippedMissingBlockTime: 0,
    headPagesProcessed: 1,
    latestSeenSignature: "sig-1",
    signaturesFetched: 2,
  },
  vaults: {
    holdingsUpserted: 1,
    tokenCatalogUpdated: 1,
    vaultsDiscovered: 1,
  },
}));

mock.module("@/features/private-transfer-analytics", () => ({
  runPrivateTransferAnalyticsCron,
}));

let POST: (request: Request) => Promise<Response>;

describe("private transfer analytics cron route", () => {
  beforeAll(async () => {
    const loadedModule = await import("./route");
    POST = loadedModule.POST;
  });

  beforeEach(() => {
    clearTestEnv();
    runPrivateTransferAnalyticsCron.mockClear();
  });

  afterEach(() => {
    clearTestEnv();
  });

  test("returns cron stats on success", async () => {
    process.env.CRON_SECRET = "expected-secret";

    const request = new Request("http://localhost/api/cron/private-transfer-analytics", {
      method: "POST",
      headers: { authorization: "Bearer expected-secret" },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(runPrivateTransferAnalyticsCron).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      ok: true,
      stats: {
        gaslessClaims: {
          latestSeenSignature: "gasless-sig-1",
          recordsUpserted: 2,
        },
        history: {
          eventsInserted: 2,
          latestSeenSignature: "sig-1",
        },
        vaults: {
          holdingsUpserted: 1,
          vaultsDiscovered: 1,
        },
      },
    });
  });

  test("returns 500 when sync throws", async () => {
    process.env.CRON_SECRET = "expected-secret";
    runPrivateTransferAnalyticsCron.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const request = new Request("http://localhost/api/cron/private-transfer-analytics", {
      method: "POST",
      headers: { authorization: "Bearer expected-secret" },
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "boom", ok: false });
  });
});
