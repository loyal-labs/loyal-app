import { beforeEach, describe, expect, mock, test } from "bun:test";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { Connection, PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const principal = {
  settingsPda: "11111111111111111111111111111112",
  smartAccountAddress: "11111111111111111111111111111113",
  walletAddress: "11111111111111111111111111111114",
};
const activePolicy = {
  policyAccount: "11111111111111111111111111111117",
  policySeed: BigInt(7),
};
const activeSetupPolicy = {
  policyAccount: "11111111111111111111111111111118",
  policySeed: BigInt(8),
};
const activePosition = {
  currentLiquidityMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  currentMarket: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
  currentReserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
  principalAmountRaw: BigInt(1_000_026),
};
const completeAutodepositState = {
  policy: {
    policyAccount: "11111111111111111111111111111118",
  },
  target: {
    id: BigInt(11),
    recurringDelegation: "11111111111111111111111111111119",
  },
};
const [expectedEarnVaultPda] = pda.getSmartAccountPda({
  accountIndex: 1,
  programId: new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG"),
  settingsPda: new PublicKey(principal.settingsPda),
});

let currentPrincipal: typeof principal | null = principal;
let currentAutodepositState: typeof completeAutodepositState | null = null;
let currentPosition: typeof activePosition | null = activePosition;
let findAutodepositCalls: unknown[] = [];
let getAccountInfoCalls: string[] = [];
let findPolicyCalls: unknown[] = [];
let findPositionCalls: unknown[] = [];
let findReserveRowsCalls: unknown[] = [];
let findIdleRowsCalls: unknown[] = [];
let prepareCalls: Record<string, unknown>[] = [];
let reconcileMissingAutodepositCalls: unknown[] = [];
let currentAutodepositPolicyAccountExists = true;
let currentReserveRows: Array<{
  hasValue?: boolean;
  amountRaw: bigint;
  liquidityMint: string;
  market: string | null;
  reserve: string;
  supplyApyBps: bigint | null;
}> = [];
let currentIdleRows: Array<{
  amountRaw: bigint;
  mint: string;
  tokenAccount: string;
}> = [];

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => currentPrincipal,
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

mock.module("@/lib/solana/rpc-endpoints", () => ({
  getFrontendSolanaEndpoints: () => ({
    rpcEndpoint: "http://127.0.0.1:8899",
    websocketEndpoint: "ws://127.0.0.1:8900",
  }),
}));

mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: (fetchImpl: typeof fetch) => fetchImpl,
}));

mock.module("@/lib/yield-optimization/deployment-policy-signer.server", () => ({
  getDeploymentPolicySignerPublicKey: () =>
    new PublicKey("11111111111111111111111111111115"),
}));

mock.module(
  "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared",
  () => ({
    parseEarnWithdrawPrepareRequestBody: (body: {
      amountRaw: string;
      mode: "partial" | "full";
      source?: unknown;
    }) => ({
      amountRaw: BigInt(body.amountRaw),
      mode: body.mode,
      source: body.source ?? null,
    }),
    serializePreparedEarnUsdcWithdraw: () => ({ ok: true }),
  })
);

mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    findCurrentEarnAutodepositState: async (input: unknown) => {
      findAutodepositCalls.push(input);
      return currentAutodepositState;
    },
    reconcileMissingOnChainEarnAutodepositPolicy: async (input: unknown) => {
      reconcileMissingAutodepositCalls.push(input);
      return {
        id: BigInt(11),
        lifecycleStatus: "closed",
      };
    },
    recordClosedAutodepositTarget: async () => {
      throw new Error("recordClosedAutodepositTarget was not expected.");
    },
  })
);

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findActiveYieldRoutePolicyPair: async (input: unknown) => {
    findPolicyCalls.push(input);
    return {
      routePolicy: activePolicy,
      setupPolicy: activeSetupPolicy,
    };
  },
  findReconciledActiveYieldPositionForVault: async (input: unknown) => {
    findPositionCalls.push(input);
    return currentPosition;
  },
  findCurrentNonzeroYieldVaultReservePositions: async (input: unknown) => {
    findReserveRowsCalls.push(input);
    return currentReserveRows.map((row) => ({
      ...row,
      hasValue: row.hasValue ?? true,
    }));
  },
  findCurrentYieldVaultIdleTokenBalances: async (input: unknown) => {
    findIdleRowsCalls.push(input);
    return currentIdleRows;
  },
  recordConfirmedYieldDeposit: async () => {
    throw new Error("recordConfirmedYieldDeposit was not expected.");
  },
  recordConfirmedYieldWithdrawal: async () => {
    throw new Error("recordConfirmedYieldWithdrawal was not expected.");
  },
}));

