import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import {
  getKaminoUsdcEarnTargetForCluster,
  LoyalCluster,
} from "@loyal-labs/actions";
import { PgDialect } from "drizzle-orm/pg-core";

mock.module("server-only", () => ({}));
// Resolve the actual auth implementation without building workspace packages.
const authCore = await import(
  "../../../../../../../../packages/auth-core/src/index.ts"
);
mock.module("@loyal-labs/auth-core", () => authCore);
const wallet = "11111111111111111111111111111111";
const settings = "SysvarRent111111111111111111111111111111111";
// Public fixture-only JWT material; never a production secret or chain signer.
const sessionKey = "workers-v2-route-contract-test-only";
mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({
    authJwtSecret: sessionKey,
    loyalSmartAccounts: { programId: wallet },
  }),
}));
mock.module("@/lib/core/config/solana-env-override", () => ({
  resolveLoyalWebSolanaEnvFromEnv: () => "mainnet",
}));
const rpc = mock(() => {
  throw new Error("GET attempted financial RPC");
});
mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: () => rpc,
}));
mock.module("@/lib/kamino/timescale-reserve-client.server", () => ({
  getCurrentReserveUpdatesByReserve: () => Promise.resolve([]),
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
mock.module("@/lib/solana/rpc-endpoints.server", () => ({
  getServerSolanaEndpoints: () => ({
    rpcEndpoint: "https://rpc.invalid",
    websocketEndpoint: "wss://rpc.invalid",
  }),
}));
mock.module("@/lib/yield-optimization/deployment-policy-signer.server", () => ({
  getDeploymentPolicySignerPublicKey: () => ({ toBase58: () => wallet }),
}));
const repair = mock(() => {
  throw new Error("GET attempted autonomous Autodeposit repair");
});
mock.module(
  "@/lib/yield-optimization/earn-autodeposit-artifacts.server",
  () => ({
    healPendingEarnAutodepositArtifactProofs: repair,
    probeEarnAutodepositArtifacts: repair,
  }),
);
mock.module(
  "@/lib/yield-optimization/earn-autodeposit-bootstrap.server",
  () => ({ readEarnAutodepositBootstrapWalletBalanceSnapshot: rpc }),
);
const pairExists = mock(() => Promise.resolve(true));
mock.module("@/lib/yield-optimization/earn-position-gate.server", () => ({
  hasActiveEarnRoutePolicyPair: pairExists,
}));
const autodepositState = {
  policy: null,
  status: "active",
  target: {
    active: true,
    lifecycleStatus: "active",
    policyAccount: wallet,
    policySeed: BigInt(9),
    recurringDelegation: wallet,
    walletBalanceFloorRaw: BigInt(100),
    delegatedSigners: [wallet],
    maxAmountPerPeriod: BigInt(1000),
    lastSeenSlot: BigInt(50),
    firstSeenAt: new Date("2026-10-03T00:00:00Z"),
  },
};
const scheduled = {
  classification: "eligible",
  confidence: "confirmed",
  eligibleAfter: new Date("2026-10-03T00:00:00Z"),
  id: BigInt(1),
  lotCount: 1,
  originalAmountRaw: BigInt(200),
  reason: "funding",
  remainingAmountRaw: BigInt(200),
  slotId: BigInt(2),
  status: "scheduled",
};
mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION: "paused_missing_position",
    resolveEarnAutodepositStatus: (target: { active: boolean }) =>
      target.active ? "active" : "paused",
    findCurrentEarnAutodepositState: () => Promise.resolve(autodepositState),
    findPendingEarnAutodepositScheduledSweeps: () =>
      Promise.resolve([scheduled]),
    sumEarnAutodepositCurrentPeriodDeposits: () => Promise.resolve(BigInt(0)),
    markAutodepositTargetActiveFromArtifacts: repair,
    markAutodepositTargetClosedFromChain: repair,
    markAutodepositTargetPendingDelegation: repair,
    markAutodepositTargetPausedMissingPosition: repair,
    resumeAutodepositTargetFromMissingPosition: repair,
    suppressEarnAutodepositScheduledSweepsForMissingPosition: repair,
    reconcileStaleEarnAutodepositScheduledSweeps: repair,
    scheduleBootstrapEarnAutodepositSweep: repair,
  }),
);
mock.module("@/lib/yield-optimization/earn-autoswap-rollout.server", () => ({
  isEarnAutoswapEnrollmentEnabled: () => false,
}));
mock.module(
  "@/lib/yield-optimization/earn-cross-mint-repository.server",
  () => ({ findEarnCrossMintSnapshot: () => Promise.resolve(null) }),
);
const neon = await import("@/lib/yield-optimization/yield-neon-client.server");
const target = getKaminoUsdcEarnTargetForCluster(LoyalCluster.MainnetBeta);
const at = new Date("2026-10-03T00:00:00Z");
const position = {
  id: BigInt(22),
  walletAddress: wallet,
  settings,
  vaultIndex: 1,
  vaultPubkey: wallet,
  smartAccountAddress: wallet,
  status: "active",
  principalAmountRaw: BigInt(1000),
  initialPrincipalAmountRaw: BigInt(1000),
  currentAmountRaw: BigInt(1000),
  currentObservedAt: at,
  currentObservedSlot: BigInt(300),
  initialReserve: target.reserve.toBase58(),
  initialMarket: target.market.toBase58(),
  initialLiquidityMint: target.liquidityMint.toBase58(),
  initialSupplyApyBps: BigInt(100),
  currentReserve: target.reserve.toBase58(),
  currentMarket: target.market.toBase58(),
  currentLiquidityMint: target.liquidityMint.toBase58(),
  lastHoldingEventId: BigInt(33),
  lastRebalanceDecisionId: null,
  createdAt: at,
  updatedAt: at,
};
const event = {
  id: BigInt(33),
  positionId: position.id,
  eventType: "snapshot_reconciled",
  sourceSnapshotId: BigInt(77),
  amountRaw: BigInt(5000),
  reserve: position.currentReserve,
  market: position.currentMarket,
  liquidityMint: position.currentLiquidityMint,
  observedSlot: BigInt(350),
  observedAt: at,
};
let metadata: Record<string, unknown>;
const write = mock(() => {
  throw new Error("GET attempted financial projection write");
});
const read = mock(
  (options: { where: Parameters<PgDialect["sqlToQuery"]>[0] }) => {
    const scope = new PgDialect().sqlToQuery(options.where).params;
    return Promise.resolve(
      scope.includes(wallet) && scope.includes(settings) ? position : null,
    );
  },
);
const db = {
  query: {
    userYieldPositions: {
      findFirst: read,
      findMany: () => Promise.resolve([position]),
    },
    managedVaults: { findFirst: () => Promise.resolve({ id: BigInt(1) }) },
    rebalanceDecisions: { findFirst: () => Promise.resolve(null) },
    routePolicies: { findFirst: () => Promise.resolve(null) },
    earnDepositOnboardingAttempts: { findFirst: () => Promise.resolve(null) },
  },
  insert: write,
  update: write,
  delete: write,
  execute: write,
  transaction: write,
  select: () => {
    let rows: unknown[] = [];
    const query = {
      from: (table: unknown) => {
        if (table === neon.userYieldPositionHoldingEvents) {
          rows = [event];
        } else if (table === neon.vaultPositionSnapshotPositions) {
          rows = [{ planningMetadata: metadata }];
        } else if (table === neon.vaultReservePositionsCurrent) {
          rows = [
            {
              ...event,
              snapshotId: BigInt(88),
              amountRaw: BigInt(4210),
              planningMetadata: {
                amountSemantics: "kamino_redeemable_liquidity",
              },
            },
          ];
        } else if (table === neon.vaultIdleTokenBalancesCurrent) {
          rows = [];
        } else {
          throw new Error("unexpected financial table read");
        }
        return query;
      },
      where: () => query,
      orderBy: () => query,
      limit: () => Promise.resolve(rows),
      // biome-ignore lint/suspicious/noThenProperty: Match awaited Drizzle reads so the actual repository executes with forbidden writes counted.
      then: <T>(
        fulfilled: (value: unknown[]) => T,
        rejected?: (reason: unknown) => T,
      ) => Promise.resolve(rows).then(fulfilled, rejected),
    };
    return query;
  },
};
const clientSpy = spyOn(neon, "getYieldOptimizationClient").mockReturnValue({
  db,
} as never);
const { issueAuthSessionToken } = await import(
  "@/features/identity/server/session-token"
);
const { AuthGatewayError } = await import(
  "@/features/identity/server/auth-session"
);
const { GET: webGET } = await import("./route");
const { GET: mobileGET } = await import(
  "@/app/api/smart-accounts/mobile/earn/state/route"
);
const { GET: stateGET } = await import(
  "@/app/api/smart-accounts/yield-optimization/earn-state/route"
);
const priorFlag = process.env.WORKERS_V2_APP_READ_ONLY_GETS;
afterAll(() => {
  clientSpy.mockRestore();
  if (priorFlag === undefined) {
    Reflect.deleteProperty(process.env, "WORKERS_V2_APP_READ_ONLY_GETS");
  } else {
    process.env.WORKERS_V2_APP_READ_ONLY_GETS = priorFlag;
  }
});
beforeEach(() => {
  process.env.WORKERS_V2_APP_READ_ONLY_GETS = "true";
  metadata = {
    amountSemantics: "kamino_obligation_collateral_deposited_amount",
    redeemable_liquidity_amount_raw: "4210",
  };
  write.mockClear();
  rpc.mockClear();
  read.mockClear();
  userLookup.mockClear();
  accountLookup.mockClear();
  repair.mockClear();
  pairExists.mockResolvedValue(true);
  userLookup.mockResolvedValue({ id: "existing-user" });
  accountLookup.mockResolvedValue({
    settingsPda: settings,
    smartAccountAddress: wallet,
  });
});
async function sessionRequest(overrides = {}, ttl = 60) {
  const token = await issueAuthSessionToken(
    {
      authMethod: "wallet",
      provider: "solana",
      subjectAddress: wallet,
      displayAddress: wallet,
      walletAddress: wallet,
      settingsPda: settings,
      smartAccountAddress: wallet,
      ...overrides,
    },
    sessionKey,
    ttl,
  );
  return new Request(
    "http://localhost/position?walletAddress=not-the-session-owner",
    { headers: { cookie: `loyal_wallet_session=${token}` } },
  );
}
// Isolated Bun process: actual handler, auth/JWT and repository reconciliation;
// external DB/provider boundaries are replaced. No live IO or frontend build.
test("web position projects recorded liquidity without repairing persisted principal", async () => {
  const response = await webGET(await sessionRequest());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.position.currentHolding.amountRaw).toBe("4210");
  expect(body.position.principalAmountRaw).toBe("1000");
  expect(position.currentAmountRaw).toBe(BigInt(1000));
  expect(write).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
test("mobile position executes actual wallet discriminator before reads", async () => {
  const response = await mobileGET(
    new Request(`http://localhost/state?walletAddress=${wallet}`),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).position.status).toBe("active");
  expect(write).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
  for (const address of ["", "not-base58", "111"]) {
    read.mockClear();
    userLookup.mockClear();
    accountLookup.mockClear();
    const invalid = await mobileGET(
      new Request(`http://localhost/state?walletAddress=${address}`),
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe(
      address ? "invalid_wallet_address" : "invalid_request",
    );
    expect(read).not.toHaveBeenCalled();
    expect(userLookup).not.toHaveBeenCalled();
    expect(accountLookup).not.toHaveBeenCalled();
  }
});
test("mobile absent identity returns empty state without provisioning or repairs", async () => {
  userLookup.mockResolvedValue(null);
  const response = await mobileGET(
    new Request(`http://localhost/state?walletAddress=${wallet}`),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).position).toBeNull();
  expect(accountLookup).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
test("web absent, forged and expired sessions reject before financial reads", async () => {
  for (const request of [
    new Request("http://localhost/position"),
    new Request("http://localhost/position", {
      headers: { cookie: "loyal_wallet_session=forged" },
    }),
    await sessionRequest({}, -1),
  ]) {
    const response = await webGET(request);
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthenticated");
  }
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
test("signed mismatched wallet principal rejects before financial reads", async () => {
  await expect(
    webGET(await sessionRequest({ subjectAddress: settings })),
  ).rejects.toBeInstanceOf(AuthGatewayError);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
test("missing conversion holds mobile read instead of inventing liquidity", async () => {
  metadata = {
    amountSemantics: "kamino_obligation_collateral_deposited_amount",
  };
  const response = await mobileGET(
    new Request(`http://localhost/state?walletAddress=${wallet}`),
  );
  expect(response.status).toBe(502);
  expect((await response.json()).error.code).toBe("earn_state_failed");
  expect(write).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
test("legacy GET reaches repair, proving forbidden-write detection", async () => {
  process.env.WORKERS_V2_APP_READ_ONLY_GETS = "false";
  await expect(webGET(await sessionRequest())).rejects.toThrow(
    "financial projection write",
  );
  expect(write).toHaveBeenCalled();
});

test("composite web Earn GET retains autonomous scheduled progress without repair or RPC", async () => {
  const response = await stateGET(await sessionRequest());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.autodeposit.status).toBe("active");
  expect(body.autodeposit.scheduledSweeps[0].remainingAmountRaw).toBe("200");
  expect(write).not.toHaveBeenCalled();
  expect(repair).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
test("composite missing-position pause is effective only and keeps desired control", async () => {
  pairExists.mockResolvedValue(false);
  const response = await stateGET(await sessionRequest());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.autodeposit.pauseReason).toBe("missing_position");
  expect(body.autodeposit.status).toBe("paused");
  expect(body.autodeposit.active).toBe(true);
  expect(body.autodeposit.scheduledSweeps).toHaveLength(0);
  expect(autodepositState.status).toBe("active");
  expect(autodepositState.target.active).toBe(true);
  expect(write).not.toHaveBeenCalled();
  expect(repair).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
