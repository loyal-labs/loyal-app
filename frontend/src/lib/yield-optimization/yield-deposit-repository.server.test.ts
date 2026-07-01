import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { recordConfirmedYieldDeposit } = await import(
  "./yield-deposit-repository.server"
);
const { recordConfirmedYieldWithdrawal } = await import(
  "./yield-deposit-repository.server"
);
const { verifyUserYieldPositions } = await import(
  "./yield-deposit-repository.server"
);

function createDepositInput(overrides: Record<string, unknown> = {}) {
  return {
    cluster: "mainnet-beta",
    confirmedSlot: BigInt(300),
    delegatedSigner: "delegate",
    depositMint: "usdc",
    depositSignature: "deposit-signature",
    liquidityMint: "usdc",
    market: "market",
    policyAccount: "policy",
    policyId: BigInt(7),
    policyInitialization: "reuse" as const,
    policySeed: BigInt(7),
    policySignature: "policy-signature",
    principalAmountRaw: BigInt(1000),
    settings: "settings",
    smartAccountAddress: "smart-account",
    targetReserve: "reserve",
    targetSupplyApyBps: BigInt(123),
    vaultIndex: 1,
    vaultPubkey: "vault",
    walletAddress: "wallet",
    ...overrides,
  };
}

function createPersistedDeposit(overrides: Record<string, unknown> = {}) {
  return {
    confirmedAt: new Date("2026-06-01T00:00:00.000Z"),
    confirmedSlot: BigInt(300),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    depositMint: "usdc",
    depositSignature: "deposit-signature",
    id: BigInt(11),
    liquidityMint: "usdc",
    market: "market",
    policyAccount: "policy",
    policyId: BigInt(7),
    policySeed: BigInt(7),
    policySignature: "policy-signature",
    principalAmountRaw: BigInt(1000),
    settings: "settings",
    smartAccountAddress: "vault",
    targetReserve: "reserve",
    targetSupplyApyBps: BigInt(123),
    vaultIndex: 1,
    vaultPubkey: "vault",
    walletAddress: "wallet",
    ...overrides,
  };
}

function createPosition() {
  return {
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    currentAmountRaw: BigInt(1000),
    currentLiquidityMint: "usdc",
    currentMarket: "market",
    currentObservedAt: new Date("2026-06-01T00:00:00.000Z"),
    currentObservedSlot: BigInt(300),
    currentReserve: "reserve",
    depositMint: "usdc",
    firstDepositSignature: "deposit-signature",
    id: BigInt(22),
    initialLiquidityMint: "usdc",
    initialMarket: "market",
    initialPrincipalAmountRaw: BigInt(1000),
    initialReserve: "reserve",
    initialSupplyApyBps: BigInt(123),
    lastConfirmedSlot: BigInt(300),
    lastDepositSignature: "deposit-signature",
    lastHoldingEventId: BigInt(33),
    lastRebalanceDecisionId: null,
    policyAccount: "policy",
    policyId: BigInt(7),
    policySeed: BigInt(7),
    principalAmountRaw: BigInt(1000),
    settings: "settings",
    smartAccountAddress: "vault",
    status: "active" as const,
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    vaultIndex: 1,
    vaultPubkey: "vault",
    walletAddress: "wallet",
  };
}

function createHoldingEvent(overrides: Record<string, unknown> = {}) {
  return {
    amountRaw: BigInt(1000),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    eventType: "deposit_initialized",
    holdingDeltaRaw: BigInt(1000),
    id: BigInt(33),
    liquidityMint: "usdc",
    market: "market",
    observedAt: new Date("2026-06-01T00:00:00.000Z"),
    observedSlot: BigInt(300),
    positionId: BigInt(22),
    principalDeltaRaw: BigInt(1000),
    reserve: "reserve",
    sourceDepositId: BigInt(11),
    sourceRebalanceDecisionId: null,
    sourceSignature: null,
    sourceSnapshotId: null,
    sourceWithdrawalId: null,
    ...overrides,
  };
}

