import { describe, expect, mock, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const vault = new PublicKey("11111111111111111111111111111112");
const usdcMint = new PublicKey("11111111111111111111111111111113");
const collateralMint = new PublicKey("11111111111111111111111111111114");
const collateralAta = new PublicKey("11111111111111111111111111111115");
const reserve = new PublicKey("11111111111111111111111111111116");
const market = new PublicKey("11111111111111111111111111111117");
const usdcAta = new PublicKey("11111111111111111111111111111118");
const tokenProgramId = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

const findActiveManagedYieldVaultWithPolicy = mock(
  async (): Promise<unknown> => null
);
const findCurrentNonzeroYieldVaultReservePositions = mock(
  async (): Promise<unknown[]> => []
);
const findReconciledActiveYieldPositionForVault = mock(
  async (): Promise<unknown> => null
);
const recordReconciledYieldVaultSnapshot = mock(async () => ({
  snapshotId: BigInt(55),
}));

mock.module("./yield-deposit-repository.server", () => ({
  findActiveManagedYieldVaultWithPolicy,
  findCurrentNonzeroYieldVaultReservePositions,
  findReconciledActiveYieldPositionForVault,
  recordReconciledYieldVaultSnapshot,
}));

mock.module("@loyal-labs/actions", () => ({
  getKaminoUsdcEarnTargetForCluster: () => ({
    liquidityMint: usdcMint,
    market,
    reserve,
  }),
}));

mock.module("@loyal-labs/smart-account-vaults", () => ({
  calculateKaminoRedeemableLiquidityAmountRaw: ({
    collateralAmountRaw,
  }: {
    collateralAmountRaw: bigint;
  }) => collateralAmountRaw * BigInt(2),
  parseKaminoReserveSnapshot: () => ({
    collateralSupplyRaw: BigInt(100),
    totalLiquiditySupplyScaled: BigInt(200),
  }),
  resolveEarnUsdcVaultTokenAccounts: ({
    target,
  }: {
    target?: { liquidityMint: PublicKey; reserveCollateralMint?: PublicKey };
  }) => ({
    collateralAta: target?.reserveCollateralMint ? collateralAta : null,
    targetReserve: {
      liquidityMint: target?.liquidityMint ?? usdcMint,
      market,
      reserve,
      reserveCollateralMint: target?.reserveCollateralMint,
    },
    usdcAta,
  }),
}));

mock.module("@solana/spl-token", () => ({
  AccountLayout: {
    decode: (data: Buffer) => {
      if (data[0] === 1) {
        return {
          amount: BigInt(5),
          mint: collateralMint,
          owner: vault,
        };
      }

      return {
        amount: BigInt(7),
        mint: usdcMint,
        owner: vault,
      };
    },
  },
  TOKEN_PROGRAM_ID: tokenProgramId,
}));

const { reconcileEarnVaultPosition } = await import(
  "./earn-position-reconciliation.server"
);

type RecordedSnapshotInput = {
  idleTokenBalance: { amountRaw: bigint };
  observedSlot: bigint;
  positions: Array<{ amountRaw: bigint }>;
};

function createManagedVault(lastReconciledAt: Date | null = null) {
  return {
    routePolicy: {},
    setupPolicy: null,
    vault: {
      activePolicyId: BigInt(44),
      id: BigInt(22),
      lastReconciledAt,
      lastReconciledSlot: lastReconciledAt ? BigInt(100) : null,
    },
  };
}

function createPosition() {
  return {
    currentLiquidityMint: usdcMint.toBase58(),
    currentMarket: market.toBase58(),
    currentReserve: reserve.toBase58(),
    id: BigInt(33),
  };
}

function createConnection(accounts: Array<{ data: Buffer } | null>) {
  return {
    getMultipleAccountsInfoAndContext: mock(async () => ({
      context: { slot: 123 },
      value: accounts.map((account) =>
        account
          ? {
              data: account.data,
              owner: tokenProgramId,
            }
          : null
      ),
    })),
  };
}

describe("earn position reconciliation", () => {
  test("returns cached without RPC when the vault was reconciled recently", async () => {
    const now = new Date("2026-06-17T00:05:00.000Z");
    const connection = createConnection([]);
    findActiveManagedYieldVaultWithPolicy.mockImplementation(async () =>
      createManagedVault(new Date("2026-06-17T00:02:00.000Z"))
    );
    findReconciledActiveYieldPositionForVault.mockImplementation(async () =>
      createPosition()
    );

    const result = await reconcileEarnVaultPosition(
      {
        authority: "wallet",
        cluster: "mainnet-beta" as never,
        connection: connection as never,
        settings: "settings",
        vaultPubkey: vault.toBase58(),
      },
      { now: () => now }
    );

    expect(result.status).toBe("cached");
    expect(connection.getMultipleAccountsInfoAndContext).not.toHaveBeenCalled();
  });

  test("refreshes stale Kamino and idle USDC rows from RPC", async () => {
    const now = new Date("2026-06-17T00:10:00.000Z");
    const connection = createConnection([
      { data: Buffer.from([0]) },
      { data: Buffer.from([1]) },
      { data: Buffer.from([2]) },
    ]);
    findActiveManagedYieldVaultWithPolicy.mockImplementation(async () =>
      createManagedVault(new Date("2026-06-17T00:00:00.000Z"))
    );
    findReconciledActiveYieldPositionForVault.mockImplementation(async () =>
      createPosition()
    );
    findCurrentNonzeroYieldVaultReservePositions.mockImplementation(
      async () => [
        {
          amountRaw: BigInt(1),
          borrowApyBps: null,
          hasValue: true,
          liquidityMint: usdcMint.toBase58(),
          market: market.toBase58(),
          observedAt: now,
          observedSlot: BigInt(1),
          planningMetadata: {
            reserveCollateralMint: collateralMint.toBase58(),
          },
          reserve: reserve.toBase58(),
          snapshotId: BigInt(1),
          supplyApyBps: null,
          vaultId: BigInt(22),
        },
      ]
    );

    const result = await reconcileEarnVaultPosition(
      {
        authority: "wallet",
        cluster: "mainnet-beta" as never,
        connection: connection as never,
        settings: "settings",
        vaultPubkey: vault.toBase58(),
      },
      { now: () => now }
    );

    expect(result.status).toBe("refreshed");
    expect(recordReconciledYieldVaultSnapshot).toHaveBeenCalled();
    const [input] = (recordReconciledYieldVaultSnapshot.mock.calls.at(-1) ??
      []) as unknown as [RecordedSnapshotInput];
    expect(input.positions[0].amountRaw).toBe(BigInt(10));
    expect(input.idleTokenBalance.amountRaw).toBe(BigInt(7));
    expect(input.observedSlot).toBe(BigInt(123));
  });

  test("records zero idle USDC when the vault ATA is missing", async () => {
    const now = new Date("2026-06-17T00:20:00.000Z");
    const connection = createConnection([null]);
    findActiveManagedYieldVaultWithPolicy.mockImplementation(async () =>
      createManagedVault(null)
    );
    findReconciledActiveYieldPositionForVault.mockImplementation(async () =>
      createPosition()
    );
    findCurrentNonzeroYieldVaultReservePositions.mockImplementation(
      async () => []
    );

    const result = await reconcileEarnVaultPosition(
      {
        authority: "wallet",
        cluster: "mainnet-beta" as never,
        connection: connection as never,
        settings: "settings",
        vaultPubkey: vault.toBase58(),
      },
      { now: () => now }
    );

    expect(result.status).toBe("refreshed");
    const [input] = (recordReconciledYieldVaultSnapshot.mock.calls.at(-1) ??
      []) as unknown as [RecordedSnapshotInput];
    expect(input.idleTokenBalance.amountRaw).toBe(BigInt(0));
  });
});
