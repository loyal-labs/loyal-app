import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";

mock.module("server-only", () => ({}));

const canonical = {
  delegatedSigner: "11111111111111111111111111111112",
  liquidityMint: "11111111111111111111111111111113",
  policyAccount: "11111111111111111111111111111114",
  recurringDelegation: "11111111111111111111111111111115",
  settings: "11111111111111111111111111111116",
  subscriptionAuthority: "11111111111111111111111111111117",
  vaultPubkey: "11111111111111111111111111111118",
  vaultUsdcAta: "11111111111111111111111111111119",
  wallet: "1111111111111111111111111111111A",
  walletUsdcAta: "1111111111111111111111111111111B",
};
const principal: AuthenticatedPrincipal = {
  authMethod: "wallet",
  provider: "solana",
  settingsPda: canonical.settings,
  smartAccountAddress: canonical.vaultPubkey,
  subjectAddress: canonical.wallet,
  walletAddress: canonical.wallet,
};
let parsedInput: Record<string, unknown>;
let resolvedPrincipal: AuthenticatedPrincipal | null = principal;
const getSignatureStatuses = mock(async () => ({
  value: [
    {
      confirmationStatus: "confirmed",
      err: null,
      slot: 456,
    },
  ],
}));
type MockAccountInfoResult = {
  context: { slot: number };
  value: {
    data: Buffer;
    lamports: number;
    owner: PublicKey;
  } | null;
};
const getAccountInfoAndContext = mock(
  async (): Promise<MockAccountInfoResult> => ({
    context: { slot: 500 },
    value: {
      data: Buffer.from("wallet-usdc-token-account"),
      lamports: 2_039_280,
      owner: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    },
  })
);
const recordConfirmedAutodepositDelegation = mock(async () => createTarget());
const recordPendingAutodepositSetup = mock(async () =>
  createTarget({ active: false, lifecycleStatus: "pending_delegation" })
);
const scheduleBootstrapEarnAutodepositSweep = mock(async () => ({
  status: "scheduled",
  sweep: {
    classification: "initial_surplus",
    confidence: "confirmed_snapshot",
    eligibleAfter: new Date("2026-06-16T01:00:00.000Z"),
    id: BigInt(41),
    originalAmountRaw: BigInt(500_000_000),
    reason: "initial Autodeposit surplus detected at setup confirmation",
    remainingAmountRaw: BigInt(500_000_000),
    status: "open",
  },
}));

Connection.prototype.getSignatureStatuses = getSignatureStatuses as never;
Connection.prototype.getAccountInfoAndContext = getAccountInfoAndContext as never;

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => resolvedPrincipal,
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
  getDeploymentPolicySignerPublicKey: () => new PublicKey(canonical.delegatedSigner),
}));