function createWithdrawalInput(overrides: Record<string, unknown> = {}) {
  return {
    cluster: "mainnet-beta",
    confirmedSlot: BigInt(500),
    delegatedSigner: "delegate",
    liquidityMint: "usdc",
    market: "market",
    mode: "full" as const,
    policyAccount: "policy",
    policyId: BigInt(7),
    policySeed: BigInt(7),
    settings: "settings",
    smartAccountAddress: "smart-account",
    targetReserve: "reserve",
    vaultIndex: 1,
    vaultPubkey: "vault",
    walletAddress: "wallet",
    withdrawalSignature: "withdrawal-signature",
    withdrawnAmountRaw: BigInt(1000),
    ...overrides,
  };
}

function createPersistedWithdrawal(overrides: Record<string, unknown> = {}) {
  return {
    confirmedAt: new Date("2026-06-01T00:00:00.000Z"),
    confirmedSlot: BigInt(500),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    id: BigInt(12),
    liquidityMint: "usdc",
    market: "market",
    mode: "full",
    policyAccount: "policy",
    policyId: BigInt(7),
    policySeed: BigInt(7),
    settings: "settings",
    smartAccountAddress: "vault",
    targetReserve: "reserve",
    vaultIndex: 1,
    vaultPubkey: "vault",
    walletAddress: "wallet",
    withdrawalSignature: "withdrawal-signature",
    withdrawnAmountRaw: BigInt(1000),
    ...overrides,
  };
}

function createDependencies(args: {
  deposit: Record<string, unknown> | null;
  event?: Record<string, unknown> | null;
  position?: Record<string, unknown> | null;
}) {
  const insert = mock(() => {
    throw new Error("insert must not run for idempotent deposits");
  });
  const update = mock(() => {
    throw new Error("update must not run for idempotent deposits");
  });

  return {
    client: {
      db: {
        insert,
        query: {
          userYieldPositionDeposits: {
            findFirst: mock(async () => args.deposit),
          },
          userYieldPositionHoldingEvents: {
            findFirst: mock(async () => args.event ?? null),
          },
          userYieldPositions: {
            findFirst: mock(async () => args.position ?? null),
          },
        },
        update,
      },
    },
    insert,
    now: () => new Date("2026-06-02T00:00:00.000Z"),
    update,
  };
}

function createVerificationDependencies(args: {
  deposits: Array<{ amountRaw: bigint }>;
  holdingEvents: Record<string, unknown>[];
  positions: Record<string, unknown>[];
  withdrawals?: Array<{
    id: bigint;
    mode: string;
    sourceType: string | null;
    withdrawnAmountRaw: bigint;
  }>;
}) {
  let selectIndex = 0;
  const queryResults = new Map<number, unknown[]>([[0, args.positions]]);

  function createQuery(index: number) {
    const query = {
      from: () => query,
      limit: () => query,
      orderBy: () => query,
      then: (
        onFulfilled?: (value: unknown[]) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) =>
        Promise.resolve(queryResults.get(index) ?? []).then(
          onFulfilled,
          onRejected
        ),
      where: () => query,
    };
    return query;
  }

  return {
    client: {
      db: {
        batch: mock(async () => [
          args.deposits,
          args.withdrawals ?? [],
          args.holdingEvents,
        ]),
        select: mock(() => createQuery(selectIndex++)),
      },
    },
  };
}