mock.module("@loyal-labs/smart-account-vaults", () => ({
  createSmartAccountVaultsClient: () => ({
    prepareEarnUsdcWithdraw: async (input: Record<string, unknown>) => {
      prepareCalls.push(input);
      return { prepared: true, input };
    },
  }),
}));

function createRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/withdrawals/prepare", {
    body: JSON.stringify(body),
    method: "POST",
  });
}

describe("Earn withdrawal prepare route", () => {
  beforeEach(() => {
    (
      Connection.prototype as unknown as {
        getAccountInfo: (key: PublicKey) => Promise<unknown | null>;
      }
    ).getAccountInfo = async (key: PublicKey) => {
      getAccountInfoCalls.push(key.toBase58());
      return currentAutodepositPolicyAccountExists ? { lamports: 1 } : null;
    };
    currentPrincipal = principal;
    currentAutodepositState = null;
    currentAutodepositPolicyAccountExists = true;
    currentPosition = activePosition;
    findAutodepositCalls = [];
    getAccountInfoCalls = [];
    findPolicyCalls = [];
    findPositionCalls = [];
    findReserveRowsCalls = [];
    findIdleRowsCalls = [];
    currentReserveRows = [
      {
        amountRaw: activePosition.principalAmountRaw,
        liquidityMint: activePosition.currentLiquidityMint,
        market: activePosition.currentMarket,
        reserve: activePosition.currentReserve,
        supplyApyBps: BigInt(300),
      },
    ];
    currentIdleRows = [];
    prepareCalls = [];
    reconcileMissingAutodepositCalls = [];
  });

  test("does not fetch autodeposit state for partial withdrawals", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      createRequest({ amountRaw: "1000000", mode: "partial" })
    );

    expect(response.status).toBe(200);
    expect(findPolicyCalls).toEqual([
      {
        authority: principal.walletAddress,
        cluster: "mainnet-beta",
        settings: principal.settingsPda,
        vaultIndex: 1,
        vaultPubkey: expectedEarnVaultPda.toBase58(),
      },
    ]);
    expect(findAutodepositCalls).toHaveLength(0);
    expect(findPositionCalls).toEqual([
      {
        cluster: "mainnet-beta",
        settings: principal.settingsPda,
        vaultIndex: 1,
        walletAddress: principal.walletAddress,
      },
    ]);
    expect(findReserveRowsCalls).toHaveLength(1);
    expect(prepareCalls[0]?.amountRaw).toBe(BigInt(1_000_000));
    expect(prepareCalls[0]?.mode).toBe("partial");
    expect(prepareCalls[0]?.autodepositClose).toBeUndefined();
    expect(
      (
        prepareCalls[0]?.yieldRoutingPolicy as {
          setupPolicy?: { account: PublicKey; seed: bigint };
        }
      ).setupPolicy?.account.toBase58()
    ).toBe(activeSetupPolicy.policyAccount);
    expect(
      (
        prepareCalls[0]?.yieldRoutingPolicy as {
          setupPolicy?: { account: PublicKey; seed: bigint };
        }
      ).setupPolicy?.seed
    ).toBe(activeSetupPolicy.policySeed);
  });

  test("passes complete active autodeposit close metadata for full withdrawals", async () => {
    const { POST } = await import("./route");
    currentAutodepositState = completeAutodepositState;

    const response = await POST(
      createRequest({ amountRaw: "1000000", mode: "full" })
    );

    expect(response.status).toBe(200);
    expect(findPositionCalls).toEqual([
      {
        cluster: "mainnet-beta",
        settings: principal.settingsPda,
        vaultIndex: 1,
        walletAddress: principal.walletAddress,
      },
    ]);
    expect(findReserveRowsCalls).toHaveLength(1);
    expect(prepareCalls[0]?.amountRaw).toBe(activePosition.principalAmountRaw);
    expect(findAutodepositCalls).toEqual([
      {
        settings: principal.settingsPda,
        vaultIndex: 1,
        walletAddress: principal.walletAddress,
      },
    ]);
    expect(getAccountInfoCalls).toEqual([
      completeAutodepositState.policy.policyAccount,
    ]);
    expect(reconcileMissingAutodepositCalls).toHaveLength(0);
    expect(
      (
        prepareCalls[0]?.autodepositClose as {
          policy: PublicKey;
          recurringDelegation: PublicKey;
        }
      ).policy.toBase58()
    ).toBe(completeAutodepositState.policy.policyAccount);
    expect(
      (
        prepareCalls[0]?.autodepositClose as {
          policy: PublicKey;
          recurringDelegation: PublicKey;
        }
      ).recurringDelegation.toBase58()
    ).toBe(completeAutodepositState.target.recurringDelegation);
  });

  test("reconciles and skips autodeposit close when the policy account is already missing", async () => {
    const { POST } = await import("./route");
    currentAutodepositState = completeAutodepositState;
    currentAutodepositPolicyAccountExists = false;

    const response = await POST(
      createRequest({ amountRaw: "1000000", mode: "full" })
    );

    expect(response.status).toBe(200);
    expect(getAccountInfoCalls).toEqual([
      completeAutodepositState.policy.policyAccount,
    ]);
    expect(reconcileMissingAutodepositCalls).toEqual([
      {
        policyAccount: completeAutodepositState.policy.policyAccount,
        settings: principal.settingsPda,
        vaultIndex: 1,
        walletAddress: principal.walletAddress,
      },
    ]);
    expect(prepareCalls[0]?.autodepositClose).toBeUndefined();
  });

  test("omits autodeposit close metadata when full withdrawal state is incomplete", async () => {
    const { POST } = await import("./route");
    currentAutodepositState = {
      ...completeAutodepositState,
      target: {
        ...completeAutodepositState.target,
        recurringDelegation: null,
      },
    } as never;

    const response = await POST(
      createRequest({
        amountRaw: "1000000",
        mode: "full",
        source: {
          id: activePosition.currentReserve,
          reserve: activePosition.currentReserve,
          type: "reserve",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(findAutodepositCalls).toHaveLength(1);
    expect(findPositionCalls).toHaveLength(1);
    expect(prepareCalls[0]?.autodepositClose).toBeUndefined();
  });

  test("passes reconciled nonzero reserve rows as full withdrawal targets", async () => {
    const { POST } = await import("./route");
    currentReserveRows = [
      {
        amountRaw: BigInt(600_000),
        liquidityMint: activePosition.currentLiquidityMint,
        market: activePosition.currentMarket,
        reserve: activePosition.currentReserve,
        supplyApyBps: BigInt(300),
      },
      {
        amountRaw: BigInt(400_000),
        liquidityMint: activePosition.currentLiquidityMint,
        market: activePosition.currentMarket,
        reserve: "6UeJYTLU1adaoHWeApWsoj1xNEDbWA2RhMbrZgYFutJk",
        supplyApyBps: BigInt(200),
      },
    ];

    const response = await POST(
      createRequest({
        amountRaw: "1000000",
        mode: "full",
        source: {
          id: activePosition.currentReserve,
          reserve: activePosition.currentReserve,
          type: "reserve",
        },
      })
    );

    expect(response.status).toBe(200);
    const targets = prepareCalls[0]?.fullWithdrawalTargets as Array<{
      amountRaw: bigint;
      reserve: PublicKey;
    }>;
    expect(targets).toHaveLength(1);
    expect(targets.map((target) => target.amountRaw)).toEqual([
      BigInt(600_000),
    ]);
    expect(targets[0]?.reserve.toBase58()).toBe(activePosition.currentReserve);
  });

  test("passes selected idle vault USDC as its own withdrawal source", async () => {
    const { POST } = await import("./route");
    currentIdleRows = [
      {
        amountRaw: BigInt(250_000),
        mint: activePosition.currentLiquidityMint,
        tokenAccount: "11111111111111111111111111111116",
      },
    ];

    const response = await POST(
      createRequest({
        amountRaw: "1",
        mode: "full",
        source: {
          id: "11111111111111111111111111111116",
          tokenAccount: "11111111111111111111111111111116",
          type: "idle",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(prepareCalls[0]?.amountRaw).toBe(BigInt(250_000));
    expect(prepareCalls[0]?.closePoliciesOnFullWithdrawal).toBe(false);
    expect(prepareCalls[0]?.fullWithdrawalTargets).toBeUndefined();
    expect(prepareCalls[0]?.source).toMatchObject({
      amountRaw: BigInt(250_000),
      id: "11111111111111111111111111111116",
      type: "idle",
    });
    expect(findAutodepositCalls).toHaveLength(0);
  });

  test("rejects full withdrawals when no active position exists", async () => {
    const { POST } = await import("./route");
    currentPosition = null;

    const response = await POST(
      createRequest({ amountRaw: "1000000", mode: "full" })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("missing_earn_position");
    expect(prepareCalls).toHaveLength(0);
  });
});
