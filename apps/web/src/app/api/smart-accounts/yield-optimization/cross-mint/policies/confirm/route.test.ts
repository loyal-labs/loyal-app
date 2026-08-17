import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Connection, PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const WALLET = "11111111111111111111111111111114";
const principal = {
  authMethod: "wallet" as const,
  provider: "solana" as const,
  settingsPda: "11111111111111111111111111111112",
  smartAccountAddress: "11111111111111111111111111111113",
  subjectAddress: WALLET,
  walletAddress: WALLET,
};
const originalRollout = process.env.EARN_AUTOSWAP_ENABLED_WALLETS;
const assertEarnCrossMintCanonicalArtifacts = mock(async () => {});
const findEarnCrossMintState = mock(async () => null);
const hasActiveEarnPosition = mock(async () => true);
const hasActiveEarnRoutePolicyPair = mock(async () => true);
const recordEarnCrossMintEnrollment = mock(async () => true);
const getSignatureStatuses = spyOn(
  Connection.prototype,
  "getSignatureStatuses"
);

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => principal,
}));
mock.module("@loyal-labs/smart-account-vaults", () => ({
  createSmartAccountVaultsClient: () => ({
    assertEarnCrossMintCanonicalArtifacts,
  }),
}));
mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({
    loyalSmartAccounts: {
      programId: "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG",
    },
  }),
}));
mock.module("@/lib/core/config/solana-env-override", () => ({
  resolveLoyalWebSolanaEnvFromEnv: () => "mainnet",
}));
mock.module("@/lib/solana/rpc-endpoints.server", () => ({
  getServerSolanaEndpoints: () => ({
    rpcEndpoint: "https://rpc.invalid",
    websocketEndpoint: "wss://rpc.invalid",
  }),
}));
mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: () => globalThis.fetch,
}));
mock.module("@/lib/yield-optimization/deployment-policy-signer.server", () => ({
  getDeploymentPolicySignerPublicKey: () =>
    new PublicKey("11111111111111111111111111111117"),
}));
mock.module(
  "@/lib/yield-optimization/earn-cross-mint-repository.server",
  () => ({ findEarnCrossMintState, recordEarnCrossMintEnrollment })
);
mock.module("@/lib/yield-optimization/earn-position-gate.server", () => ({
  hasActiveEarnPosition,
  hasActiveEarnRoutePolicyPair,
}));

const { POST } = await import("./route");

beforeEach(() => {
  process.env.EARN_AUTOSWAP_ENABLED_WALLETS = WALLET;
  assertEarnCrossMintCanonicalArtifacts.mockClear();
  findEarnCrossMintState.mockClear();
  hasActiveEarnPosition.mockClear();
  hasActiveEarnPosition.mockResolvedValue(true);
  hasActiveEarnRoutePolicyPair.mockClear();
  hasActiveEarnRoutePolicyPair.mockResolvedValue(true);
  recordEarnCrossMintEnrollment.mockClear();
  recordEarnCrossMintEnrollment.mockResolvedValue(true);
  getSignatureStatuses.mockResolvedValue({
    context: { slot: 120 },
    value: [
      {
        confirmationStatus: "finalized",
        confirmations: null,
        err: null,
        slot: 100,
      },
      {
        confirmationStatus: "finalized",
        confirmations: null,
        err: null,
        slot: 120,
      },
    ],
  });
});

afterAll(() => {
  if (originalRollout === undefined) {
    delete process.env.EARN_AUTOSWAP_ENABLED_WALLETS;
  } else {
    process.env.EARN_AUTOSWAP_ENABLED_WALLETS = originalRollout;
  }
});

test("Autoswap setup reads both policies no earlier than the newest finalized create", async () => {
  const response = await POST(
    new Request("https://loyal.local/policies/confirm", {
      body: JSON.stringify({
        dailySourceMintSpendingCap: "100000000",
        maxSlippageBps: 50,
        policies: [
          {
            account: "11111111111111111111111111111115",
            finalizedSlot: "100",
            seed: "11",
            signature: "classic-create-signature",
            sourceShard: "classic",
          },
          {
            account: "11111111111111111111111111111116",
            finalizedSlot: "120",
            seed: "12",
            signature: "token-2022-create-signature",
            sourceShard: "token_2022",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );

  expect(response.status).toBe(200);
  expect(assertEarnCrossMintCanonicalArtifacts).toHaveBeenCalledWith(
    expect.objectContaining({ minContextSlot: 120 })
  );
  expect(recordEarnCrossMintEnrollment).toHaveBeenCalledTimes(1);
});

test("Autoswap setup replay reports a preserved paused enrollment", async () => {
  recordEarnCrossMintEnrollment.mockResolvedValueOnce(false);

  const response = await POST(
    new Request("https://loyal.local/policies/confirm", {
      body: JSON.stringify({
        dailySourceMintSpendingCap: "100000000",
        maxSlippageBps: 50,
        policies: [
          {
            account: "11111111111111111111111111111115",
            finalizedSlot: "100",
            seed: "11",
            signature: "classic-create-signature",
            sourceShard: "classic",
          },
          {
            account: "11111111111111111111111111111116",
            finalizedSlot: "120",
            seed: "12",
            signature: "token-2022-create-signature",
            sourceShard: "token_2022",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    enabled: false,
    status: "paused",
  });
});

test("Autoswap first enrollment requires an active Earn position", async () => {
  hasActiveEarnPosition.mockResolvedValue(false);

  const response = await POST(
    new Request("https://loyal.local/policies/confirm", {
      body: JSON.stringify({
        dailySourceMintSpendingCap: "100000000",
        maxSlippageBps: 50,
        policies: [
          {
            account: "11111111111111111111111111111115",
            seed: "11",
            sourceShard: "classic",
          },
          {
            account: "11111111111111111111111111111116",
            seed: "12",
            sourceShard: "token_2022",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "earn_position_required" },
  });
  expect(assertEarnCrossMintCanonicalArtifacts).not.toHaveBeenCalled();
  expect(recordEarnCrossMintEnrollment).not.toHaveBeenCalled();
});
