import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const findActiveManagedYieldVaultWithPolicy = mock(async () => ({
  routePolicy: {
    delegatedSigners: ["delegate"],
    id: BigInt(1),
    kaminoLiquidityMints: ["USDC", "PYUSD"],
    kaminoMarkets: ["market"],
    policyAccount: "policy",
    policySeed: BigInt(7),
    riskProfile: "safe",
    routeModes: ["same_mint_kamino"],
    stableMints: ["USDC", "PYUSD"],
    universePreset: "earn",
    vaultIndex: 1,
    vaultPubkey: "vault",
  },
  setupPolicy: null,
  vault: {
    activePolicyId: BigInt(1),
    id: BigInt(2),
    lastReconciledAt: null,
    lastReconciledSlot: null,
  },
}));
const findReconciledActiveYieldPositionForVault = mock(async () => ({
  id: BigInt(3),
}));
const recordReconciledYieldVaultSnapshot = mock(async () => ({
  snapshotId: BigInt(4),
}));
const fetchEarnRpcHoldingsSnapshot = mock(async () => ({
  completeness: "complete" as const,
  currentTotalAmountRaw: "110",
  currentTotalNominalUsdMicros: "110",
  holdings: [
    {
      amountRaw: "100",
      kind: "kamino" as const,
      label: "Main PYUSD",
      liquidityMint: "PYUSD",
      market: "market",
      marketName: "Main",
      observedAt: "2026-08-11T00:00:00.000Z",
      observedSlot: "9",
      provenance: {},
      reserve: "reserve-pyusd",
      sourceId: "reserve:reserve-pyusd",
      supplyApyBps: "500",
      tokenProgramId: "token-2022",
    },
    {
      amountRaw: "10",
      kind: "idle" as const,
      label: "Idle USDC",
      liquidityMint: "USDC",
      market: null,
      marketName: "USDC",
      observedAt: "2026-08-11T00:00:00.000Z",
      observedSlot: "9",
      provenance: { owner: "vault", tokenAccount: "usdc-ata" },
      reserve: null,
      sourceId: "idle:usdc-ata",
      supplyApyBps: null,
      tokenProgramId: "token",
    },
  ],
  observedAt: "2026-08-11T00:00:00.000Z",
  observedSlot: "9",
  provenance: {
    accountCount: 8,
    chunkCount: 2,
    commitment: "confirmed" as const,
    source: "rpc_getMultipleAccounts" as const,
    watchedAccounts: [],
  },
}));

mock.module("./yield-deposit-repository.server", () => ({
  findActiveManagedYieldVaultWithPolicy,
  findReconciledActiveYieldPositionForVault,
  recordReconciledYieldVaultSnapshot,
}));
mock.module("./earn-rpc-holdings.client", () => ({
  fetchEarnRpcHoldingsSnapshot,
}));
mock.module("@/lib/core/config/server", () => ({
  resolveLoyalSmartAccountsProgramIdFromEnv: () =>
    "11111111111111111111111111111111",
}));

const { reconcileEarnVaultPosition } = await import(
  "./earn-position-reconciliation.server"
);

describe("Earn complete-snapshot reconciliation", () => {
  test("persists the shared RPC holdings vector without a primary aggregate", async () => {
    await reconcileEarnVaultPosition(
      {
        authority: "wallet",
        cluster: "mainnet-beta" as never,
        connection: {} as never,
        force: true,
        settings: "11111111111111111111111111111111",
        vaultPubkey: "vault",
      },
      { now: () => new Date("2026-08-11T00:00:00.000Z") }
    );

    expect(fetchEarnRpcHoldingsSnapshot).toHaveBeenCalledTimes(1);
    const calls = recordReconciledYieldVaultSnapshot.mock.calls as unknown as Array<
      [
        {
          context: Record<string, unknown>;
          idleTokenBalances: unknown[];
          positions: unknown[];
        },
      ]
    >;
    const written = calls.at(-1)?.[0];
    if (!written) {
      throw new Error("expected reconciled snapshot write");
    }
    expect(written.context.publication_scope).toBe("complete_product_vault");
    expect(written.positions).toEqual([
      expect.objectContaining({
        amountRaw: BigInt(100),
        liquidityMint: "PYUSD",
        reserve: "reserve-pyusd",
      }),
    ]);
    expect(written.idleTokenBalances).toEqual([
      {
        amountRaw: BigInt(10),
        mint: "USDC",
        owner: "vault",
        tokenAccount: "usdc-ata",
      },
    ]);
  });
});