describe("yield deposit repository idempotency", () => {
  test("returns the existing position for an exact duplicate deposit", async () => {
    const position = createPosition();
    const dependencies = createDependencies({
      deposit: createPersistedDeposit(),
      event: createHoldingEvent({ positionId: position.id }),
      position,
    });

    const result = await recordConfirmedYieldDeposit(
      createDepositInput(),
      dependencies as never
    );

    expect(result).toBe(position);
    expect(dependencies.insert).not.toHaveBeenCalled();
    expect(dependencies.update).not.toHaveBeenCalled();
  });

  test("rejects duplicate deposit metadata mismatches before mutation", async () => {
    const dependencies = createDependencies({
      deposit: createPersistedDeposit({ targetReserve: "reserve" }),
    });

    await expect(
      recordConfirmedYieldDeposit(
        createDepositInput({ targetReserve: "other-reserve" }),
        dependencies as never
      )
    ).rejects.toThrow("Duplicate deposit targetReserve metadata mismatch.");
    expect(dependencies.insert).not.toHaveBeenCalled();
    expect(dependencies.update).not.toHaveBeenCalled();
  });

  test("completes zero-current cleanup and deactivation for duplicate full withdrawals", async () => {
    const position = createPosition();
    Object.assign(position, {
      currentAmountRaw: BigInt(0),
      principalAmountRaw: BigInt(0),
      status: "closed",
    });
    const insertCalls: Array<{ index: number; values: unknown }> = [];
    const updateCalls: Array<{ index: number; set: unknown }> = [];
    const batchCalls: unknown[][] = [];
    let insertIndex = 0;
    let updateIndex = 0;

    function createBuilder<T extends Record<string, unknown>>(builder: T) {
      return {
        ...builder,
        from: () => createBuilder(builder),
        limit: () => createBuilder(builder),
        orderBy: () => createBuilder(builder),
        where: () => createBuilder(builder),
      };
    }

    const dependencies = {
      client: {
        db: {
          batch: mock(async (items: unknown[]) => {
            batchCalls.push(items);
            return [];
          }),
          insert: mock(() => {
            const index = insertIndex++;
            return {
              values: (values: unknown) => {
                insertCalls.push({ index, values });
                return {
                  returning: async () =>
                    index === 0 ? [{ id: BigInt(99) }] : [],
                };
              },
            };
          }),
          query: {
            managedVaults: {
              findFirst: mock(async () => ({
                active: true,
                activePolicyId: BigInt(7),
                id: BigInt(44),
                settings: "settings",
                setupPolicyId: BigInt(8),
                vaultIndex: 1,
                vaultPubkey: "vault",
              })),
            },
            userYieldPositionWithdrawals: {
              findFirst: mock(async () => createPersistedWithdrawal()),
            },
            userYieldPositions: {
              findFirst: mock(async () => position),
            },
          },
          select: mock(() =>
            createBuilder({
              then: (
                onFulfilled?: (value: unknown[]) => unknown,
                onRejected?: (reason: unknown) => unknown
              ) =>
                Promise.resolve([
                  {
                    amountRaw: BigInt(1000),
                    borrowApyBps: null,
                    hasValue: true,
                    liquidityMint: "usdc",
                    market: "market",
                    observedAt: new Date("2026-06-01T00:01:00.000Z"),
                    observedSlot: BigInt(400),
                    planningMetadata: { rank: 1 },
                    reserve: "reserve",
                    snapshotId: BigInt(20),
                    supplyApyBps: BigInt(123),
                    vaultId: BigInt(44),
                  },
                ]).then(onFulfilled, onRejected),
            })
          ),
          update: mock(() => {
            const index = updateIndex++;
            return {
              set: (set: unknown) => {
                updateCalls.push({ index, set });
                return {
                  where: () => ({}),
                };
              },
            };
          }),
        },
      },
      now: () => new Date("2026-06-02T00:00:00.000Z"),
    };

    const result = await recordConfirmedYieldWithdrawal(
      createWithdrawalInput(),
      dependencies as never
    );

    expect(result).toBe(position);
    expect(batchCalls).toHaveLength(2);
    expect(insertCalls).toHaveLength(2);
    expect(updateCalls.map((call) => call.set)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amountRaw: BigInt(0),
          hasValue: false,
        }),
        expect.objectContaining({
          active: false,
          lastSeenSignature: "withdrawal-signature",
          lastSeenSlot: BigInt(500),
        }),
      ])
    );
  });

  test("closes reserve-source full withdrawals when no holdings remain", async () => {
    const position = createPosition();
    const reserveRow = {
      amountRaw: BigInt(1000),
      borrowApyBps: null,
      hasValue: true,
      liquidityMint: "usdc",
      market: "market",
      observedAt: new Date("2026-06-01T00:01:00.000Z"),
      observedSlot: BigInt(300),
      planningMetadata: { rank: 1 },
      reserve: "reserve",
      snapshotId: BigInt(20),
      supplyApyBps: BigInt(123),
      vaultId: BigInt(44),
    };
    const insertedValues: unknown[] = [];
    const updateSets: unknown[] = [];
    const batchCalls: unknown[][] = [];
    const selectResults = [[reserveRow]];
    let insertIndex = 0;
    let selectIndex = 0;

    function createQuery(index: number) {
      const query = {
        from: () => query,
        limit: () => query,
        orderBy: () => query,
        then: (
          onFulfilled?: (value: unknown[]) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) =>
          Promise.resolve(selectResults[index] ?? []).then(
            onFulfilled,
            onRejected
          ),
        where: () => query,
      };
      return query;
    }

    const dependencies = {
      client: {
        db: {
          batch: mock(async (items: unknown[]) => {
            batchCalls.push(items);
            if (items.length === 2 && batchCalls.length === 1) {
              return [[reserveRow], []];
            }
            return [];
          }),
          delete: mock(() => ({
            where: () => ({}),
          })),
          insert: mock(() => {
            const index = insertIndex++;
            return {
              values: (values: unknown) => {
                insertedValues.push(values);
                return {
                  onConflictDoNothing: () => ({
                    returning: async () => [{ id: BigInt(12) }],
                  }),
                  returning: async () => {
                    if (index === 1) {
                      return [
                        createHoldingEvent({
                          amountRaw: BigInt(0),
                          eventType: "withdrawal_full",
                          holdingDeltaRaw: BigInt(-1000),
                          principalDeltaRaw: BigInt(-1000),
                          sourceWithdrawalId: BigInt(12),
                        }),
                      ];
                    }
                    if (index === 2) {
                      return [{ id: BigInt(55) }];
                    }
                    return [];
                  },
                };
              },
            };
          }),
          query: {
            managedVaults: {
              findFirst: mock(async () => ({
                active: true,
                activePolicyId: BigInt(7),
                id: BigInt(44),
                settings: "settings",
                setupPolicyId: BigInt(8),
                vaultIndex: 1,
                vaultPubkey: "vault",
              })),
            },
            userYieldPositionHoldingEvents: {
              findFirst: mock(async () => createHoldingEvent()),
            },
            userYieldPositionWithdrawals: {
              findFirst: mock(async () => null),
            },
            userYieldPositions: {
              findFirst: mock(async () => position),
            },
          },
          select: mock(() => createQuery(selectIndex++)),
          update: mock(() => ({
            set: (set: unknown) => {
              updateSets.push(set);
              return {
                where: () => ({
                  returning: async () => [
                    {
                      ...position,
                      ...(set as Record<string, unknown>),
                    },
                  ],
                }),
              };
            },
          })),
        },
      },
      now: () => new Date("2026-06-02T00:00:00.000Z"),
    };

    const result = await recordConfirmedYieldWithdrawal(
      createWithdrawalInput({
        accountingReserve: "reserve",
        confirmedReserveDebitAmountRaw: BigInt(1000),
        mode: "full",
        reserveWithdrawals: [
          {
            accountingReserve: "reserve",
            collateralAta: "collateral",
            executionMarket: "market",
            executionReserve: "reserve",
            kaminoWithdrawAmountRaw: "1000",
            liquidityMint: "usdc",
            market: "market",
            reserve: "reserve",
            sourceAmountRaw: "1000",
            sourceId: "reserve",
            vaultCollateralAta: "collateral",
          },
        ],
        sourceAmountRaw: BigInt(1000),
        sourceId: "reserve",
        sourceType: "reserve",
      }),
      dependencies as never
    );

    expect(result.status).toBe("closed");
    expect(result.principalAmountRaw).toBe(BigInt(0));
    expect(insertedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amountRaw: BigInt(0),
          eventType: "withdrawal_full",
          principalDeltaRaw: BigInt(-1000),
        }),
      ])
    );
    expect(updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalAmountRaw: BigInt(0),
          status: "closed",
        }),
        expect.objectContaining({
          active: false,
        }),
      ])
    );
  });
});

