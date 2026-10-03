import { afterAll, beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const address = "11111111111111111111111111111111";
const state = {
  policy: null,
  status: "active",
  target: {
    active: true,
    lifecycleStatus: "active",
    policyAccount: address,
    policySeed: BigInt(9),
    recurringDelegation: address,
    walletBalanceFloorRaw: BigInt(100),
  },
};
const scheduled = {
  classification: "eligible",
  confidence: "confirmed",
  eligibleAfter: new Date("2026-10-02T00:00:00Z"),
  id: BigInt(1),
  lotCount: 1,
  originalAmountRaw: BigInt(200),
  reason: "funding",
  remainingAmountRaw: BigInt(200),
  slotId: BigInt(2),
  status: "scheduled",
};
const write = mock(() => {
  throw new Error("GET attempted a repair write");
});
const pairExists = mock(() => Promise.resolve(true));
mock.module("@/features/chat/server/app-user", () => ({
  findCurrentUser: () => Promise.resolve({ id: "user" }),
}));
mock.module("@/features/smart-accounts/server/service", () => ({
  findReadyCurrentUserSmartAccount: () =>
    Promise.resolve({ settingsPda: address, smartAccountAddress: address }),
}));
mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({ loyalSmartAccounts: { programId: address } }),
}));
mock.module("@/lib/core/config/solana-env-override", () => ({
  resolveLoyalWebSolanaEnvFromEnv: () => "mainnet-beta",
}));
mock.module("@/lib/solana/rpc-endpoints.server", () => ({
  getServerSolanaEndpoints: () => ({ rpcEndpoint: "https://rpc.invalid" }),
}));
mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: () => () => {
    throw new Error("GET attempted repair RPC");
  },
}));
mock.module("@loyal-labs/actions", () => ({
  resolveLoyalClusterForSolanaEnv: () => "mainnet-beta",
}));
mock.module("@/lib/yield-optimization/deployment-policy-signer.server", () => ({
  getDeploymentPolicySignerPublicKey: () => ({ toBase58: () => address }),
}));
mock.module(
  "@/lib/yield-optimization/earn-autodeposit-artifacts.server",
  () => ({
    healPendingEarnAutodepositArtifactProofs: write,
    probeEarnAutodepositArtifacts: write,
  })
);
mock.module(
  "@/lib/yield-optimization/earn-autodeposit-bootstrap.server",
  () => ({
    readEarnAutodepositBootstrapWalletBalanceSnapshot: write,
  })
);
mock.module("@/lib/yield-optimization/earn-position-gate.server", () => ({
  hasActiveEarnRoutePolicyPair: pairExists,
}));
mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION: "paused_missing_position",
    resolveEarnAutodepositStatus: (target: { active: boolean }) =>
      target.active ? "active" : "paused",
    findCurrentEarnAutodepositState: () => Promise.resolve(state),
    findPendingEarnAutodepositScheduledSweeps: () =>
      Promise.resolve([scheduled]),
    markAutodepositTargetActiveFromArtifacts: write,
    markAutodepositTargetClosedFromChain: write,
    markAutodepositTargetPendingDelegation: write,
    markAutodepositTargetPausedMissingPosition: write,
    resumeAutodepositTargetFromMissingPosition: write,
    suppressEarnAutodepositScheduledSweepsForMissingPosition: write,
    reconcileStaleEarnAutodepositScheduledSweeps: write,
    scheduleBootstrapEarnAutodepositSweep: write,
  })
);
const prior = process.env.WORKERS_V2_APP_READ_ONLY_GETS;
afterAll(() => {
  if (prior === undefined) {
    Reflect.deleteProperty(process.env, "WORKERS_V2_APP_READ_ONLY_GETS");
  } else {
    process.env.WORKERS_V2_APP_READ_ONLY_GETS = prior;
  }
});
beforeEach(() => {
  process.env.WORKERS_V2_APP_READ_ONLY_GETS = "true";
  write.mockClear();
  pairExists.mockResolvedValue(true);
});
const { GET } = await import("./route");

// Run this route suite in its own Bun process: module mocks intentionally
// replace external IO, while the actual route and pause derivation execute.
test("read-only mobile GET retains scheduled state without any repair", async () => {
  const response = await GET(
    new Request(`http://localhost/state?walletAddress=${address}`)
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.autodeposit.status).toBe("active");
  expect(body.autodeposit.walletBalanceFloorRaw).toBe("100");
  expect(body.autodeposit.scheduledSweeps[0].remainingAmountRaw).toBe("200");
  expect(write).not.toHaveBeenCalled();
});

test("missing-position GET reports an effective pause and preserves desired enablement", async () => {
  pairExists.mockResolvedValue(false);
  const response = await GET(
    new Request(`http://localhost/state?walletAddress=${address}`)
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.autodeposit.status).toBe("paused");
  expect(body.autodeposit.pauseReason).toBe("missing_position");
  expect(body.autodeposit.active).toBe(true);
  expect(body.autodeposit.lifecycleStatus).toBe("active");
  expect(body.autodeposit.scheduledSweeps).toEqual([]);
  expect(state.status).toBe("active");
  expect(write).not.toHaveBeenCalled();
});
