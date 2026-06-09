import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { LoyalCluster } from "@loyal/actions";
import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";
import type { SmartAccountPreparedEarnUsdcDeposit } from "@loyal-labs/smart-account-vaults";
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  createYieldDepositRepositoryMock,
  findActiveYieldRoutePolicy,
} from "@/test/yield-route-mocks";

mock.module("server-only", () => ({}));

const programId = PublicKey.unique();
const settings = PublicKey.unique();
const walletAddress = PublicKey.unique();
const smartAccountAddress = PublicKey.unique();
const policyAccount = PublicKey.unique();
const vaultPubkey = PublicKey.unique();
const usdcAta = PublicKey.unique();
const reserve = PublicKey.unique();
const market = PublicKey.unique();
const liquidityMint = PublicKey.unique();

const resolveAuthenticatedPrincipalFromRequest = mock(async () => ({
  authMethod: "wallet" as const,
  provider: "solana" as const,
  settingsPda: settings.toBase58(),
  smartAccountAddress: smartAccountAddress.toBase58(),
  subjectAddress: walletAddress.toBase58(),
  walletAddress: walletAddress.toBase58(),
}));

function makePreparedDeposit(
  policyInitialization: "create" | "reuse" = "reuse"
): SmartAccountPreparedEarnUsdcDeposit {
  const prepared: PreparedLoyalSmartAccountsOperation<"earnUsdcDeposit"> = {
    instructions: [
      new TransactionInstruction({
        data: Buffer.from([1, 2, 3]),
        keys: [
          {
            isSigner: true,
            isWritable: true,
            pubkey: walletAddress,
          },
        ],
        programId,
      }),
    ],
    lookupTableAccounts: [
      new AddressLookupTableAccount({
        key: PublicKey.unique(),
        state: {
          addresses: [walletAddress, vaultPubkey],
          deactivationSlot: BigInt("18446744073709551615"),
          lastExtendedSlot: 10,
          lastExtendedSlotStartIndex: 0,
        },
      }),
    ],
    operation: "earnUsdcDeposit",
    payer: walletAddress,
    programId,
    requiresConfirmation: true,
  };

  return {
    kaminoSetupAccountCount: 0,
    kaminoSetupRentLamports: "0",
    kaminoSetupRequired: false,
    persistence: {
      cluster: LoyalCluster.Devnet,
      depositMint: liquidityMint.toBase58(),
      liquidityMint: liquidityMint.toBase58(),
      market: market.toBase58(),
      policyAccount: policyAccount.toBase58(),
      policyId: "2",
      policyInitialization,
      policySeed: "2",
      principalAmountRaw: "1000000",
      settings: settings.toBase58(),
      targetReserve: reserve.toBase58(),
      targetSupplyApyBps: null,
      vaultIndex: 1,
      vaultPubkey: vaultPubkey.toBase58(),
      walletAddress: walletAddress.toBase58(),
    },
    policy: {
      account: policyAccount,
      id: BigInt(2),
      sameMintInstructionConstraintIndexes: [0, 1],
      seed: BigInt(2),
    },
    prepared,
    targetReserve: {
      liquidityMint,
      market,
      reserve,
      supplyApyBps: null,
    },
    vault: {
      accountIndex: 1,
      collateralAta: null,
      pubkey: vaultPubkey,
      usdcAta,
    },
  };
}

const prepareEarnUsdcDeposit = mock(
  async (): Promise<SmartAccountPreparedEarnUsdcDeposit> =>
    makePreparedDeposit()
);

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({
    loyalSmartAccounts: { programId: programId.toBase58() },
  }),
}));

mock.module(
  "@/lib/yield-optimization/yield-deposit-repository.server",
  createYieldDepositRepositoryMock
);

mock.module("@/lib/solana/rpc-endpoints", () => ({
  getFrontendSolanaEndpoints: () => ({
    rpcEndpoint: "https://rpc.example",
    websocketEndpoint: "wss://rpc.example",
  }),
}));

mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: (fetch: typeof globalThis.fetch) => fetch,
}));

mock.module("@loyal-labs/smart-account-vaults", () => ({
  createSmartAccountVaultsClient: () => ({
    prepareEarnUsdcDeposit,
  }),
}));

let POST: typeof import("../route").POST;
const previousSolanaEnv = process.env.NEXT_PUBLIC_SOLANA_ENV;

