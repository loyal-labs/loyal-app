import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  KAMINO_MAIN_MARKET,
  KAMINO_MAIN_USDC_RESERVE,
  LoyalCluster,
  RiskBasket,
  STABLECOIN_MINTS,
  Stablecoin,
  createVaultYieldRoutingPolicyPlan,
} from "@loyal/actions";
import { Connection, PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const settings = new PublicKey("11111111111111111111111111111112");
const walletAddress = new PublicKey("11111111111111111111111111111113");
const smartAccountAddress = new PublicKey("11111111111111111111111111111114");
const policyPlan = createVaultYieldRoutingPolicyPlan({
  cluster: LoyalCluster.Devnet,
  risk: RiskBasket.Safe,
  smartAccount: {
    settings,
    authority: walletAddress,
    delegatedSigner: walletAddress,
  },
  vaultIndex: 1,
});
const getSignatureStatuses = mock(async () => ({
  value: [
    {
      confirmationStatus: "confirmed" as const,
      err: null,
      slot: 123,
    },
  ],
}));

(
  Connection.prototype as unknown as {
    getSignatureStatuses: typeof getSignatureStatuses;
  }
).getSignatureStatuses = getSignatureStatuses;

const resolveAuthenticatedPrincipalFromRequest = mock(async () => ({
  authMethod: "wallet" as const,
  provider: "solana" as const,
  settingsPda: settings.toBase58(),
  smartAccountAddress: smartAccountAddress.toBase58(),
  subjectAddress: walletAddress.toBase58(),
  walletAddress: walletAddress.toBase58(),
}));

const recordConfirmedYieldWithdrawal = mock(async () => ({
  cluster: "devnet",
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  depositMint: "USDC-mint",
  firstDepositSignature: "deposit-sig-1",
  id: BigInt(1),
  lastConfirmedSlot: BigInt(123),
  lastDepositSignature: "deposit-sig-1",
  liquidityMint: STABLECOIN_MINTS[Stablecoin.USDC].toBase58(),
  market: KAMINO_MAIN_MARKET.toBase58(),
  policyAccount: policyPlan.actionAccount.toBase58(),
  policyId: BigInt(1),
  policySeed: BigInt(1),
  principalAmountRaw: BigInt(750_000),
  settings: settings.toBase58(),
  smartAccountAddress: smartAccountAddress.toBase58(),
  status: "active" as const,
  targetReserve: KAMINO_MAIN_USDC_RESERVE.toBase58(),
  targetSupplyApyBps: BigInt(523),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  vaultIndex: 1,
  vaultPubkey: policyPlan.metadata.vault.toBase58(),
  walletAddress: walletAddress.toBase58(),
}));

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  recordConfirmedYieldWithdrawal,
}));

mock.module("@/lib/solana/rpc-endpoints", () => ({
  getFrontendSolanaEndpoints: () => ({
    rpcEndpoint: "https://rpc.example",
    websocketEndpoint: "wss://rpc.example",
  }),
}));

mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: (fetch: typeof globalThis.fetch) => fetch,
}));

let POST: typeof import("../route").POST;
const previousSolanaEnv = process.env.NEXT_PUBLIC_SOLANA_ENV;

function body(overrides = {}) {
  const usdcMint = STABLECOIN_MINTS[Stablecoin.USDC].toBase58();
  return {
    cluster: "devnet",
    confirmedSlot: "123",
    liquidityMint: usdcMint,
    market: KAMINO_MAIN_MARKET.toBase58(),
    mode: "partial",
    policyAccount: policyPlan.actionAccount.toBase58(),
    policyId: "1",
    policySeed: "1",
    settings: settings.toBase58(),
    smartAccountAddress: smartAccountAddress.toBase58(),
    targetReserve: KAMINO_MAIN_USDC_RESERVE.toBase58(),
    vaultIndex: 1,
    vaultPubkey: policyPlan.metadata.vault.toBase58(),
    walletAddress: walletAddress.toBase58(),
    withdrawalSignature: "withdrawal-sig-1",
    withdrawnAmountRaw: "250000",
    ...overrides,
  };
}

