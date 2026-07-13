import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const principal = {
  settingsPda: "11111111111111111111111111111112",
  smartAccountAddress: "11111111111111111111111111111113",
  walletAddress: Keypair.fromSeed(new Uint8Array(32).fill(1))
    .publicKey.toBase58(),
};
const canonical = {
  liquidityMint: "11111111111111111111111111111115",
  market: "11111111111111111111111111111116",
  policyAccount: "11111111111111111111111111111117",
  reserve: "11111111111111111111111111111118",
  setupPolicyAccount: "1111111111111111111111111111111A",
  vaultPubkey: "11111111111111111111111111111119",
};

let parsedInput: Record<string, unknown>;
let resolvedPrincipal: typeof principal | null = principal;
let callOrder: string[] = [];
let depositCalls: unknown[] = [];
let reconcileCalls: unknown[] = [];
let withdrawalCalls: unknown[] = [];
let fullExitProofStatus: "full_exit_incomplete" | "policy_close_required" =
  "full_exit_incomplete";
let fullExitProofError: Error | null = null;

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => resolvedPrincipal,
}));

mock.module("@/lib/core/config/solana-env-override", () => ({
  resolveLoyalWebSolanaEnvFromEnv: () => "mainnet",
}));

mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({
    loyalSmartAccounts: {
      programId: "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG",
    },
  }),
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
  PROGRAM_ADDRESS: "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG",
  pda: {
    getPolicyPda: (input: { policySeed: number }) => [
      new PublicKey(
        input.policySeed === 8
          ? canonical.setupPolicyAccount
          : canonical.policyAccount
      ),
    ],
    getSmartAccountPda: () => [new PublicKey(canonical.vaultPubkey)],
  },
}));

mock.module("@/lib/yield-optimization/earn-confirm-contracts.shared", () => ({
  parseEarnDepositConfirmRequestBody: () => parsedInput,
  parseEarnWithdrawalConfirmRequestBody: () => parsedInput,
}));

mock.module("@/lib/yield-optimization/earn-reserve-target.server", () => ({
  assertSafeUsdcEarnReserveMetadata: (input: {
    liquidityMint: string;
    market: string | null;
    targetReserve: string;
  }) => {
    if (
      input.liquidityMint !== canonical.liquidityMint ||
      input.market !== canonical.market ||
      input.targetReserve !== canonical.reserve
    ) {
      throw new Error("Earn reserve metadata mismatch.");
    }

    return {
      liquidityMint: input.liquidityMint,
      market: input.market,
      targetReserve: input.targetReserve,
    };
  },
}));

mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    findCurrentEarnAutodepositState: async () => {
      throw new Error("findCurrentEarnAutodepositState was not expected.");
    },
    recordClosedAutodepositTarget: async () => {
      throw new Error("recordClosedAutodepositTarget was not expected.");
    },
  })
);

mock.module(
  "@/lib/yield-optimization/earn-position-reconciliation.server",
  () => ({
    reconcileEarnVaultPosition: async (input: unknown) => {
      callOrder.push("reconcile");
      reconcileCalls.push(input);
      return { status: "refreshed" };
    },
  })
);

mock.module(
  "@/lib/yield-optimization/earn-full-exit-zero-proof.server",
  () => ({
    verifyEarnFullExitZeroBalances: async () => {
      callOrder.push("verify-zero");
      if (fullExitProofError) {
        throw fullExitProofError;
      }
      return {
        blockingTokenAccounts: [],
        closeableTokenAccounts: [],
        idleAmountRaw: "0",
        idleReadsAgree: true,
        observedSlot: "300",
        remainingHoldings:
          fullExitProofStatus === "full_exit_incomplete"
            ? [
                {
                  amountRaw: "1",
                  kind: "kamino",
                  liquidityMint: canonical.liquidityMint,
                  market: canonical.market,
                  reserve: canonical.reserve,
                },
              ]
            : [],
        status: fullExitProofStatus,
      };
    },
  })
);

mock.module(
  "@/lib/yield-optimization/earn-state-serializers.server",
  () => ({
    serializeRoutePolicyState: () => ({ vaultIndex: 1 }),
  })
);

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findActiveYieldRoutePolicy: async () => {
    throw new Error("findActiveYieldRoutePolicy was not expected.");
  },
  findEarnCleanupVaultState: async () => ({
    routePolicy: {},
    setupPolicy: null,
  }),
  findReconciledActiveYieldPositionForVault: async () => ({
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
    status: "active",
  }),
  markEarnDepositOnboardingAccountingFailed: async () => {},
  markEarnDepositOnboardingComplete: async () => {},
  recordEarnDepositOnboardingDepositSignature: async () => ({}),
  recordConfirmedYieldDeposit: async (input: unknown) => {
    depositCalls.push(input);
    return {
      currentAmountRaw: BigInt(1000000),
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
      principalAmountRaw: BigInt(1000000),
      status: "active",
    };
  },
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
      status: "active",
    };
  },
}));