mock.module("@loyal-labs/actions", () => ({
  deriveRecurringDelegation: () => new PublicKey(canonical.recurringDelegation),
  deriveSubscriptionAuthority: () =>
    new PublicKey(canonical.subscriptionAuthority),
  getKaminoUsdcEarnTargetForCluster: () => ({
    liquidityMint: new PublicKey(canonical.liquidityMint),
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

mock.module("@solana/spl-token", () => ({
  TOKEN_PROGRAM_ID: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  getAssociatedTokenAddressSync: (
    _mint: PublicKey,
    owner: PublicKey
  ): PublicKey =>
    owner.toBase58() === canonical.wallet
      ? new PublicKey(canonical.walletUsdcAta)
      : new PublicKey(canonical.vaultUsdcAta),
  unpackAccount: () => ({
    amount: BigInt(1_000_000_000),
    mint: new PublicKey(canonical.liquidityMint),
    owner: new PublicKey(canonical.wallet),
  }),
}));

mock.module(
  "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared",
  () => ({
    parseEarnAutodepositSetupConfirmRequestBody: () => parsedInput,
  })
);

mock.module(
  "@/lib/yield-optimization/earn-autodeposit-repository.server",
  () => ({
    recordConfirmedAutodepositDelegation,
    recordPendingAutodepositSetup,
    scheduleBootstrapEarnAutodepositSweep,
  })
);

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    amountPerPeriodRaw: BigInt(1_000_000_000),
    cluster: "mainnet-beta",
    confirmedSlot: BigInt(456),
    delegatedSigner: canonical.delegatedSigner,
    expiryTimestamp: BigInt(4_102_444_800),
    liquidityMint: canonical.liquidityMint,
    nonce: BigInt(9),
    periodLengthSeconds: BigInt(2_592_000),
    policyAccount: canonical.policyAccount,
    policyId: BigInt(1),
    policySeed: BigInt(1),
    recurringDelegation: canonical.recurringDelegation,
    settings: canonical.settings,
    setupSignature: "setup-signature",
    setupStage: "create_recurring_delegation",
    startTimestamp: BigInt(1_780_185_600),
    subscriptionAuthority: canonical.subscriptionAuthority,
    subscriptionAuthorityInitialization: "exists",
    subscriptionDelegatee: canonical.vaultPubkey,
    vaultIndex: 1,
    vaultPubkey: canonical.vaultPubkey,
    vaultUsdcAta: canonical.vaultUsdcAta,
    walletAddress: canonical.wallet,
    walletBalanceFloorRaw: BigInt(500_000_000),
    walletUsdcAta: canonical.walletUsdcAta,
    ...overrides,
  };
}

function createTarget(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    balanceSweepPolicyId: BigInt(7),
    id: BigInt(11),
    lifecycleStatus: "active",
    policyAccount: canonical.policyAccount,
    recurringDelegation: canonical.recurringDelegation,
    walletBalanceFloorRaw: BigInt(500_000_000),
    ...overrides,
  };
}

function createRequest() {
  return new Request("https://loyal.local/autodeposit/setup/confirm", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

const { POST } = await import("./route");

describe("Earn autodeposit setup confirm route", () => {
  beforeEach(() => {
    parsedInput = createInput();
    resolvedPrincipal = principal;
    getSignatureStatuses.mockClear();
    getAccountInfoAndContext.mockClear();
    recordConfirmedAutodepositDelegation.mockClear();
    recordPendingAutodepositSetup.mockClear();
    scheduleBootstrapEarnAutodepositSweep.mockClear();
    getSignatureStatuses.mockImplementation(async () => ({
      value: [
        {
          confirmationStatus: "confirmed",
          err: null,
          slot: 456,
        },
      ],
    }));
    getAccountInfoAndContext.mockImplementation(async () => ({
      context: { slot: 500 },
      value: {
        data: Buffer.from("wallet-usdc-token-account"),
        lamports: 2_039_280,
        owner: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      },
    }));
    recordConfirmedAutodepositDelegation.mockImplementation(async () =>
      createTarget()
    );
    recordPendingAutodepositSetup.mockImplementation(async () =>
      createTarget({ active: false, lifecycleStatus: "pending_delegation" })
    );
    scheduleBootstrapEarnAutodepositSweep.mockImplementation(async () => ({
      status: "scheduled",
      sweep: {
        classification: "initial_surplus",
        confidence: "confirmed_snapshot",
        eligibleAfter: new Date("2026-06-16T01:00:00.000Z"),
        id: BigInt(41),
        originalAmountRaw: BigInt(500_000_000),
        reason: "initial Autodeposit surplus detected at setup confirmation",
        remainingAmountRaw: BigInt(500_000_000),
        status: "open",
      },
    }));
  });

  test("returns the bootstrap scheduled sweep after final setup confirmation", async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(recordConfirmedAutodepositDelegation).toHaveBeenCalled();
    expect(scheduleBootstrapEarnAutodepositSweep).toHaveBeenCalledWith({
      snapshot: expect.objectContaining({
        amountRaw: BigInt(1_000_000_000),
        mint: canonical.liquidityMint,
        observedSlot: BigInt(500),
        owner: canonical.wallet,
        source: "app_autodeposit_setup_confirm",
        sourceCommitment: "confirmed",
      }),
      target: createTarget(),
    });
    await expect(response.json()).resolves.toMatchObject({
      bootstrapSweep: {
        status: "scheduled",
        sweep: {
          classification: "initial_surplus",
          eligibleAfter: "2026-06-16T01:00:00.000Z",
          id: "41",
          originalAmountRaw: "500000000",
          remainingAmountRaw: "500000000",
          status: "open",
        },
      },
      target: {
        active: true,
        id: "11",
        lifecycleStatus: "active",
      },
    });
  });

  test.each([
    "initialize_subscription_authority",
    "create_policy",
  ] as const)("does not bootstrap pending %s setup stage", async (setupStage) => {
    parsedInput = createInput({
      setupStage,
    });

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(recordPendingAutodepositSetup).toHaveBeenCalled();
    expect(recordConfirmedAutodepositDelegation).not.toHaveBeenCalled();
    expect(getAccountInfoAndContext).not.toHaveBeenCalled();
    expect(scheduleBootstrapEarnAutodepositSweep).not.toHaveBeenCalled();
    expect(payload.bootstrapSweep).toBeUndefined();
  });

  test("skips bootstrap scheduling when the wallet USDC ATA is missing", async () => {
    getAccountInfoAndContext.mockImplementation(async () => ({
      context: { slot: 500 },
      value: null,
    }));

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(scheduleBootstrapEarnAutodepositSweep).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      bootstrapSweep: {
        reason: "wallet_usdc_ata_missing",
        status: "skipped",
      },
    });
  });

  test("keeps setup persistence successful when bootstrap scheduling fails", async () => {
    scheduleBootstrapEarnAutodepositSweep.mockImplementation(async () => {
      throw new Error("insert failed");
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(recordConfirmedAutodepositDelegation).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      bootstrapSweep: {
        reason: "insert failed",
        status: "failed",
      },
      target: {
        id: "11",
      },
    });
  });
});