function request(payload = body()) {
  return new Request(
    "https://app.askloyal.com/api/smart-accounts/yield-optimization/withdrawals/confirm",
    {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
}

describe("yield optimization withdrawal confirm route", () => {
  beforeAll(async () => {
    ({ POST } = await import("../route"));
  });

  afterAll(() => {
    if (previousSolanaEnv === undefined) {
      delete process.env.NEXT_PUBLIC_SOLANA_ENV;
    } else {
      process.env.NEXT_PUBLIC_SOLANA_ENV = previousSolanaEnv;
    }
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "devnet";
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    recordConfirmedYieldWithdrawal.mockClear();
    getSignatureStatuses.mockClear();
    getSignatureStatuses.mockImplementation(async () => ({
      value: [
        {
          confirmationStatus: "confirmed" as const,
          err: null,
          slot: 123,
        },
      ],
    }));
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(async () => ({
      authMethod: "wallet" as const,
      provider: "solana" as const,
      settingsPda: settings.toBase58(),
      smartAccountAddress: smartAccountAddress.toBase58(),
      subjectAddress: walletAddress.toBase58(),
      walletAddress: walletAddress.toBase58(),
    }));
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(recordConfirmedYieldWithdrawal).not.toHaveBeenCalled();
  });

  test("returns 403 when request account refs do not match the principal", async () => {
    const response = await POST(
      request(body({ settings: "11111111111111111111111111111115" }))
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "principal_mismatch",
        message:
          "Confirmed yield withdrawal does not match the authenticated wallet session.",
      },
    });
    expect(recordConfirmedYieldWithdrawal).not.toHaveBeenCalled();
  });

  test("valid confirmed withdrawal calls the repository with normalized input", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(recordConfirmedYieldWithdrawal).toHaveBeenCalledWith({
      cluster: "devnet",
      confirmedSlot: BigInt(123),
      liquidityMint: STABLECOIN_MINTS[Stablecoin.USDC].toBase58(),
      market: KAMINO_MAIN_MARKET.toBase58(),
      mode: "partial",
      policyAccount: policyPlan.actionAccount.toBase58(),
      policyId: BigInt(1),
      policySeed: BigInt(1),
      settings: settings.toBase58(),
      smartAccountAddress: smartAccountAddress.toBase58(),
      targetReserve: KAMINO_MAIN_USDC_RESERVE.toBase58(),
      vaultIndex: 1,
      vaultPubkey: policyPlan.metadata.vault.toBase58(),
      walletAddress: walletAddress.toBase58(),
      withdrawalSignature: "withdrawal-sig-1",
      withdrawnAmountRaw: BigInt(250_000),
    });
    expect(getSignatureStatuses).toHaveBeenCalledWith(["withdrawal-sig-1"], {
      searchTransactionHistory: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      position: {
        id: "1",
        lastConfirmedSlot: "123",
        policyId: "1",
        policySeed: "1",
        principalAmountRaw: "750000",
        targetSupplyApyBps: "523",
      },
    });
  });

  test("returns 400 when client policy metadata is tampered", async () => {
    const response = await POST(request(body({ policySeed: "2" })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "metadata_mismatch",
        message:
          "policySeed does not match the canonical earn withdrawal metadata.",
      },
    });
    expect(recordConfirmedYieldWithdrawal).not.toHaveBeenCalled();
  });

  test("returns 400 when the submitted signature is not confirmed", async () => {
    getSignatureStatuses.mockImplementationOnce(async () => ({
      value: [
        {
          confirmationStatus: "processed" as const,
          err: null,
          slot: 123,
        },
      ],
    }));

    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "unconfirmed_signature",
      },
    });
    expect(recordConfirmedYieldWithdrawal).not.toHaveBeenCalled();
  });
});
