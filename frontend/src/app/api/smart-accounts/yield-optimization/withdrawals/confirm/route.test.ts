import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Connection, PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const principal = {
  settingsPda: "11111111111111111111111111111112",
  smartAccountAddress: "11111111111111111111111111111113",
  walletAddress: "11111111111111111111111111111114",
};
const canonical = {
  liquidityMint: "11111111111111111111111111111115",
  market: "11111111111111111111111111111116",
  policyAccount: "11111111111111111111111111111117",
  reserve: "11111111111111111111111111111118",
  vaultPubkey: "11111111111111111111111111111119",
};

let parsedInput: Record<string, unknown>;
let callOrder: string[] = [];
let closeCalls: unknown[] = [];
let withdrawalCalls: unknown[] = [];

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => principal,
}));

mock.module("@/lib/core/config/solana-env-override", () => ({
  resolveLoyalWebSolanaEnvFromEnv: () => "mainnet",
}));

mock.module("@/lib/solana/rpc-endpoints", () => ({
  getFrontendSolanaEndpoints: () => ({
    rpcEndpoint: "http://127.0.0.1:8899",
    websocketEndpoint: "ws://127.0.0.1:8900",
  }),
}));

mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: (fetchImpl: typeof fetch) => fetchImpl,
}));

mock.module("@loyal-labs/actions", () => ({
  getKaminoUsdcEarnTargetForCluster: () => ({
    liquidityMint: new PublicKey(canonical.liquidityMint),
    market: new PublicKey(canonical.market),
    reserve: new PublicKey(canonical.reserve),
  }),
  normalizeLoyalCluster: (cluster: string) => cluster,
  resolveLoyalClusterForSolanaEnv: () => "mainnet-beta",
}));

mock.module("@loyal-labs/loyal-smart-accounts", () => ({
  pda: {
    getPolicyPda: () => [new PublicKey(canonical.policyAccount)],
    getSmartAccountPda: () => [new PublicKey(canonical.vaultPubkey)],
  },
}));

mock.module("@/lib/yield-optimization/earn-confirm-contracts.shared", () => ({
  parseEarnWithdrawalConfirmRequestBody: () => parsedInput,
}));

mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    recordClosedAutodepositTarget: async (input: unknown) => {
      callOrder.push("close-autodeposit");
      closeCalls.push(input);
      return {};
    },
  })
);

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  recordConfirmedYieldWithdrawal: async (input: unknown) => {
    callOrder.push("record-withdrawal");
    withdrawalCalls.push(input);
    return {
      currentAmountRaw: BigInt(0),
      currentLiquidityMint: canonical.liquidityMint,
      currentMarket: canonical.market,
      currentObservedAt: new Date("2026-06-02T00:00:00.000Z"),
      currentObservedSlot: BigInt(300),
      currentReserve: canonical.reserve,
      id: BigInt(1),
      initialLiquidityMint: canonical.liquidityMint,
      initialMarket: canonical.market,
      initialReserve: canonical.reserve,
      initialSupplyApyBps: null,
      lastHoldingEventId: BigInt(2),
      lastRebalanceDecisionId: null,
      principalAmountRaw: BigInt(0),
      status: "closed",
    };
  },
}));

function createFullWithdrawalInput(overrides: Record<string, unknown> = {}) {
  return {
    autodepositClose: {
      closeSignature: "autodeposit-close-signature",
      confirmedSlot: BigInt(299),
      delegatedSigner: "autodeposit-delegate",
      policyAccount: "1111111111111111111111111111111A",
      recurringDelegation: "1111111111111111111111111111111B",
    },
    cluster: "mainnet-beta",
    confirmedSlot: BigInt(300),
    delegatedSigner: "yield-delegate",
    liquidityMint: canonical.liquidityMint,
    market: canonical.market,
    mode: "full",
    policyAccount: canonical.policyAccount,
    policyId: BigInt(7),
    policySeed: BigInt(7),
    settings: principal.settingsPda,
    smartAccountAddress: principal.smartAccountAddress,
    targetReserve: canonical.reserve,
    vaultIndex: 1,
    vaultPubkey: canonical.vaultPubkey,
    walletAddress: principal.walletAddress,
    withdrawalSignature: "withdrawal-signature",
    withdrawnAmountRaw: BigInt(1000000),
    ...overrides,
  };
}

describe("Earn withdrawal confirm route", () => {
  beforeEach(() => {
    parsedInput = createFullWithdrawalInput();
    callOrder = [];
    closeCalls = [];
    withdrawalCalls = [];
    Connection.prototype.getSignatureStatuses = mock(async (signatures) => ({
      value: [
        {
          confirmationStatus: "confirmed",
          err: null,
          slot:
            Array.isArray(signatures) &&
            signatures[0] === "autodeposit-close-signature"
              ? 299
              : 300,
        },
      ],
    })) as never;
  });

  test("verifies and closes split autodeposit target before recording full withdrawal", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/withdrawals/confirm", {
        body: JSON.stringify({}),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(callOrder).toEqual(["close-autodeposit", "record-withdrawal"]);
    expect(closeCalls).toEqual([
      {
        cluster: "mainnet-beta",
        closeSignature: "autodeposit-close-signature",
        confirmedSlot: BigInt(299),
        delegatedSigner: "autodeposit-delegate",
        policyAccount: "1111111111111111111111111111111A",
        recurringDelegation: "1111111111111111111111111111111B",
        settings: principal.settingsPda,
        vaultIndex: 1,
        vaultPubkey: canonical.vaultPubkey,
        walletAddress: principal.walletAddress,
      },
    ]);
    expect(withdrawalCalls[0]).toMatchObject({
      autodepositClose: {
        closeSignature: "autodeposit-close-signature",
        confirmedSlot: BigInt(299),
        delegatedSigner: "autodeposit-delegate",
        policyAccount: "1111111111111111111111111111111A",
        recurringDelegation: "1111111111111111111111111111111B",
      },
      mode: "full",
      withdrawalSignature: "withdrawal-signature",
    });
  });

  test("rejects autodeposit close metadata on partial confirmations", async () => {
    const { POST } = await import("./route");
    parsedInput = createFullWithdrawalInput({ mode: "partial" });

    const response = await POST(
      new Request("http://localhost/api/withdrawals/confirm", {
        body: JSON.stringify({}),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(callOrder).toEqual([]);
  });

  test("rejects mismatched split autodeposit close slots", async () => {
    const { POST } = await import("./route");
    parsedInput = createFullWithdrawalInput({
      autodepositClose: {
        closeSignature: "autodeposit-close-signature",
        confirmedSlot: BigInt(301),
        delegatedSigner: "autodeposit-delegate",
        policyAccount: "1111111111111111111111111111111A",
        recurringDelegation: "1111111111111111111111111111111B",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/withdrawals/confirm", {
        body: JSON.stringify({}),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(callOrder).toEqual([]);
  });
});
