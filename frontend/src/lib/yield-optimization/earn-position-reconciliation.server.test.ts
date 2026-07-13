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
const programId = new PublicKey("11111111111111111111111111111119");
// A Safe market the policy allows but the read-model has never recorded — the
// shape a rebalance leaves behind.
const secondMarket = new PublicKey("1111111111111111111111111111111A");
const secondReserve = new PublicKey("1111111111111111111111111111111B");
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
const recordSnapshotReconciledYieldHolding = mock(async () => ({}));

mock.module("./yield-deposit-repository.server", () => ({
  findActiveManagedYieldVaultWithPolicy,
  findCurrentNonzeroYieldVaultReservePositions,
  findReconciledActiveYieldPositionForVault,
  recordSnapshotReconciledYieldHolding,
  recordReconciledYieldVaultSnapshot,
}));

mock.module("@loyal-labs/actions", () => ({
  KAMINO_VANILLA_OBLIGATION_ID: 0,
  KAMINO_VANILLA_OBLIGATION_TAG: 0,
  LoyalCluster: { MainnetBeta: "mainnet-beta" },
  RiskBasket: { Safe: "safe" },
  Stablecoin: { USDC: "usdc" },
  getKaminoUsdcEarnTargetForCluster: () => ({
    lendProgramId: programId,
    liquidityMint: usdcMint,
    market,
    reserve,
  }),
  getRiskBasketMarketsForCluster: () => [market, secondMarket],
  getStablecoinMintForCluster: () => usdcMint,
  normalizeLoyalCluster: (cluster: string) => cluster,
  resolveLoyalClusterForSolanaEnv: () => "mainnet-beta",
}));

mock.module("@loyal-labs/smart-account-vaults", () => ({
  calculateKaminoRedeemableLiquidityAmountRaw: ({
    collateralAmountRaw,
  }: {
    collateralAmountRaw: bigint;
  }) => collateralAmountRaw * BigInt(2),
  createSmartAccountVaultsClient: (input: unknown) => {
    const hook = (
      globalThis as unknown as {
        __createEarnTestVaultsClient?: (config: unknown) => unknown;
      }
    ).__createEarnTestVaultsClient;
    return hook?.(input) ?? {};
  },
  parseKaminoObligationDepositedCollateralAmountRaw: ({
    data,
    reserve,
  }: {
    data: Buffer;
    reserve: PublicKey;
  }) => {
    if (data[0] === 3) {
      return reserve.equals(secondReserve) ? BigInt(9) : BigInt(0);
    }

    return data[0] === 1 ? BigInt(5) : BigInt(0);
  },
  // A `3` obligation belongs to the second market and deposits into a reserve
  // the read-model has never recorded; anything else deposits nothing new.
  parseKaminoObligationAccount: (data: Buffer) => ({
    deposits:
      data[0] === 3
        ? [{ depositedAmountRaw: BigInt(9), reserve: secondReserve, slotIndex: 0 }]
        : [],
    lendingMarket: data[0] === 3 ? secondMarket : market,
    owner: vault,
  }),
  parseKaminoReserveTokenAccounts: () => ({
    reserveCollateralMint: collateralMint,
    reserveLiquidityMint: usdcMint,
  }),
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
  ASSOCIATED_TOKEN_PROGRAM_ID: new PublicKey(
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
  ),
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
  getAssociatedTokenAddressSync: () => usdcAta,
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
    getMultipleAccountsInfoAndContext: mock(
      async (_keys: PublicKey[], _config?: unknown) => {
        void _keys;
        void _config;
        return {
          context: { slot: 123 },
          value: accounts.map((account) =>
            account
              ? {
                  data: account.data,
                  owner: tokenProgramId,
                }
              : null
          ),
        };
      }
    ),
  };
}

function obligationFor(lendingMarket: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [
      Uint8Array.of(0),
      Uint8Array.of(0),
      vault.toBytes(),
      lendingMarket.toBytes(),
      PublicKey.default.toBytes(),
      PublicKey.default.toBytes(),
    ],
    programId
  )[0];
}

