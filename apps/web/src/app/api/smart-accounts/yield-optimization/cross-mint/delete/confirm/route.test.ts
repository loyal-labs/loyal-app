import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Connection } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const principal = {
  authMethod: "wallet" as const,
  provider: "solana" as const,
  settingsPda: "11111111111111111111111111111112",
  smartAccountAddress: "11111111111111111111111111111113",
  subjectAddress: "11111111111111111111111111111114",
  walletAddress: "11111111111111111111111111111114",
};
const removeEarnCrossMintOptIn = mock(async () => {});
const getSignatureStatuses = spyOn(
  Connection.prototype,
  "getSignatureStatuses"
);
const getMultipleAccountsInfoAndContext = spyOn(
  Connection.prototype,
  "getMultipleAccountsInfoAndContext"
);

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => principal,
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
mock.module(
  "@/lib/yield-optimization/earn-cross-mint-repository.server",
  () => ({ removeEarnCrossMintOptIn })
);

const { POST } = await import("./route");

function request() {
  return new Request("https://loyal.local/delete/confirm", {
    body: JSON.stringify({
      expectedGeneration: "2",
      finalizedSlot: "321",
      policies: [
        "11111111111111111111111111111115",
        "11111111111111111111111111111116",
      ],
      signature: "finalized-delete-signature",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

beforeEach(() => {
  removeEarnCrossMintOptIn.mockClear();
  getSignatureStatuses.mockResolvedValue({
    context: { slot: 321 },
    value: [
      {
        confirmationStatus: "finalized",
        confirmations: null,
        err: null,
        slot: 321,
      },
    ],
  });
});

test("Autoswap deletion rejects absence read behind the finalized close", async () => {
  getMultipleAccountsInfoAndContext.mockResolvedValue({
    context: { slot: 320 },
    value: [null, null],
  });

  const response = await POST(request());

  expect(response.status).toBe(409);
  expect(removeEarnCrossMintOptIn).not.toHaveBeenCalled();
});

test("Autoswap deletion removes enrollment after slot-fenced finalized absence", async () => {
  getMultipleAccountsInfoAndContext.mockResolvedValue({
    context: { slot: 322 },
    value: [null, null],
  });

  const response = await POST(request());

  expect(response.status).toBe(200);
  expect(removeEarnCrossMintOptIn).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedGeneration: BigInt(2),
      expectedPolicyAccounts: [
        "11111111111111111111111111111115",
        "11111111111111111111111111111116",
      ],
    })
  );
});