describe("yield position verification", () => {
  test("counts cross-reserve top-up deposits when checking principal", async () => {
    const latestObservedAt = new Date("2026-06-01T00:01:00.000Z");
    const position = createPosition();
    Object.assign(position, {
      currentAmountRaw: BigInt(500),
      currentMarket: "safe-market",
      currentObservedAt: latestObservedAt,
      currentObservedSlot: BigInt(400),
      currentReserve: "safe-reserve",
      lastDepositSignature: "top-up-signature",
      lastHoldingEventId: BigInt(34),
      principalAmountRaw: BigInt(1500),
    });
    const dependencies = createVerificationDependencies({
      deposits: [{ amountRaw: BigInt(1000) }, { amountRaw: BigInt(500) }],
      holdingEvents: [
        createHoldingEvent(),
        createHoldingEvent({
          amountRaw: BigInt(500),
          eventType: "deposit_top_up",
          holdingDeltaRaw: BigInt(500),
          id: BigInt(34),
          market: "safe-market",
          observedAt: latestObservedAt,
          observedSlot: BigInt(400),
          principalDeltaRaw: BigInt(500),
          reserve: "safe-reserve",
          sourceDepositId: BigInt(12),
        }),
      ],
      positions: [position],
    });

    await expect(
      verifyUserYieldPositions(dependencies as never)
    ).resolves.toEqual([]);
  });

  test("verifies current holding from last holding pointer, not latest projected history", async () => {
    const currentObservedAt = new Date("2026-06-01T00:01:00.000Z");
    const projectedObservedAt = new Date("2026-06-01T00:02:00.000Z");
    const position = createPosition();
    Object.assign(position, {
      currentAmountRaw: BigInt(500),
      currentMarket: "safe-market",
      currentObservedAt,
      currentObservedSlot: BigInt(400),
      currentReserve: "safe-reserve",
      lastHoldingEventId: BigInt(34),
      principalAmountRaw: BigInt(1500),
    });
    const dependencies = createVerificationDependencies({
      deposits: [{ amountRaw: BigInt(1000) }, { amountRaw: BigInt(500) }],
      holdingEvents: [
        createHoldingEvent(),
        createHoldingEvent({
          amountRaw: BigInt(500),
          eventType: "deposit_top_up",
          holdingDeltaRaw: BigInt(500),
          id: BigInt(34),
          market: "safe-market",
          observedAt: currentObservedAt,
          observedSlot: BigInt(400),
          principalDeltaRaw: BigInt(500),
          reserve: "safe-reserve",
          sourceDepositId: BigInt(12),
        }),
        createHoldingEvent({
          amountRaw: BigInt(490),
          eventType: "snapshot_reconciled",
          holdingDeltaRaw: null,
          id: BigInt(35),
          market: "projected-market",
          observedAt: projectedObservedAt,
          observedSlot: BigInt(410),
          principalDeltaRaw: -BigInt(999),
          reserve: "projected-reserve",
          sourceDepositId: null,
          sourceSnapshotId: BigInt(88),
        }),
      ],
      positions: [position],
    });

    await expect(
      verifyUserYieldPositions(dependencies as never)
    ).resolves.toEqual([]);
  });

  test("treats linked full withdrawals as principal reset even with partial event type", async () => {
    const fullWithdrawalAt = new Date("2026-06-01T00:01:00.000Z");
    const position = createPosition();
    Object.assign(position, {
      currentAmountRaw: BigInt(0),
      currentObservedAt: fullWithdrawalAt,
      currentObservedSlot: BigInt(400),
      lastHoldingEventId: BigInt(34),
      principalAmountRaw: BigInt(0),
    });
    const dependencies = createVerificationDependencies({
      deposits: [{ amountRaw: BigInt(1000) }],
      holdingEvents: [
        createHoldingEvent(),
        createHoldingEvent({
          amountRaw: BigInt(0),
          eventType: "withdrawal_partial",
          holdingDeltaRaw: -BigInt(1000),
          id: BigInt(34),
          observedAt: fullWithdrawalAt,
          observedSlot: BigInt(400),
          principalDeltaRaw: -BigInt(1000),
          sourceDepositId: null,
          sourceWithdrawalId: BigInt(12),
        }),
      ],
      positions: [position],
      withdrawals: [
        {
          id: BigInt(12),
          mode: "full",
          sourceType: "reserve",
          withdrawnAmountRaw: BigInt(1000),
        },
      ],
    });

    await expect(
      verifyUserYieldPositions(dependencies as never)
    ).resolves.toEqual([]);
  });
});