// Answers by pubkey rather than position, so the second market's obligation and
// its reserve resolve wherever they land in the batch.
function createKeyedConnection(
  accounts: Map<string, { data: Buffer; owner: PublicKey }>
) {
  return {
    getMultipleAccountsInfoAndContext: mock(async (keys: PublicKey[]) => ({
      context: { slot: 321 },
      value: keys.map((key) => accounts.get(key.toBase58()) ?? null),
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

  test("does not reuse a positive fallback for a post-withdraw zero proof", async () => {
    const now = new Date("2026-06-17T00:30:00.000Z");
    const connection = createConnection([
      { data: Buffer.from([0]) },
      { data: Buffer.from([0]) },
      null,
    ]);
    findActiveManagedYieldVaultWithPolicy.mockImplementation(async () =>
      createManagedVault(null)
    );
    findReconciledActiveYieldPositionForVault.mockImplementation(async () =>
      createPosition()
    );
    findCurrentNonzeroYieldVaultReservePositions.mockImplementation(
      async () => [
        {
          amountRaw: BigInt(99),
          borrowApyBps: null,
          hasValue: true,
          liquidityMint: usdcMint.toBase58(),
          market: market.toBase58(),
          observedAt: now,
          observedSlot: BigInt(400),
          planningMetadata: {},
          reserve: reserve.toBase58(),
          snapshotId: BigInt(1),
          supplyApyBps: null,
          vaultId: BigInt(22),
        },
      ]
    );

    await reconcileEarnVaultPosition(
      {
        authority: "wallet",
        cluster: "mainnet-beta" as never,
        connection: connection as never,
        force: true,
        minContextSlot: 500,
        purpose: "post_withdrawal_zero_proof",
        settings: "settings",
        vaultPubkey: vault.toBase58(),
      },
      { now: () => now }
    );

    const [input] = (recordReconciledYieldVaultSnapshot.mock.calls.at(-1) ??
      []) as unknown as [RecordedSnapshotInput];
    expect(input.positions[0]?.amountRaw).toBe(BigInt(0));
    expect(
      connection.getMultipleAccountsInfoAndContext.mock.calls[0]?.[1]
    ).toEqual({ commitment: "confirmed", minContextSlot: 500 });
  });

  test("discovers a policy market the read-model never recorded", async () => {
    // The rebalance shape: the recorded market's obligation is empty and the
    // funds sit in a Safe market that has no reserve row, so the old candidate
    // list (canonical + position + rows) could never see them.
    const now = new Date("2026-06-17T00:50:00.000Z");
    const connection = createKeyedConnection(
      new Map([
        [reserve.toBase58(), { data: Buffer.from([0]), owner: programId }],
        [
          obligationFor(market).toBase58(),
          { data: Buffer.from([0]), owner: programId },
        ],
        [
          obligationFor(secondMarket).toBase58(),
          { data: Buffer.from([3]), owner: programId },
        ],
        [
          secondReserve.toBase58(),
          { data: Buffer.from([0]), owner: programId },
        ],
        [usdcAta.toBase58(), { data: Buffer.from([2]), owner: tokenProgramId }],
      ])
    );
    findActiveManagedYieldVaultWithPolicy.mockImplementation(async () => ({
      ...createManagedVault(null),
      routePolicy: {
        kaminoMarkets: [market.toBase58(), secondMarket.toBase58()],
      },
    }));
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
        force: true,
        settings: "settings",
        vaultPubkey: vault.toBase58(),
      },
      { now: () => now }
    );

    expect(result.status).toBe("refreshed");
    const [snapshotInput] = (recordReconciledYieldVaultSnapshot.mock.calls.at(
      -1
    ) ?? []) as unknown as [
      { positions: Array<{ amountRaw: bigint; market: string; reserve: string }> },
    ];
    const discovered = snapshotInput.positions.find(
      (row) => row.reserve === secondReserve.toBase58()
    );
    // 9 collateral units valued through the discovered reserve (mock rate 2x).
    expect(discovered?.amountRaw).toBe(BigInt(18));
    expect(discovered?.market).toBe(secondMarket.toBase58());

    // The position row follows the money, so every read-model consumer stops
    // pointing at the empty market.
    const [holdingInput] = (recordSnapshotReconciledYieldHolding.mock.calls.at(
      -1
    ) ?? []) as unknown as [
      { amountRaw: bigint; market: string; reserve: string },
    ];
    expect(holdingInput.reserve).toBe(secondReserve.toBase58());
    expect(holdingInput.market).toBe(secondMarket.toBase58());
    expect(holdingInput.amountRaw).toBe(BigInt(25));
  });

  test("rejects an unreadable reserve before mutating a positive obligation snapshot", async () => {
    const now = new Date("2026-06-17T00:40:00.000Z");
    const connection = createConnection([
      null,
      { data: Buffer.from([1]) },
      null,
    ]);
    findActiveManagedYieldVaultWithPolicy.mockImplementation(async () =>
      createManagedVault(null)
    );
    findReconciledActiveYieldPositionForVault.mockImplementation(async () =>
      createPosition()
    );
    findCurrentNonzeroYieldVaultReservePositions.mockImplementation(
      async () => []
    );
    const snapshotWriteCount =
      recordReconciledYieldVaultSnapshot.mock.calls.length;

    await expect(
      reconcileEarnVaultPosition(
        {
          authority: "wallet",
          cluster: "mainnet-beta" as never,
          connection: connection as never,
          force: true,
          minContextSlot: 500,
          purpose: "post_withdrawal_zero_proof",
          settings: "settings",
          vaultPubkey: vault.toBase58(),
        },
        { now: () => now }
      )
    ).rejects.toThrow(
      "Kamino reserve account is unavailable for a positive Earn obligation."
    );
    expect(recordReconciledYieldVaultSnapshot.mock.calls.length).toBe(
      snapshotWriteCount
    );
  });
});
