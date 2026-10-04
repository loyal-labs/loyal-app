import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));
const authCore = await import(
  "../../../../../../../../packages/auth-core/src/index.ts"
);
mock.module("@loyal-labs/auth-core", () => authCore);
const wallet = "11111111111111111111111111111111";
const settings = "SysvarRent111111111111111111111111111111111";
const sessionKey = "workers-v2-route-contract-test-only";
mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({ authJwtSecret: sessionKey }),
}));
mock.module("@/lib/core/config/solana-env-override", () => ({
  resolveLoyalWebSolanaEnvFromEnv: () => "mainnet",
}));
const userLookup = mock(() =>
  Promise.resolve<{ id: string } | null>({ id: "existing-user" }),
);
const accountLookup = mock(() =>
  Promise.resolve({ settingsPda: settings, smartAccountAddress: wallet }),
);
mock.module("@/features/chat/server/app-user", () => ({
  findCurrentUser: userLookup,
}));
mock.module("@/features/smart-accounts/server/service", () => ({
  findReadyCurrentUserSmartAccount: accountLookup,
}));
const startedAt = new Date(Date.now() - 60 * 60 * 1000);
const ledger = [
  {
    type: "deposit",
    amountRaw: BigInt(100000000),
    confirmedAt: startedAt,
    liquidityMint: "usdc",
    positionId: "position",
    initializesPosition: true,
  },
];
const snapshots = [
  {
    observedAt: startedAt,
    observedSlot: BigInt(50),
    exposures: [
      {
        amountRaw: BigInt(100000000),
        kind: "kamino",
        liquidityMint: "usdc",
        reserve: "reserve",
        sourceId: "reserve:reserve",
      },
    ],
  },
];
const positions = mock(() =>
  Promise.resolve([
    { initialLiquidityMint: "usdc", principalAmountRaw: BigInt(100000000) },
  ]),
);
const ledgerRead = mock(() => Promise.resolve(ledger));
const portfolioRead = mock(() => Promise.resolve(snapshots));
mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findActiveYieldPositionsForVault: positions,
  findYieldPositionEvents: ledgerRead,
  findCompleteYieldVaultExposureSnapshots: portfolioRead,
  findYieldPositionHistoryEventsForVault: () => Promise.resolve([]),
}));
const closed = mock(() => Promise.resolve());
const apy = mock(() =>
  Promise.resolve([
    { reserve: "reserve", observedAt: startedAt, supplyApy: 0.1 },
    { reserve: "reserve", observedAt: new Date(), supplyApy: 0.1 },
  ]),
);
mock.module("@/lib/kamino/timescale-reserve-client.server", () => ({
  getTimescaleReserveDatabaseUrl: () =>
    "postgresql://fixture.invalid/read-only",
  TimescaleReserveClient: class {
    getReserveApyHistorySamplesForReserves = apy;
    close = closed;
  },
}));
const neon = await import("@/lib/yield-optimization/yield-neon-client.server");
const cacheRead = mock(() => {
  throw new Error("GET attempted financial snapshot cache read");
});
const write = mock(() => {
  throw new Error("GET attempted financial snapshot write");
});
const dbSpy = spyOn(neon, "getYieldOptimizationClient").mockReturnValue({
  db: {
    query: { earnEarningsSnapshots: { findFirst: cacheRead } },
    insert: write,
    update: write,
    delete: write,
    execute: write,
    transaction: write,
  },
} as never);
const rpc = mock(() => {
  throw new Error("GET attempted financial RPC");
});
mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: () => rpc,
}));
const { issueAuthSessionToken } = await import(
  "@/features/identity/server/session-token"
);
const { GET: webGET } = await import("./route");
const { GET: mobileGET } = await import(
  "@/app/api/smart-accounts/mobile/earn/earnings/route"
);
const priorFlag = process.env.WORKERS_V2_APP_READ_ONLY_GETS;
afterAll(() => {
  dbSpy.mockRestore();
  if (priorFlag === undefined) {
    Reflect.deleteProperty(process.env, "WORKERS_V2_APP_READ_ONLY_GETS");
  } else {
    process.env.WORKERS_V2_APP_READ_ONLY_GETS = priorFlag;
  }
});
beforeEach(() => {
  process.env.WORKERS_V2_APP_READ_ONLY_GETS = "true";
  cacheRead.mockClear();
  write.mockClear();
  rpc.mockClear();
  positions.mockClear();
  ledgerRead.mockClear();
  portfolioRead.mockClear();
  userLookup.mockClear();
  accountLookup.mockClear();
  apy.mockClear();
  closed.mockClear();
  userLookup.mockResolvedValue({ id: "existing-user" });
  portfolioRead.mockResolvedValue(snapshots);
});
async function webRequest() {
  const token = await issueAuthSessionToken(
    {
      authMethod: "wallet",
      provider: "solana",
      subjectAddress: wallet,
      displayAddress: wallet,
      walletAddress: wallet,
      settingsPda: settings,
      smartAccountAddress: wallet,
    },
    sessionKey,
    60,
  );
  return new Request("http://localhost/earnings?timezone=UTC", {
    headers: { cookie: `loyal_wallet_session=${token}` },
  });
}
const mobileRequest = () =>
  new Request(`http://localhost/earnings?walletAddress=${wallet}&timezone=UTC`);
