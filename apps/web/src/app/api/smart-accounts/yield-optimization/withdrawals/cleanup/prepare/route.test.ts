import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
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

let proofStatus: "full_exit_incomplete" | "policy_close_required";
let proofError: Error | null;
let proofCalls: Array<Record<string, unknown>>;
let prepareCalls: Array<Record<string, unknown>>;
let autodepositReadCount: number;
let latestFullWithdrawal: { confirmedSlot: bigint } | null;
let latestFullWithdrawalLookupCount = 0;
let latestFullWithdrawalMissesRemaining = 0;

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
        cleanupTokenAccounts: [
          {
            address: closeableTokenAccount,
            amountRaw: "9999",
            decimals: 6,
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
          },
        ],
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
    parseEarnWithdrawCleanupConfirmRequestBody: () => {
      throw new Error("not used by cleanup prepare tests");
    },
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
  findLatestFullYieldWithdrawalForVault: async () => {
    latestFullWithdrawalLookupCount += 1;
    if (latestFullWithdrawalMissesRemaining > 0) {
      latestFullWithdrawalMissesRemaining -= 1;
      return null;
    }
    return latestFullWithdrawal;
  },
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
    latestFullWithdrawal = { confirmedSlot: BigInt(350) };
    proofStatus = "full_exit_incomplete";
    proofError = null;
    proofCalls = [];
    prepareCalls = [];
    autodepositReadCount = 0;
    latestFullWithdrawalLookupCount = 0;
    latestFullWithdrawalMissesRemaining = 0;
    Connection.prototype.getAccountInfo = mock(async () => null) as never;
    Connection.prototype.getMultipleAccountsInfo = mock(
      async () => []
    ) as never;
  });

  function createRequest(minContextSlot?: string): Request {
    return new Request(
      "http://localhost/api/withdrawals/cleanup/prepare",
      {
        body: JSON.stringify(
          minContextSlot === undefined ? {} : { minContextSlot }
        ),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );
  }

  test("anchors a current web cleanup read to the confirmed withdrawal slot", async () => {
    const { POST } = await import("./route");

    const response = await POST(createRequest("400"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "full_exit_incomplete" },
    });
    expect(proofCalls).toHaveLength(1);
    expect(proofCalls[0]?.minContextSlot).toBe(400);
    expect(prepareCalls).toHaveLength(0);
  });

  test("keeps every close operation unprepared while a reserve remains positive", async () => {
    const { POST } = await import("./route");

    const response = await POST(createRequest("400"));

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

    const response = await POST(createRequest("400"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "full_exit_verification_retryable" },
    });
    expect(prepareCalls).toHaveLength(0);
  });

  test("prepares the separate close phase only after zero proof", async () => {
    const { POST } = await import("./route");
    proofStatus = "policy_close_required";

    const response = await POST(createRequest("400"));

    expect(response.status).toBe(200);
    expect(proofCalls[0]?.minContextSlot).toBe(400);
    expect(prepareCalls).toHaveLength(1);
    expect(prepareCalls[0]?.vaultTokenAccounts).toEqual([
      expect.objectContaining({
        address: new PublicKey(closeableTokenAccount),
        amountRaw: BigInt(9999),
        tokenProgramId: TOKEN_PROGRAM_ID,
      }),
    ]);
  });

  test("keeps cached web clients compatible through the projected withdrawal slot", async () => {
    const { POST } = await import("./route");
    proofStatus = "policy_close_required";

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(proofCalls[0]?.minContextSlot).toBe(350);
    expect(prepareCalls).toHaveLength(1);
  });

  test("waits briefly for a cached client's withdrawal projection", async () => {
    const { POST } = await import("./route");
    proofStatus = "policy_close_required";
    latestFullWithdrawalMissesRemaining = 1;

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(latestFullWithdrawalLookupCount).toBe(2);
    expect(proofCalls[0]?.minContextSlot).toBe(350);
  });

  test("asks a cached web client to retry while its full withdrawal is projecting", async () => {
    const { POST } = await import("./route");
    latestFullWithdrawal = null;

    const response = await POST(createRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(await response.json()).toMatchObject({
      error: { code: "full_withdrawal_projection_pending" },
    });
    expect(proofCalls).toHaveLength(0);
    expect(prepareCalls).toHaveLength(0);
    expect(latestFullWithdrawalLookupCount).toBe(5);
  });

  test("rejects an invalid client withdrawal slot before reading chain state", async () => {
    const { POST } = await import("./route");

    const response = await POST(createRequest("not-a-slot"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_request" },
    });
    expect(proofCalls).toHaveLength(0);
  });
});
