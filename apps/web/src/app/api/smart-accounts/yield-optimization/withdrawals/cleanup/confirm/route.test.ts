import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Connection, Keypair } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const principal = {
  settingsPda: "11111111111111111111111111111112",
  walletAddress: Keypair.fromSeed(
    new Uint8Array(32).fill(3)
  ).publicKey.toBase58(),
};
const policyAccount = "11111111111111111111111111111114";
const supplementalPolicyAccount = "11111111111111111111111111111116";
const refundedRecurringDelegation = "11111111111111111111111111111117";
const persistence = {
  additionalClosedPolicyAccounts: [supplementalPolicyAccount],
  refundedRecurringDelegations: [refundedRecurringDelegation],
  autodepositClose: null,
  cluster: "mainnet-beta",
  policyAccount,
  policySeed: "7",
  settings: principal.settingsPda,
  setupPolicyAccount: null,
  setupPolicySeed: null,
  vaultIndex: 1,
  vaultPubkey: "11111111111111111111111111111115",
  walletAddress: principal.walletAddress,
};

let proofStatus: "full_exit_incomplete" | "policy_close_required";
let proofError: Error | null;
let policyAccountStillOpen: boolean;
let callOrder: string[];
let cleanupRecordCount: number;
let preparedWalletAddress: string;
let verifiedPolicyAccounts: string[];

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
    rpcEndpoint: "http://127.0.0.1:8899",
    websocketEndpoint: "ws://127.0.0.1:8900",
  }),
}));

mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: (fetchImpl: typeof fetch) => fetchImpl,
}));

mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    recordAutodepositCloseIntent: async () => {
      throw new Error("Autodeposit closure was not expected.");
    },
    recordClosedAutodepositTarget: async () => {
      throw new Error("Autodeposit closure was not expected.");
    },
  })
);

mock.module(
  "@/lib/yield-optimization/earn-full-exit-zero-proof.server",
  () => ({
    verifyEarnFullExitZeroBalances: async () => {
      callOrder.push("verify-zero");
      if (proofError) {
        throw proofError;
      }
      return {
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
    parseEarnWithdrawCleanupConfirmRequestBody: () => ({
      cleanupSignature: "cleanup-signature",
      confirmedSlot: "600",
      preparedCleanup: {
        persistence: { ...persistence, walletAddress: preparedWalletAddress },
      },
    }),
  })
);

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findEarnCleanupVaultState: async () => ({
    routePolicy: {
      policyAccount,
      policySeed: BigInt(7),
    },
    setupPolicy: null,
  }),
  recordConfirmedEarnCleanup: async () => {
    callOrder.push("record-cleanup");
    cleanupRecordCount += 1;
  },
}));

function createRequest() {
  return new Request("http://localhost/api/withdrawals/cleanup/confirm", {
    body: JSON.stringify({}),
    method: "POST",
  });
}

describe("Earn cleanup confirm route", () => {
  beforeEach(() => {
    proofStatus = "policy_close_required";
    proofError = null;
    policyAccountStillOpen = false;
    callOrder = [];
    cleanupRecordCount = 0;
    preparedWalletAddress = principal.walletAddress;
    verifiedPolicyAccounts = [];
    Connection.prototype.getSignatureStatuses = mock(async () => ({
      value: [
        {
          confirmationStatus: "confirmed",
          err: null,
          slot: 600,
        },
      ],
    })) as never;
    Connection.prototype.getMultipleAccountsInfoAndContext = mock(
      async (accounts: { toBase58: () => string }[]) => {
        callOrder.push("verify-policy-accounts");
        verifiedPolicyAccounts = accounts.map((account) => account.toBase58());
        return {
          context: { slot: 600 },
          value: accounts.map((_, index) =>
            index === 0 && policyAccountStillOpen ? { lamports: 1 } : null
          ),
        };
      }
    ) as never;
  });

  test("rejects cleanup prepared for another wallet before chain reads", async () => {
    const { POST } = await import("./route");
    preparedWalletAddress = Keypair.fromSeed(
      new Uint8Array(32).fill(4)
    ).publicKey.toBase58();

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    expect(cleanupRecordCount).toBe(0);
    expect(callOrder).toEqual([]);
  });

  test("does not close database state when post-cleanup balance proof fails", async () => {
    const { POST } = await import("./route");
    proofError = new Error("minimum context slot has not been reached");

    const response = await POST(createRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "full_exit_verification_retryable" },
    });
    expect(cleanupRecordCount).toBe(0);
    expect(callOrder).toEqual(["verify-zero"]);
  });

  test("does not close database state while any balance remains", async () => {
    const { POST } = await import("./route");
    proofStatus = "full_exit_incomplete";

    const response = await POST(createRequest());

    expect(response.status).toBe(409);
    expect(cleanupRecordCount).toBe(0);
    expect(callOrder).toEqual(["verify-zero"]);
  });

  test("does not close database state until policy accounts are closed on-chain", async () => {
    const { POST } = await import("./route");
    policyAccountStillOpen = true;

    const response = await POST(createRequest());

    expect(response.status).toBe(503);
    expect(cleanupRecordCount).toBe(0);
    expect(callOrder).toEqual(["verify-zero", "verify-policy-accounts"]);
  });

  test("acknowledges verified cleanup without writing projected state", async () => {
    const { POST } = await import("./route");

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "full_exit_closed",
    });
    expect(cleanupRecordCount).toBe(0);
    expect(callOrder).toEqual(["verify-zero", "verify-policy-accounts"]);
    expect(verifiedPolicyAccounts).toEqual([
      policyAccount,
      supplementalPolicyAccount,
      refundedRecurringDelegation,
    ]);
  });
});