// Actual handlers, JWT/Base58 auth, dependency factory and financial calculator
// execute. Observed ledger/market reads are IO fixtures; no DB or RPC connection.
test("both earnings GETs calculate funded history without reading or writing cache", async () => {
  for (const [handler, request] of [
    [webGET, await webRequest()],
    [mobileGET, mobileRequest()],
  ] as const) {
    const response = await handler(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("ready");
    expect(body.freshness).toBe("fresh");
    expect(body.sourcePrincipalAmountRaw).toBe("100000000");
    expect(body.ranges.ALL.lifetimeEarnedUsd).toBeGreaterThan(0);
  }
  expect(cacheRead).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
  expect(closed).toHaveBeenCalledTimes(2);
});
test("actual session and wallet auth reject before financial history IO", async () => {
  const web = await webGET(new Request("http://localhost/earnings"));
  expect(web.status).toBe(401);
  expect((await web.json()).error.code).toBe("unauthenticated");
  const mobile = await mobileGET(
    new Request("http://localhost/earnings?walletAddress=111"),
  );
  expect(mobile.status).toBe(400);
  expect((await mobile.json()).error.code).toBe("invalid_wallet_address");
  expect(positions).not.toHaveBeenCalled();
  expect(ledgerRead).not.toHaveBeenCalled();
  expect(userLookup).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
test("missing mobile identity returns empty earnings without provisioning", async () => {
  userLookup.mockResolvedValue(null);
  const response = await mobileGET(mobileRequest());
  expect(response.status).toBe(200);
  expect((await response.json()).outcome).toBe("empty");
  expect(accountLookup).not.toHaveBeenCalled();
  expect(positions).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
test("missing exposure history returns public unavailable discriminant and never repairs", async () => {
  portfolioRead.mockResolvedValue([]);
  for (const [handler, request] of [
    [webGET, await webRequest()],
    [mobileGET, mobileRequest()],
  ] as const) {
    const response = await handler(request);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.outcome).toBe("unavailable");
    expect(body.error.code).toBe("history_incomplete");
    expect(body.error.detailCode).toBe("deposit_history_incomplete");
  }
  expect(cacheRead).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
test("legacy earnings executes counted snapshot writers even when best-effort cache fails", async () => {
  process.env.WORKERS_V2_APP_READ_ONLY_GETS = "false";
  expect((await webGET(await webRequest())).status).toBe(200);
  expect((await mobileGET(mobileRequest())).status).toBe(200);
  expect(cacheRead).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenCalledTimes(2);
});
