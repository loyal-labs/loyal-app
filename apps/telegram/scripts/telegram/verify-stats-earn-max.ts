// Offline contract check: run with bun, without database/RPC credentials.
import assert from "node:assert/strict";

import { mock, spyOn } from "bun:test";

type SeriesPoint = { weekStart: string; weekEnd: string; aumRaw: string };
let previousSeries: SeriesPoint[] = [
  { weekStart: "2026-10-05", weekEnd: "2026-10-11", aumRaw: "8000000" },
];
const historicalWeek = { ...previousSeries[0] };
const earnAumRaw = BigInt(20_000_000);
let lockAcquired = true;
let persisted = 0;
let lastAumRaw = BigInt(0);
let apiStatus = 200;
let apiBody: unknown = { success: true, data: { totalValue: 101_251_054_911 } };
let fetchError: Error | null = null;

mock.module("server-only", () => ({}));
mock.module("@loyal-labs/db-core/schema", () => ({
  appUsers: {},
  loyalStatsSnapshots: {},
}));
mock.module("drizzle-orm", () => ({ count: () => "count", eq: () => "equal" }));
mock.module("@/lib/core/config/server", () => ({
  serverEnv: { yieldNeonDatabaseUrl: "https://unused.invalid" },
}));
mock.module("@/lib/core/database", () => ({
  getDatabase: () => ({
    select: (fields: Record<string, unknown>) => ({
      from: () =>
        "value" in fields
          ? Promise.resolve([{ value: 7 }])
          : {
              where: () => ({
                limit: async () => [{ earnAumSeries: previousSeries }],
              }),
            },
    }),
  }),
}));
mock.module("@neondatabase/serverless", () => ({
  neon: () => ({
    transaction: async () => [
      [],
      lockAcquired
        ? [
            {
              active_autodeposit_policies: "2",
              active_principal_raw: "19000000",
              earn_aum_series: [
                { ...historicalWeek, aumRaw: "9000000" },
                {
                  weekStart: "2026-10-12",
                  weekEnd: "2026-10-12",
                  aumRaw: earnAumRaw.toString(),
                },
              ],
              total_aum_raw: earnAumRaw.toString(),
              total_optimized_volume_raw: "50000000",
              unique_earn_policies: "4",
              unique_earn_users: "3",
            },
          ]
        : [],
    ],
  }),
}));
mock.module("@/lib/telegram/bot-api/stats-persistence.server", () => ({
  loadLoyalStatsSnapshotForRefresh: async () => null,
  upsertLoyalStatsSnapshot: async (stats: {
    totalAumRaw: bigint;
    earnAumSeries: SeriesPoint[];
  }) => {
    persisted += 1;
    lastAumRaw = stats.totalAumRaw;
    previousSeries = stats.earnAumSeries;
  },
}));
mock.module("@/lib/telegram/bot-api/stats-slack-alert.server", () => ({
  sendLoyalStatsAumAlert: async () => {
    throw new Error("unexpected alert");
  },
}));
mock.module("../../src/app/api/cron/_shared/auth", () => ({
  validateCronAuthHeader: () => null,
}));

const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
  Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.ok(init?.signal, "external valuation must have a timeout signal");
      if (fetchError) throw fetchError;
      return Response.json(apiBody, { status: apiStatus });
    },
    { preconnect: fetch.preconnect }
  )
);
const infoSpy = spyOn(console, "info").mockImplementation(() => {});
const errorSpy = spyOn(console, "error").mockImplementation(() => {});

try {
  const { loadLoyalStats } = await import(
    "../../src/lib/telegram/bot-api/stats-command.server"
  );
  const { POST } = await import("../../src/app/api/cron/telegram-stats/route");
  const request = new Request(
    "https://unused.invalid/api/cron/telegram-stats",
    { method: "POST" }
  );
  const stats = await loadLoyalStats();
  assert.ok(stats);
  assert.equal(stats.totalAumRaw, earnAumRaw + BigInt(101_251_054_911));
  assert.equal(
    stats.earnAumSeries.at(-1)?.aumRaw,
    stats.totalAumRaw.toString()
  );
  assert.deepEqual(stats.earnAumSeries[0], historicalWeek);
  assert.equal(stats.totalUsers, 7);
  assert.equal(stats.totalOptimizedVolumeRaw, BigInt(50_000_000));
  assert.equal(stats.activePrincipalRaw, BigInt(19_000_000));

  for (let i = 0; i < 2; i += 1) {
    assert.equal((await POST(request)).status, 200);
    assert.equal(
      lastAumRaw,
      stats.totalAumRaw,
      "refresh must not add MAX twice"
    );
    assert.deepEqual(previousSeries[0], historicalWeek);
  }
  const goodWrites = persisted;
  for (const body of [
    null,
    {},
    { success: false, data: { totalValue: 100 } },
    ...[null, -1, 1.5, "100", Number.MAX_SAFE_INTEGER + 1].map(
      (totalValue) => ({ success: true, data: { totalValue } })
    ),
  ]) {
    apiBody = body;
    assert.equal((await POST(request)).status, 500);
    assert.equal(
      persisted,
      goodWrites,
      "invalid NAV must preserve the snapshot"
    );
  }
  apiBody = { success: true, data: { totalValue: 0 } };
  apiStatus = 503;
  assert.equal((await POST(request)).status, 500);
  assert.equal(persisted, goodWrites);
  apiStatus = 200;
  fetchError = new DOMException("timed out", "TimeoutError");
  assert.equal((await POST(request)).status, 500);
  assert.equal(persisted, goodWrites);
  fetchError = null;

  lockAcquired = false;
  assert.equal((await POST(request)).status, 202);
  assert.equal(persisted, goodWrites);
  lockAcquired = true;
  assert.equal((await POST(request)).status, 200);
  assert.equal(lastAumRaw, earnAumRaw, "an empty MAX vault is valid");
  assert.deepEqual(previousSeries[0], historicalWeek);
} finally {
  fetchSpy.mockRestore();
  infoSpy.mockRestore();
  errorSpy.mockRestore();
  mock.restore();
}
console.info(
  "PASS: combined AUM, preserved history, idempotent refresh, empty vault, lock skip, and no writes on invalid/unavailable NAV"
);