function request(payload: unknown = { amountRaw: "1000000" }) {
  return new Request(
    "https://app.askloyal.com/api/smart-accounts/yield-optimization/deposits/prepare",
    {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
}

describe("yield optimization deposit prepare route", () => {
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
    prepareEarnUsdcDeposit.mockClear();
    findActiveYieldRoutePolicy.mockClear();
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(async () => ({
      authMethod: "wallet" as const,
      provider: "solana" as const,
      settingsPda: settings.toBase58(),
      smartAccountAddress: smartAccountAddress.toBase58(),
      subjectAddress: walletAddress.toBase58(),
      walletAddress: walletAddress.toBase58(),
    }));
    findActiveYieldRoutePolicy.mockImplementation(async () => ({
      active: true,
      authority: walletAddress.toBase58(),
      delegatedSigners: [walletAddress.toBase58()],
      firstSeenAt: new Date("2026-06-01T00:00:00.000Z"),
      id: BigInt(2),
      kaminoLiquidityMints: [liquidityMint.toBase58()],
      kaminoMarkets: [market.toBase58()],
      lastSeenAt: new Date("2026-06-01T00:00:00.000Z"),
      lastSeenSignature: "policy-sig-1",
      lastSeenSlot: BigInt(123),
      policyAccount: policyAccount.toBase58(),
      policySeed: BigInt(2),
      riskProfile: "safe",
      routeModes: ["same-mint-kamino"],
      settings: settings.toBase58(),
      stableMints: [liquidityMint.toBase58()],
      swapLanes: [],
      threshold: 1,
      universePreset: "earn-usdc",
      vaultIndex: 1,
      vaultPubkey: vaultPubkey.toBase58(),
    }));
    prepareEarnUsdcDeposit.mockImplementation(async () => makePreparedDeposit());
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(findActiveYieldRoutePolicy).not.toHaveBeenCalled();
    expect(prepareEarnUsdcDeposit).not.toHaveBeenCalled();
  });

  test("returns 400 for invalid or non-positive amountRaw", async () => {
    const response = await POST(request({ amountRaw: "0" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "amountRaw must be greater than 0.",
      },
    });
    expect(findActiveYieldRoutePolicy).not.toHaveBeenCalled();
    expect(prepareEarnUsdcDeposit).not.toHaveBeenCalled();
  });

  test("prepares an initial Earn deposit when no active policy exists", async () => {
    findActiveYieldRoutePolicy.mockImplementationOnce(async () => null);
    prepareEarnUsdcDeposit.mockImplementationOnce(async () =>
      makePreparedDeposit("create")
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(prepareEarnUsdcDeposit).toHaveBeenCalledWith({
      amountRaw: BigInt(1_000_000),
      cluster: "devnet",
      feePayer: walletAddress,
      initializeYieldRoutingPolicy: true,
      settingsPda: settings,
      walletAddress,
    });
    await expect(response.json()).resolves.toMatchObject({
      preparedDeposit: {
        persistence: {
          policyInitialization: "create",
          principalAmountRaw: "1000000",
        },
      },
    });
  });

  test("prepares a reusable Earn deposit with the active policy", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(findActiveYieldRoutePolicy).toHaveBeenCalledWith({
      authority: walletAddress.toBase58(),
      cluster: "devnet",
      settings: settings.toBase58(),
      vaultIndex: 1,
    });
    expect(prepareEarnUsdcDeposit).toHaveBeenCalledWith({
      amountRaw: BigInt(1_000_000),
      cluster: "devnet",
      feePayer: walletAddress,
      initializeYieldRoutingPolicy: false,
      settingsPda: settings,
      walletAddress,
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(2),
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      preparedDeposit: {
        persistence: {
          policyInitialization: "reuse",
          principalAmountRaw: "1000000",
        },
        prepared: {
          instructions: [
            {
              dataBase64: "AQID",
              keys: [
                {
                  isSigner: true,
                  isWritable: true,
                  pubkey: walletAddress.toBase58(),
                },
              ],
              programId: programId.toBase58(),
            },
          ],
          operation: "earnUsdcDeposit",
          payer: walletAddress.toBase58(),
          programId: programId.toBase58(),
          requiresConfirmation: true,
        },
      },
    });
  });
});
