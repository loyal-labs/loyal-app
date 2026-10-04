import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { KAMINO_MAIN_MARKET, STABLECOIN_MINTS } from "@loyal-labs/actions";
import type { UserYieldPositionHistoryEventRecord } from "@/lib/yield-optimization/yield-deposit-repository.server";

mock.module("server-only", () => ({}));
const authCore = await import(
  "../../../../../../../packages/auth-core/src/index.ts"
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
  Promise.resolve<{ settingsPda: string; smartAccountAddress: string } | null>({
    settingsPda: settings,
    smartAccountAddress: wallet,
  }),
);
mock.module("@/features/chat/server/app-user", () => ({
  findCurrentUser: userLookup,
}));
mock.module("@/features/smart-accounts/server/service", () => ({
  findReadyCurrentUserSmartAccount: accountLookup,
}));
const repair = mock(() => {
  throw new Error("GET attempted autonomous holding-event backfill");
});
const row = {
  id: BigInt(1),
  positionId: BigInt(22),
  amountRaw: BigInt(2000000),
  principalAmountRaw: BigInt(2000000),
  principalDeltaRaw: BigInt(2000000),
  confirmedAt: new Date("2026-10-03T00:00:00Z"),
  confirmedSlot: BigInt(100),
  liquidityMint: STABLECOIN_MINTS.USDC.toBase58(),
  market: KAMINO_MAIN_MARKET.toBase58(),
  reserve: "reserve",
  signature: "observed-deposit",
  eventType: "deposit_initialized",
  type: "deposit",
} satisfies UserYieldPositionHistoryEventRecord;
const history = mock(() => Promise.resolve([row]));
const autodepositHistory = mock(() => Promise.resolve([]));
mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findYieldPositionHistoryEventsForVault: history,
  syncConfirmedRebalanceHoldingEventsForVault: repair,
}));
mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({ findEarnAutodepositHistoryEvents: autodepositHistory }),
);
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
  "@/app/api/smart-accounts/mobile/earn/transactions/route"
);
const priorFlag = process.env.WORKERS_V2_APP_READ_ONLY_GETS;
afterAll(() => {
  if (priorFlag === undefined) {
    Reflect.deleteProperty(process.env, "WORKERS_V2_APP_READ_ONLY_GETS");
  } else {
    process.env.WORKERS_V2_APP_READ_ONLY_GETS = priorFlag;
  }
});
beforeEach(() => {
  process.env.WORKERS_V2_APP_READ_ONLY_GETS = "true";
  repair.mockClear();
  rpc.mockClear();
  history.mockClear();
  autodepositHistory.mockClear();
  userLookup.mockClear();
  accountLookup.mockClear();
  userLookup.mockResolvedValue({ id: "existing-user" });
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
  return new Request("http://localhost/transactions", {
    headers: { cookie: `loyal_wallet_session=${token}` },
  });
}
const mobileRequest = () =>
  new Request(`http://localhost/transactions?walletAddress=${wallet}`);
// Actual routes, formatter and auth execute; observed history readers are IO
// fixtures. Run independently from repository suites to isolate module mocks.
test("both authenticated transaction GETs serve persisted history without backfill", async () => {
  for (const [handler, request] of [
    [webGET, await webRequest()],
    [mobileGET, mobileRequest()],
  ] as const) {
    const response = await handler(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transactions[0].kind).toBe("deposit");
    expect(body.transactions[0].signature).toBe("observed-deposit");
  }
  expect(repair).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
test("actual unauthenticated and malformed-wallet branches reject before history IO", async () => {
  const web = await webGET(new Request("http://localhost/transactions"));
  expect(web.status).toBe(401);
  expect((await web.json()).error.code).toBe("unauthenticated");
  const mobile = await mobileGET(
    new Request("http://localhost/transactions?walletAddress=111"),
  );
  expect(mobile.status).toBe(400);
  expect((await mobile.json()).error.code).toBe("invalid_wallet_address");
  expect(history).not.toHaveBeenCalled();
  expect(autodepositHistory).not.toHaveBeenCalled();
  expect(userLookup).not.toHaveBeenCalled();
  expect(repair).not.toHaveBeenCalled();
});
test("mobile missing user returns empty history without provisioning", async () => {
  userLookup.mockResolvedValue(null);
  const response = await mobileGET(mobileRequest());
  expect(response.status).toBe(200);
  expect((await response.json()).transactions).toHaveLength(0);
  expect(accountLookup).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
  expect(repair).not.toHaveBeenCalled();
});
test("legacy transaction GETs reach the forbidden writer and preserve failure discriminants", async () => {
  process.env.WORKERS_V2_APP_READ_ONLY_GETS = "false";
  const web = await webGET(await webRequest());
  expect(web.status).toBe(503);
  expect((await web.json()).error.code).toBe("earn_transactions_unavailable");
  const mobile = await mobileGET(mobileRequest());
  expect(mobile.status).toBe(502);
  expect((await mobile.json()).error.code).toBe("earn_transactions_failed");
  expect(repair).toHaveBeenCalledTimes(2);
  expect(history).not.toHaveBeenCalled();
});