function createDepositInput(overrides: Record<string, unknown> = {}) {
  return {
    cluster: "mainnet-beta",
    confirmedSlot: BigInt(300),
    delegatedSigner: "yield-delegate",
    depositMint: canonical.liquidityMint,
    depositSignature: "deposit-signature",
    liquidityMint: canonical.liquidityMint,
    market: canonical.market,
    policyAccount: canonical.policyAccount,
    policyConfirmedSlot: BigInt(300),
    policyId: BigInt(7),
    policyInitialization: "create",
    policySeed: BigInt(7),
    policySignature: "policy-signature",
    principalAmountRaw: BigInt(1000000),
    settings: principal.settingsPda,
    setupPolicyAccount: canonical.setupPolicyAccount,
    setupPolicyConfirmedSlot: BigInt(300),
    setupPolicyId: BigInt(8),
    setupPolicySeed: BigInt(8),
    setupPolicySignature: "setup-policy-signature",
    smartAccountAddress: canonical.vaultPubkey,
    targetReserve: canonical.reserve,
    targetSupplyApyBps: BigInt(123),
    vaultIndex: 1,
    vaultPubkey: canonical.vaultPubkey,
    walletAddress: principal.walletAddress,
    ...overrides,
  };
}

function createFullWithdrawalInput(overrides: Record<string, unknown> = {}) {
  return {
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
    smartAccountAddress: canonical.vaultPubkey,
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
    resolvedPrincipal = principal;
    callOrder = [];
    depositCalls = [];
    reconcileCalls = [];
    withdrawalCalls = [];
    fullExitProofError = null;
    fullExitProofStatus = "full_exit_incomplete";
    Connection.prototype.getSignatureStatuses = mock(async () => ({
      value: [
        {
          confirmationStatus: "confirmed",
          err: null,
          slot: 300,
        },
      ],
    })) as never;
    Connection.prototype.getParsedTransaction = mock(async () => ({
      blockTime: 1,
      meta: {
        err: null,
        fee: 5000,
        innerInstructions: null,
        logMessages: [],
        postBalances: [1],
        postTokenBalances: [
          {
            accountIndex: 0,
            mint: canonical.liquidityMint,
            owner: principal.walletAddress,
            uiTokenAmount: {
              amount: "1000000",
              decimals: 6,
              uiAmount: 1,
              uiAmountString: "1",
            },
          },
        ],
        preBalances: [1],
        preTokenBalances: [
          {
            accountIndex: 0,
            mint: canonical.liquidityMint,
            owner: principal.walletAddress,
            uiTokenAmount: {
              amount: "0",
              decimals: 6,
              uiAmount: 0,
              uiAmountString: "0",
            },
          },
        ],
        rewards: [],
        status: { Ok: null },
      },
      slot: 300,
      transaction: {
        message: {
          accountKeys: [
            {
              pubkey: new PublicKey("1111111111111111111111111111111B"),
              signer: false,
              source: "transaction",
              writable: true,
            },
          ],
          addressTableLookups: null,
          instructions: [],
          recentBlockhash: "11111111111111111111111111111111",
        },
        signatures: ["withdrawal-signature"],
      },
    })) as never;
  });

  test("does not reconcile holdings until zero verification succeeds", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/withdrawals/confirm", {
        body: JSON.stringify({}),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      position: { status: "active" },
      status: "full_exit_incomplete",
    });
    expect(callOrder).toEqual(["record-withdrawal", "verify-zero"]);
    expect(reconcileCalls).toEqual([]);
    expect(withdrawalCalls[0]).toMatchObject({
      mode: "full",
      withdrawalSignature: "withdrawal-signature",
    });
  });

  test("rejects policy close metadata on every withdrawal confirmation", async () => {
    const { POST } = await import("./route");
    parsedInput = createFullWithdrawalInput({
      autodepositClose: {
        closeSignature: "autodeposit-close-signature",
        confirmedSlot: BigInt(299),
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

  test("returns retryable after recording when post-withdraw RPC verification fails", async () => {
    const { POST } = await import("./route");
    fullExitProofError = new Error("minimum context slot has not been reached");

    const response = await POST(
      new Request("http://localhost/api/withdrawals/confirm", {
        body: JSON.stringify({}),
        method: "POST",
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "full_exit_verification_retryable" },
    });
    expect(callOrder).toEqual(["record-withdrawal", "verify-zero"]);
    expect(reconcileCalls).toEqual([]);
  });

  test("reports policy close required without closing the active position", async () => {
    const { POST } = await import("./route");
    fullExitProofStatus = "policy_close_required";

    const response = await POST(
      new Request("http://localhost/api/withdrawals/confirm", {
        body: JSON.stringify({}),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      position: { status: "active" },
      status: "policy_close_required",
    });
    expect(callOrder).toEqual([
      "record-withdrawal",
      "verify-zero",
      "reconcile",
    ]);
    expect(reconcileCalls[0]).toMatchObject({
      minContextSlot: 300,
      purpose: "post_withdrawal_zero_proof",
    });
  });
});

describe("Earn deposit confirm route", () => {
  beforeEach(() => {
    parsedInput = createDepositInput();
    resolvedPrincipal = principal;
    callOrder = [];
    depositCalls = [];
    reconcileCalls = [];
    withdrawalCalls = [];
    Connection.prototype.getSignatureStatuses = mock(async () => ({
      value: [
        {
          confirmationStatus: "confirmed",
          err: null,
          slot: 300,
        },
      ],
    })) as never;
    Connection.prototype.getParsedTransaction = mock(async () => ({
      blockTime: 1,
      meta: {
        err: null,
        fee: 5000,
        innerInstructions: null,
        logMessages: [],
        postBalances: [1],
        postTokenBalances: [
          {
            accountIndex: 0,
            mint: canonical.liquidityMint,
            owner: principal.walletAddress,
            uiTokenAmount: {
              amount: "0",
              decimals: 6,
              uiAmount: 0,
              uiAmountString: "0",
            },
          },
        ],
        preBalances: [1],
        preTokenBalances: [
          {
            accountIndex: 0,
            mint: canonical.liquidityMint,
            owner: principal.walletAddress,
            uiTokenAmount: {
              amount: "1000000",
              decimals: 6,
              uiAmount: 1,
              uiAmountString: "1",
            },
          },
        ],
        rewards: [],
        status: { Ok: null },
      },
      slot: 300,
      transaction: {
        message: {
          accountKeys: [
            {
              pubkey: new PublicKey("1111111111111111111111111111111B"),
              signer: false,
              source: "transaction",
              writable: true,
            },
          ],
          addressTableLookups: null,
          instructions: [],
          recentBlockhash: "11111111111111111111111111111111",
        },
        signatures: ["deposit-signature"],
      },
    })) as never;
  });

  test("records a confirmed canonical deposit for the authenticated principal", async () => {
    const { POST } = await import("../../deposits/confirm/route");

    const response = await POST(
      new Request("http://localhost/api/deposits/confirm", {
        body: JSON.stringify({}),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(depositCalls).toHaveLength(1);
    expect(depositCalls[0]).toMatchObject({
      cluster: "mainnet-beta",
      confirmedSlot: BigInt(300),
      depositSignature: "deposit-signature",
      liquidityMint: canonical.liquidityMint,
      market: canonical.market,
      policyAccount: canonical.policyAccount,
      policyConfirmedSlot: BigInt(300),
      policyId: BigInt(7),
      policySeed: BigInt(7),
      setupPolicyAccount: canonical.setupPolicyAccount,
      setupPolicyConfirmedSlot: BigInt(300),
      setupPolicyId: BigInt(8),
      setupPolicySeed: BigInt(8),
      setupPolicySignature: "setup-policy-signature",
      settings: principal.settingsPda,
      targetReserve: canonical.reserve,
      vaultIndex: 1,
      vaultPubkey: canonical.vaultPubkey,
      walletAddress: principal.walletAddress,
    });
  });

  test("rejects principal mismatches before recording", async () => {
    const { POST } = await import("../../deposits/confirm/route");
    parsedInput = createDepositInput({
      walletAddress: "1111111111111111111111111111111A",
    });

    const response = await POST(
      new Request("http://localhost/api/deposits/confirm", {
        body: JSON.stringify({}),
        method: "POST",
      })
    );

    expect(response.status).toBe(403);
    expect(depositCalls).toEqual([]);
  });

  test("rejects reserve metadata mismatches before signature checks", async () => {
    const { POST } = await import("../../deposits/confirm/route");
    const getSignatureStatuses = mock(async () => ({ value: [] }));
    Connection.prototype.getSignatureStatuses = getSignatureStatuses as never;
    parsedInput = createDepositInput({
      targetReserve: "1111111111111111111111111111111B",
    });

    const response = await POST(
      new Request("http://localhost/api/deposits/confirm", {
        body: JSON.stringify({}),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(getSignatureStatuses).not.toHaveBeenCalled();
    expect(depositCalls).toEqual([]);
  });

  test("uses the server-resolved slot when the client context slot differs", async () => {
    const { POST } = await import("../../deposits/confirm/route");
    parsedInput = createDepositInput({ confirmedSlot: BigInt(301) });

    const response = await POST(
      new Request("http://localhost/api/deposits/confirm", {
        body: JSON.stringify({}),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(depositCalls[0]).toMatchObject({ confirmedSlot: BigInt(300) });
  });

  test("rejects missing sessions before recording", async () => {
    const { POST } = await import("../../deposits/confirm/route");
    resolvedPrincipal = null;

    const response = await POST(
      new Request("http://localhost/api/deposits/confirm", {
        body: JSON.stringify({}),
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
    expect(depositCalls).toEqual([]);
  });
});
