import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const programId = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";
const settingsPda = "11111111111111111111111111111112";
const walletAddress = "11111111111111111111111111111113";

const resolveAuthenticatedPrincipalFromRequest = mock(async () => ({
  authMethod: "wallet" as const,
  subjectAddress: walletAddress,
  displayAddress: walletAddress,
  walletAddress,
  provider: "solana" as const,
  smartAccountAddress: "smart-account-1",
  settingsPda,
}));

const findActiveYieldPosition = mock(async () => null);
const findActiveYieldRoutePolicy = mock(async () => null);

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({
    loyalSmartAccounts: { programId },
  }),
}));

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findActiveYieldPosition,
  findActiveYieldRoutePolicy,
}));

let GET: typeof import("../route").GET;

describe("smart-account earn state route", () => {
  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "devnet";
    ({ GET } = await import("../route"));
  });

  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(async () => ({
      authMethod: "wallet" as const,
      subjectAddress: walletAddress,
      displayAddress: walletAddress,
      walletAddress,
      provider: "solana" as const,
      smartAccountAddress: "smart-account-1",
      settingsPda,
    }));
    findActiveYieldPosition.mockClear();
    findActiveYieldRoutePolicy.mockClear();
    findActiveYieldPosition.mockImplementation(async () => null);
    findActiveYieldRoutePolicy.mockImplementation(async () => null);
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earn-state"
      )
    );

    expect(response.status).toBe(401);
    expect(findActiveYieldPosition).not.toHaveBeenCalled();
    expect(findActiveYieldRoutePolicy).not.toHaveBeenCalled();
  });

  test("derives earn vault and default policy without RPC", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earn-state"
      )
    );
    const [earnVault] = pda.getSmartAccountPda({
      accountIndex: 1,
      programId: new PublicKey(programId),
      settingsPda: new PublicKey(settingsPda),
    });
    const [defaultPolicy] = pda.getPolicyPda({
      policySeed: 1,
      programId: new PublicKey(programId),
      settingsPda: new PublicKey(settingsPda),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      defaultPolicy: {
        account: defaultPolicy.toBase58(),
        seed: "1",
      },
      policy: null,
      position: null,
      settingsPda,
      vault: {
        accountIndex: 1,
        pubkey: earnVault.toBase58(),
      },
    });
    expect(findActiveYieldPosition).toHaveBeenCalledTimes(1);
    expect(findActiveYieldRoutePolicy).toHaveBeenCalledWith({
      authority: walletAddress,
      cluster: "devnet",
      settings: settingsPda,
      vaultIndex: 1,
    });
  });

  test("returns DB-backed policy metadata when present", async () => {
    findActiveYieldRoutePolicy.mockImplementationOnce(async () => ({
      active: true,
      authority: walletAddress,
      cluster: "devnet",
      delegatedSigners: [walletAddress],
      firstSeenAt: new Date("2026-06-01T00:00:00.000Z"),
      id: BigInt(55),
      kaminoLiquidityMints: [],
      kaminoMarkets: [],
      lastSeenAt: new Date("2026-06-01T00:00:00.000Z"),
      lastSeenSignature: "signature",
      lastSeenSlot: BigInt(10),
      policyAccount: "policy-1",
      policySeed: BigInt(7),
      riskProfile: "safe",
      routeModes: [],
      settings: settingsPda,
      stableMints: [],
      swapLanes: [],
      threshold: 1,
      universePreset: "safe",
      vaultIndex: 1,
      vaultPubkey: "vault-1",
    }));

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/earn-state"
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      policy: {
        account: "policy-1",
        id: "55",
        seed: "7",
        vaultIndex: 1,
        vaultPubkey: "vault-1",
      },
    });
  });
});
