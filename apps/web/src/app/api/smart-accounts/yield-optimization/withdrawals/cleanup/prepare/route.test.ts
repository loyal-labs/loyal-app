import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const principal = {
  settingsPda: "11111111111111111111111111111112",
  smartAccountAddress: "11111111111111111111111111111113",
  walletAddress: Keypair.fromSeed(
    new Uint8Array(32).fill(2)
  ).publicKey.toBase58(),
};
const policyAccount = "11111111111111111111111111111114";
const closeableTokenAccount = "11111111111111111111111111111115";

let latestFullWithdrawal: { confirmedSlot: bigint } | null;
let proofStatus: "full_exit_incomplete" | "policy_close_required";
let proofError: Error | null;
let proofCalls: Array<Record<string, unknown>>;
let prepareCalls: Array<Record<string, unknown>>;
let autodepositReadCount: number;

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => principal,
}));

mock.module("@/features/smart-accounts/server/service", () => ({
  assertAuthenticatedWalletControlsSettings: async () => {},
  isSmartAccountProvisioningError: () => false,
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
    rpcEndpoint: "http://127.0.0.1:8899",
    websocketEndpoint: "ws://127.0.0.1:8900",
  }),
}));

mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: (fetchImpl: typeof fetch) => fetchImpl,
}));

mock.module("@/lib/yield-optimization/deployment-policy-signer.server", () => ({
  getDeploymentPolicySignerPublicKey: () => PublicKey.default,
}));

mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    findCurrentEarnAutodepositState: async () => {
      autodepositReadCount += 1;
      return null;
    },
    reconcileMissingOnChainEarnAutodepositPolicy: async () => {},
  })
);

mock.module(
  "@/lib/yield-optimization/earn-full-exit-zero-proof.server",
  () => ({
    verifyEarnFullExitZeroBalances: async (input: Record<string, unknown>) => {
      proofCalls.push(input);
      if (proofError) {
        throw proofError;
      }
      return {
        blockingTokenAccounts: [],
        closeableTokenAccounts: [closeableTokenAccount],
        idleAmountRaw: "9999",
        idleReadsAgree: true,
        observedSlot: "500",
        remainingHoldings:
          proofStatus === "full_exit_incomplete"
            ? [{ amountRaw: "1", kind: "kamino" }]
            : [],
        status: proofStatus,
      };
    },
  })
);

mock.module("@/lib/yield-optimization/earn-state-serializers.server", () => ({
  serializeRoutePolicyState: () => ({ vaultIndex: 1 }),
}));

mock.module(
  "@/lib/yield-optimization/earn-withdraw-cleanup-contracts.shared",
  () => ({
    serializePreparedEarnUsdcCleanup: () => ({ prepared: true }),
  })
);

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findEarnCleanupVaultState: async () => ({
    routePolicy: {
      policyAccount,
      policySeed: BigInt(7),
    },
    setupPolicy: null,
    vault: { id: BigInt(1) },
  }),
  findLatestFullYieldWithdrawalForVault: async () => latestFullWithdrawal,
}));

mock.module("@loyal-labs/smart-account-vaults", () => ({
  createSmartAccountVaultsClient: () => ({
    prepareEarnUsdcCleanup: async (input: Record<string, unknown>) => {
      prepareCalls.push(input);
      return {};
    },
  }),
}));

describe("Earn cleanup prepare route", () => {
  beforeEach(() => {
    latestFullWithdrawal = { confirmedSlot: BigInt(500) };
    proofStatus = "full_exit_incomplete";
    proofError = null;
    proofCalls = [];
    prepareCalls = [];
    autodepositReadCount = 0;
    Connection.prototype.getAccountInfo = mock(async () => null) as never;
    Connection.prototype.getMultipleAccountsInfo = mock(
      async () => []
    ) as never;
  });

  test("requires a confirmed full withdrawal before any close preparation", async () => {
    const { POST } = await import("./route");
    latestFullWithdrawal = null;

    const response = await POST(
      new Request("http://localhost/api/withdrawals/cleanup/prepare", {
        method: "POST",
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "missing_full_withdrawal" },
    });
    expect(proofCalls).toHaveLength(0);
    expect(prepareCalls).toHaveLength(0);
  });

  test("keeps every close operation unprepared while a reserve remains positive", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/withdrawals/cleanup/prepare", {
        method: "POST",
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "full_exit_incomplete" },
    });
    expect(prepareCalls).toHaveLength(0);
    expect(autodepositReadCount).toBe(0);
  });

  test("returns a retryable state without preparing closure when RPC fails", async () => {
    const { POST } = await import("./route");
    proofError = new Error("minimum context slot has not been reached");

    const response = await POST(
      new Request("http://localhost/api/withdrawals/cleanup/prepare", {
        method: "POST",
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "full_exit_verification_retryable" },
    });
    expect(prepareCalls).toHaveLength(0);
  });

  test("prepares the separate close phase only after zero proof", async () => {
    const { POST } = await import("./route");
    proofStatus = "policy_close_required";

    const response = await POST(
      new Request("http://localhost/api/withdrawals/cleanup/prepare", {
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(proofCalls[0]?.minContextSlot).toBe(500);
    expect(prepareCalls).toHaveLength(1);
    expect(prepareCalls[0]?.idleAmountRaw).toBe(BigInt(9999));
    expect(
      (prepareCalls[0]?.closeVaultCollateralAtas as PublicKey[])[0]?.toBase58()
    ).toBe(closeableTokenAccount);
  });
});
