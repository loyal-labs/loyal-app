import { describe, expect, mock, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

mock.module("server-only", () => ({}));

function createRecord(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    amountPerPeriodRaw: BigInt(100_000_000),
    authority: "wallet",
    balanceSweepPolicyId: BigInt(7),
    closeSignature: null,
    closeSlot: null,
    closedAt: null,
    delegatedSigners: ["delegate"],
    firstSeenAt: new Date("2026-06-01T00:00:00.000Z"),
    id: BigInt(11),
    lastSeenAt: new Date("2026-06-01T00:00:00.000Z"),
    lastSeenSignature: "signature",
    lastSeenSlot: BigInt(123),
    lifecycleStatus: "active",
    liquidityMint: "mint",
    maxAmountPerPeriod: BigInt(100_000_000),
    periodLengthSeconds: BigInt(2_592_000),
    policyAccount: "policy",
    policySeed: BigInt(1),
    policyType: "subscription_sweep",
    recurringDelegation: "recurring",
    settings: "settings",
    startTimestamp: BigInt(1_780_185_600),
    subscriptionAuthority: "subscription-authority",
    subscriptionDelegatee: "subscription-delegatee",
    threshold: 1,
    vaultIndex: 1,
    vaultPubkey: "vault",
    vaultUsdcAta: "vault-ata",
    wallet: "wallet",
    walletBalanceFloorRaw: BigInt(500_000_000),
    walletUsdcAta: "wallet-ata",
    ...overrides,
  };
}

function createClient(rows: unknown[]) {
  const calls: string[] = [];
  const query = {
    from() {
      calls.push("from");
      return query;
    },
    innerJoin() {
      calls.push("innerJoin");
      return query;
    },
    limit() {
      calls.push("limit");
      return rows;
    },
    orderBy() {
      calls.push("orderBy");
      return query;
    },
    where() {
      calls.push("where");
      return query;
    },
  };

  return {
    calls,
    client: {
      db: {
        select() {
          calls.push("select");
          return query;
        },
      },
    },
  };
}

function createMutationClient({
  existing,
  updated,
}: {
  existing: unknown | null;
  updated?: unknown;
}) {
  const calls: string[] = [];
  const dialect = new PgDialect();
  const executeSql: string[] = [];
  let updateSet: Record<string, unknown> | null = null;
  const selectQuery = {
    from() {
      calls.push("select.from");
      return selectQuery;
    },
    limit() {
      calls.push("select.limit");
      return existing ? [existing] : [];
    },
    where() {
      calls.push("select.where");
      return selectQuery;
    },
  };
  const updateQuery = {
    returning() {
      calls.push("update.returning");
      return updated ? [updated] : [];
    },
    set(values: Record<string, unknown>) {
      calls.push("update.set");
      updateSet = values;
      return updateQuery;
    },
    where() {
      calls.push("update.where");
      return updateQuery;
    },
  };

  return {
    calls,
    getExecuteSql: () => executeSql,
    getUpdateSet: () => updateSet,
    client: {
      db: {
        execute(query: SQL) {
          calls.push("execute");
          executeSql.push(dialect.sqlToQuery(query).sql);
          return {};
        },
        select() {
          calls.push("select");
          return selectQuery;
        },
        update() {
          calls.push("update");
          return updateQuery;
        },
      },
    },
  };
}

function createFloorUpdateClient({
  existing,
  row,
}: {
  existing: unknown | null;
  row: Record<string, unknown>;
}) {
  const calls: string[] = [];
  const dialect = new PgDialect();
  const executeSql: string[] = [];
  const selectQuery = {
    from() {
      calls.push("select.from");
      return selectQuery;
    },
    limit() {
      calls.push("select.limit");
      return existing ? [existing] : [];
    },
    where() {
      calls.push("select.where");
      return selectQuery;
    },
  };

  return {
    calls,
    client: {
      db: {
        execute(query: SQL) {
          calls.push("execute");
          executeSql.push(dialect.sqlToQuery(query).sql);
          return { rows: [row] };
        },
        select() {
          calls.push("select");
          return selectQuery;
        },
      },
    },
    getExecuteSql: () => executeSql,
  };
}

function createBootstrapClient({
  existingProjection = [],
  insertedLot,
}: {
  existingProjection?: unknown[];
  insertedLot?: unknown;
}) {
  const insertValues: Record<string, unknown>[] = [];
  const selectQuery = {
    from() {
      return selectQuery;
    },
    limit() {
      return existingProjection;
    },
    where() {
      return selectQuery;
    },
  };
  const insertQuery = {
    onConflictDoNothing() {
      return insertQuery;
    },
    onConflictDoUpdate() {
      return insertQuery;
    },
    returning() {
      if (insertValues.length === 1) {
        return [insertValues[0]];
      }
      if (insertValues.length === 3 && insertedLot) {
        return [insertedLot];
      }
      return [];
    },
    values(values: Record<string, unknown>) {
      insertValues.push(values);
      return insertQuery;
    },
  };

  return {
    client: {
      db: {
        insert() {
          return insertQuery;
        },
        select() {
          return selectQuery;
        },
      },
    },
    getInsertValues: () => insertValues,
  };
}

function createSetupInput(overrides: Record<string, unknown> = {}) {
  return {
    amountPerPeriodRaw: BigInt(100_000_000),
    cluster: "mainnet-beta",
    confirmedSlot: BigInt(200),
    delegatedSigner: "delegate",
    liquidityMint: "mint",
    periodLengthSeconds: BigInt(2_592_000),
    policyAccount: "policy",
    policyId: BigInt(1),
    policySeed: BigInt(1),
    recurringDelegation: "recurring",
    setupSignature: "setup-signature",
    setupStage: "create_recurring_delegation",
    settings: "settings",
    startTimestamp: BigInt(1_780_185_600),
    subscriptionAuthority: "subscription-authority",
    subscriptionAuthorityInitialization: "exists",
    subscriptionDelegatee: "subscription-delegatee",
    vaultIndex: 1,
    vaultPubkey: "vault",
    vaultUsdcAta: "vault-ata",
    walletAddress: "wallet",
    walletBalanceFloorRaw: BigInt(500_000_000),
    walletUsdcAta: "wallet-ata",
    ...overrides,
  };
}

function createFloorRebaselineRow(overrides: Record<string, unknown> = {}) {
  return {
    lotClassification: "floor_rebaseline",
    lotConfidence: "confirmed_projection",
    lotEligibleAfter: new Date("2026-06-16T01:00:00.000Z"),
    lotId: BigInt(51),
    lotOriginalAmountRaw: BigInt(600_000_000),
    lotReason: "Autodeposit floor update rebaseline",
    lotRemainingAmountRaw: BigInt(600_000_000),
    lotStatus: "open",
    projectionAmountRaw: BigInt(1_000_000_000),
    skippedReason: null,
    ...overrides,
  };
}

describe("Earn autodeposit load state", () => {
  test("active policy and active target load as active", async () => {
    const { findCurrentEarnAutodepositState } = await import(
      "./earn-autodeposit-repository.server"
    );
    const policy = createRecord({ id: BigInt(7) });
    const target = createRecord({
      active: true,
      balanceSweepPolicyId: BigInt(7),
      lifecycleStatus: "active",
    });
    const { calls, client } = createClient([{ policy, target }]);

    const state = await findCurrentEarnAutodepositState(
      {
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
      },
      { client } as never
    );

    expect(calls).toEqual([
      "select",
      "from",
      "innerJoin",
      "where",
      "orderBy",
      "limit",
    ]);
    expect(state?.status).toBe("active");
    expect(state?.target.recurringDelegation).toBe("recurring");
  });

  test("active policy and pending target load as pending", async () => {
    const { findCurrentEarnAutodepositState } = await import(
      "./earn-autodeposit-repository.server"
    );
    const policy = createRecord({ id: BigInt(7) });
    const target = createRecord({
      active: false,
      balanceSweepPolicyId: BigInt(7),
      lifecycleStatus: "pending_delegation",
      recurringDelegation: null,
    });
    const { client } = createClient([{ policy, target }]);

    const state = await findCurrentEarnAutodepositState(
      {
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
      },
      { client } as never
    );

    expect(state?.status).toBe("pending");
    expect(state?.target.recurringDelegation).toBeNull();
  });

  test("active policy and paused target load as paused", async () => {
    const { findCurrentEarnAutodepositState } = await import(
      "./earn-autodeposit-repository.server"
    );
    const policy = createRecord({ id: BigInt(7) });
    const target = createRecord({
      active: false,
      balanceSweepPolicyId: BigInt(7),
      lifecycleStatus: "active",
      recurringDelegation: "recurring",
    });
    const { client } = createClient([{ policy, target }]);

    const state = await findCurrentEarnAutodepositState(
      {
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
      },
      { client } as never
    );

    expect(state?.status).toBe("paused");
    expect(state?.target.active).toBe(false);
    expect(state?.target.lifecycleStatus).toBe("active");
    expect(state?.target.recurringDelegation).toBe("recurring");
  });

  test("closed policy and target are not loaded", async () => {
    const { findCurrentEarnAutodepositState } = await import(
      "./earn-autodeposit-repository.server"
    );
    const { client } = createClient([]);

    const state = await findCurrentEarnAutodepositState(
      {
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
      },
      { client } as never
    );

    expect(state).toBeNull();
  });

  test("earn-state serializes active autodeposit metadata", async () => {
    const { serializeAutodepositState } = await import(
      "@/lib/yield-optimization/earn-state-serializers.server"
    );
    const policy = createRecord({ id: BigInt(7) });
    const target = createRecord({
      active: true,
      balanceSweepPolicyId: BigInt(7),
      lifecycleStatus: "active",
    });

    expect(
      serializeAutodepositState({
        depositedThisPeriodRaw: BigInt(65_520_000),
        policy,
        scheduledSweeps: [
          {
            classification: "simple_inbound",
            confidence: "observed",
            eligibleAfter: new Date("2026-06-15T18:06:00.000Z"),
            id: BigInt(41),
            originalAmountRaw: BigInt(334_480_000),
            reason: "incoming USDC",
            remainingAmountRaw: BigInt(334_480_000),
            status: "open",
          },
        ],
        status: "active",
        target,
      } as never)
    ).toMatchObject({
      active: true,
      amountPerPeriodRaw: "100000000",
      balanceSweepPolicyId: "7",
      depositedThisPeriodRaw: "65520000",
      policyAccount: "policy",
      recurringDelegation: "recurring",
      scheduledSweeps: [
        {
          classification: "simple_inbound",
          confidence: "observed",
          eligibleAfter: "2026-06-15T18:06:00.000Z",
          id: "41",
          originalAmountRaw: "334480000",
          reason: "incoming USDC",
          remainingAmountRaw: "334480000",
          status: "open",
        },
      ],
      status: "active",
      startTimestamp: "1780185600",
      walletBalanceFloorRaw: "500000000",
    });
  });

  test("earn-state serializes active policy signature metadata", async () => {
    const { serializeRoutePolicyState } = await import(
      "@/lib/yield-optimization/earn-state-serializers.server"
    );

    expect(
      serializeRoutePolicyState(
        createRecord({
          id: BigInt(7),
          lastSeenSignature: "policy-signature",
          lastSeenSlot: BigInt(456),
          policySeed: BigInt(3),
        }) as never
      )
    ).toMatchObject({
      account: "policy",
      id: "7",
      lastSeenSignature: "policy-signature",
      lastSeenSlot: "456",
      seed: "3",
      vaultIndex: 1,
      vaultPubkey: "vault",
    });
  });

  test("earn-state serializes pending autodeposit metadata", async () => {
    const { serializeAutodepositState } = await import(
      "@/lib/yield-optimization/earn-state-serializers.server"
    );
    const policy = createRecord({ id: BigInt(7) });
    const target = createRecord({
      active: false,
      balanceSweepPolicyId: BigInt(7),
      lifecycleStatus: "pending_delegation",
      recurringDelegation: null,
    });

    expect(
      serializeAutodepositState({
        depositedThisPeriodRaw: BigInt(0),
        policy,
        status: "pending",
        target,
      } as never)
    ).toMatchObject({
      active: false,
      policyAccount: "policy",
      recurringDelegation: null,
      status: "pending",
    });
  });

  test("earn-state serializes paused autodeposit metadata", async () => {
    const { serializeAutodepositState } = await import(
      "@/lib/yield-optimization/earn-state-serializers.server"
    );
    const policy = createRecord({ id: BigInt(7) });
    const target = createRecord({
      active: false,
      balanceSweepPolicyId: BigInt(7),
      lifecycleStatus: "active",
    });

    expect(
      serializeAutodepositState({
        depositedThisPeriodRaw: BigInt(0),
        policy,
        status: "paused",
        target,
      } as never)
    ).toMatchObject({
      active: false,
      policyAccount: "policy",
      recurringDelegation: "recurring",
      status: "paused",
    });
  });

  test("UI config is derived from loaded autodeposit state after reload", async () => {
    const { earnAutodepositConfigFromLoadedState } = await import(
      "./earn-autodeposit-loaded-state.shared"
    );

    expect(
      earnAutodepositConfigFromLoadedState({
        amountPerPeriodRaw: "100000000",
        depositedThisPeriodRaw: "65520000",
        policyAccount: "policy",
        policySeed: "1",
        periodLengthSeconds: "2592000",
        recurringDelegation: "recurring",
        scheduledSweeps: [
          {
            classification: "simple_inbound",
            confidence: "observed",
            eligibleAfter: "2026-06-15T18:06:00.000Z",
            id: "41",
            originalAmountRaw: "334480000",
            reason: "incoming USDC",
            remainingAmountRaw: "334480000",
            status: "open",
          },
        ],
        startTimestamp: "4102444800",
        status: "active",
        walletBalanceFloorRaw: "500000000",
      })
    ).toEqual({
      amount: "100",
      depositedAmount: "65.52",
      keepAmount: "500",
      nextPeriodLabel: "Jan 01",
      nonce: "1",
      policyAccount: "policy",
      recurringDelegation: "recurring",
      scheduledSweeps: [
        {
          classification: "simple_inbound",
          confidence: "observed",
          eligibleAfter: "2026-06-15T18:06:00.000Z",
          id: "41",
          originalAmountRaw: "334480000",
          reason: "incoming USDC",
          remainingAmountRaw: "334480000",
          status: "open",
        },
      ],
      state: "created",
    });
  });

  test("UI progress scale uses the next milestone at exact boundaries", async () => {
    const { getEarnAutodepositProgressScale } = await import(
      "./earn-autodeposit-loaded-state.shared"
    );

    const initial = getEarnAutodepositProgressScale("0");
    expect(initial).toMatchObject({
      goalAmount: 100,
      goalLabel: "$100.00",
    });
    expect(initial.progress).toBe(0);

    const smallDeposit = getEarnAutodepositProgressScale("3.97");
    expect(smallDeposit).toMatchObject({
      goalAmount: 100,
      goalLabel: "$100.00",
    });
    expect(smallDeposit.progress).toBeCloseTo(0.0397);

    const nearlyFirstGoal = getEarnAutodepositProgressScale("99.99");
    expect(nearlyFirstGoal).toMatchObject({
      goalAmount: 100,
      goalLabel: "$100.00",
    });
    expect(nearlyFirstGoal.progress).toBeCloseTo(0.9999);

    const firstBoundary = getEarnAutodepositProgressScale("100");
    expect(firstBoundary).toMatchObject({
      goalAmount: 500,
      goalLabel: "$500.00",
    });
    expect(firstBoundary.progress).toBeCloseTo(0.2);

    const secondBoundary = getEarnAutodepositProgressScale("500");
    expect(secondBoundary).toMatchObject({
      goalAmount: 1_000,
      goalLabel: "$1,000.00",
    });
    expect(secondBoundary.progress).toBeCloseTo(0.5);

    const thirdBoundary = getEarnAutodepositProgressScale("1,000");
    expect(thirdBoundary).toMatchObject({
      goalAmount: 5_000,
      goalLabel: "$5,000.00",
    });
    expect(thirdBoundary.progress).toBeCloseTo(0.2);

    const fourthBoundary = getEarnAutodepositProgressScale("5,000");
    expect(fourthBoundary).toMatchObject({
      goalAmount: 10_000,
      goalLabel: "$10,000.00",
    });
    expect(fourthBoundary.progress).toBeCloseTo(0.5);

    const fifthBoundary = getEarnAutodepositProgressScale("10,000");
    expect(fifthBoundary).toMatchObject({
      goalAmount: 15_000,
      goalLabel: "$15,000.00",
    });
    expect(fifthBoundary.progress).toBeCloseTo(10_000 / 15_000);
  });

  test("UI progress scale continues in strict five thousand dollar steps", async () => {
    const { getEarnAutodepositProgressScale } = await import(
      "./earn-autodeposit-loaded-state.shared"
    );

    const aboveTenThousand = getEarnAutodepositProgressScale("12,345");
    expect(aboveTenThousand).toMatchObject({
      goalAmount: 15_000,
      goalLabel: "$15,000.00",
    });
    expect(aboveTenThousand.progress).toBeCloseTo(12_345 / 15_000);

    const fiveThousandBoundary = getEarnAutodepositProgressScale("15,000");
    expect(fiveThousandBoundary).toMatchObject({
      goalAmount: 20_000,
      goalLabel: "$20,000.00",
    });
    expect(fiveThousandBoundary.progress).toBeCloseTo(0.75);
  });

  test("paused UI config remains configured after reload", async () => {
    const { earnAutodepositConfigFromLoadedState } = await import(
      "./earn-autodeposit-loaded-state.shared"
    );

    expect(
      earnAutodepositConfigFromLoadedState({
        amountPerPeriodRaw: "100000000",
        policyAccount: "policy",
        policySeed: "1",
        periodLengthSeconds: "2592000",
        recurringDelegation: "recurring",
        startTimestamp: "4102444800",
        status: "paused",
        walletBalanceFloorRaw: "500000000",
      })
    ).toMatchObject({
      amount: "100",
      keepAmount: "500",
      policyAccount: "policy",
      recurringDelegation: "recurring",
      state: "paused",
    });
  });

  test("current period start derives from elapsed periods", async () => {
    const { resolveEarnAutodepositCurrentPeriodStart } = await import(
      "./earn-autodeposit-repository.server"
    );
    const startSeconds = 1_780_185_600;
    const periodSeconds = 2_592_000;
    const target = {
      periodLengthSeconds: BigInt(periodSeconds),
      startTimestamp: BigInt(startSeconds),
    };

    const midSecondPeriod = new Date(
      (startSeconds + periodSeconds + 1_000) * 1_000
    );
    expect(
      resolveEarnAutodepositCurrentPeriodStart(target, midSecondPeriod)
    ).toEqual(new Date((startSeconds + periodSeconds) * 1_000));

    const beforeStart = new Date((startSeconds - 1_000) * 1_000);
    expect(
      resolveEarnAutodepositCurrentPeriodStart(target, beforeStart)
    ).toEqual(new Date(startSeconds * 1_000));

    expect(
      resolveEarnAutodepositCurrentPeriodStart(
        { periodLengthSeconds: null, startTimestamp: BigInt(startSeconds) },
        midSecondPeriod
      )
    ).toEqual(new Date(startSeconds * 1_000));

    expect(
      resolveEarnAutodepositCurrentPeriodStart(
        { periodLengthSeconds: BigInt(periodSeconds), startTimestamp: null },
        midSecondPeriod
      )
    ).toBeNull();
  });

  test("current period deposits sum coerces totals to bigint", async () => {
    const { sumEarnAutodepositCurrentPeriodDeposits } = await import(
      "./earn-autodeposit-repository.server"
    );

    function createSumClient(rows: unknown[]) {
      const calls: string[] = [];
      const query = {
        from() {
          calls.push("from");
          return query;
        },
        where() {
          calls.push("where");
          return rows;
        },
      };
      return {
        calls,
        client: {
          db: {
            select() {
              calls.push("select");
              return query;
            },
          },
        },
      };
    }

    const target = {
      id: BigInt(11),
      periodLengthSeconds: BigInt(2_592_000),
      startTimestamp: BigInt(1_780_185_600),
    };
    const now = () => new Date("2026-06-11T00:00:00.000Z");

    const { calls, client } = createSumClient([{ totalRaw: "65520000" }]);
    await expect(
      sumEarnAutodepositCurrentPeriodDeposits(target, { client, now } as never)
    ).resolves.toBe(BigInt(65_520_000));
    expect(calls).toEqual(["select", "from", "where"]);

    const empty = createSumClient([{ totalRaw: null }]);
    await expect(
      sumEarnAutodepositCurrentPeriodDeposits(target, {
        client: empty.client,
        now,
      } as never)
    ).resolves.toBe(BigInt(0));
  });

  test("lower floor update suppresses open lots and schedules one rebaseline surplus", async () => {
    const { updateAutodepositWalletBalanceFloor } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      policyAccount: "policy",
      recurringDelegation: "recurring",
      walletBalanceFloorRaw: BigInt(500_000_000),
    });
    const row = createFloorRebaselineRow({
      lotOriginalAmountRaw: BigInt(600_000_000),
      lotRemainingAmountRaw: BigInt(600_000_000),
      projectionAmountRaw: BigInt(1_000_000_000),
    });
    const { calls, client, getExecuteSql } = createFloorUpdateClient({
      existing,
      row,
    });

    const result = await updateAutodepositWalletBalanceFloor(
      {
        policyAccount: "policy",
        recurringDelegation: "recurring",
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
        walletBalanceFloorRaw: BigInt(400_000_000),
      },
      {
        client,
        now: () => new Date("2026-06-16T00:00:00.000Z"),
      } as never
    );

    expect(calls).toEqual([
      "select",
      "select.from",
      "select.where",
      "select.limit",
      "execute",
    ]);
    expect(result.target.walletBalanceFloorRaw).toBe(BigInt(400_000_000));
    expect(result.rebaselineSweep).toEqual({
      status: "scheduled",
      sweep: {
        classification: "floor_rebaseline",
        confidence: "confirmed_projection",
        eligibleAfter: new Date("2026-06-16T01:00:00.000Z"),
        id: BigInt(51),
        originalAmountRaw: BigInt(600_000_000),
        reason: "Autodeposit floor update rebaseline",
        remainingAmountRaw: BigInt(600_000_000),
        status: "open",
      },
    });
    expect(getExecuteSql()[0]).toContain("FOR UPDATE");
    expect(getExecuteSql()[0]).toContain("status\" = 'open'");
    expect(getExecuteSql()[0]).toContain("classification");
    expect(getExecuteSql()[0]).toContain("floor_rebaseline");
  });

  test("higher floor update schedules only surplus above the new floor", async () => {
    const { updateAutodepositWalletBalanceFloor } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      policyAccount: "policy",
      recurringDelegation: "recurring",
      walletBalanceFloorRaw: BigInt(500_000_000),
    });
    const { client } = createFloorUpdateClient({
      existing,
      row: createFloorRebaselineRow({
        lotOriginalAmountRaw: BigInt(200_000_000),
        lotRemainingAmountRaw: BigInt(200_000_000),
        projectionAmountRaw: BigInt(1_000_000_000),
      }),
    });

    const result = await updateAutodepositWalletBalanceFloor(
      {
        policyAccount: "policy",
        recurringDelegation: "recurring",
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
        walletBalanceFloorRaw: BigInt(800_000_000),
      },
      {
        client,
        now: () => new Date("2026-06-16T00:00:00.000Z"),
      } as never
    );

    expect(result.rebaselineSweep).toMatchObject({
      status: "scheduled",
      sweep: {
        originalAmountRaw: BigInt(200_000_000),
        remainingAmountRaw: BigInt(200_000_000),
      },
    });
  });

  test("floor update skips rebaseline when projection is at or below floor", async () => {
    const { updateAutodepositWalletBalanceFloor } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const { client } = createFloorUpdateClient({
      existing,
      row: createFloorRebaselineRow({
        lotId: null,
        projectionAmountRaw: BigInt(500_000_000),
        skippedReason: "wallet_balance_at_or_below_floor",
      }),
    });

    const result = await updateAutodepositWalletBalanceFloor(
      {
        policyAccount: "policy",
        recurringDelegation: "recurring",
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
        walletBalanceFloorRaw: BigInt(500_000_000),
      },
      { client } as never
    );

    expect(result.rebaselineSweep).toEqual({
      reason: "wallet_balance_at_or_below_floor",
      status: "skipped",
    });
  });

  test("floor update skips rebaseline when projection is missing", async () => {
    const { updateAutodepositWalletBalanceFloor } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const { client } = createFloorUpdateClient({
      existing,
      row: createFloorRebaselineRow({
        lotId: null,
        projectionAmountRaw: null,
        skippedReason: "wallet_balance_projection_missing",
      }),
    });

    const result = await updateAutodepositWalletBalanceFloor(
      {
        policyAccount: "policy",
        recurringDelegation: "recurring",
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
        walletBalanceFloorRaw: BigInt(500_000_000),
      },
      { client } as never
    );

    expect(result.rebaselineSweep).toEqual({
      reason: "wallet_balance_projection_missing",
      status: "skipped",
    });
  });

  test("floor rebaseline preserves selected claims already in execution", async () => {
    const { updateAutodepositWalletBalanceFloor } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const { client, getExecuteSql } = createFloorUpdateClient({
      existing,
      row: createFloorRebaselineRow(),
    });

    await updateAutodepositWalletBalanceFloor(
      {
        policyAccount: "policy",
        recurringDelegation: "recurring",
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
        walletBalanceFloorRaw: BigInt(400_000_000),
      },
      { client } as never
    );

    const sqlText = getExecuteSql()[0] ?? "";
    expect(sqlText).toContain("status\" = 'open'");
    expect(sqlText).not.toContain("balance_sweep_lot_claims");
    expect(sqlText).not.toContain("'released'");
  });

  test("pause updates only the target active flag", async () => {
    const { updateAutodepositTargetActive } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      active: true,
      lifecycleStatus: "active",
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const updated = { ...existing, active: false };
    const { calls, client, getUpdateSet } = createMutationClient({
      existing,
      updated,
    });

    const target = await updateAutodepositTargetActive(
      {
        active: false,
        policyAccount: "policy",
        recurringDelegation: "recurring",
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
      },
      { client } as never
    );

    expect(target).toMatchObject({
      active: false,
      lifecycleStatus: "active",
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    expect(getUpdateSet()).toEqual({ active: false });
    expect(calls).toEqual([
      "select",
      "select.from",
      "select.where",
      "select.limit",
      "update",
      "update.set",
      "update.where",
      "update.returning",
    ]);
  });

  test("resume reactivates the same target", async () => {
    const { updateAutodepositTargetActive } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      active: false,
      lifecycleStatus: "active",
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const updated = { ...existing, active: true };
    const { client, getUpdateSet } = createMutationClient({
      existing,
      updated,
    });

    const target = await updateAutodepositTargetActive(
      {
        active: true,
        policyAccount: "policy",
        recurringDelegation: "recurring",
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
      },
      { client } as never
    );

    expect(target).toMatchObject({
      active: true,
      id: BigInt(11),
      lifecycleStatus: "active",
      policyAccount: "policy",
    });
    expect(getUpdateSet()).toEqual({ active: true });
  });

  test("closed targets cannot be toggled", async () => {
    const { updateAutodepositTargetActive } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      active: false,
      lifecycleStatus: "closed",
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const { calls, client } = createMutationClient({ existing });

    await expect(
      updateAutodepositTargetActive(
        {
          active: true,
          policyAccount: "policy",
          recurringDelegation: "recurring",
          settings: "settings",
          vaultIndex: 1,
          walletAddress: "wallet",
        },
        { client } as never
      )
    ).rejects.toThrow("Closed autodeposit targets cannot be toggled.");
    expect(calls).not.toContain("update");
  });

  test("principal mismatch is rejected before toggle update", async () => {
    const { updateAutodepositTargetActive } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      active: true,
      lifecycleStatus: "active",
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const { calls, client } = createMutationClient({ existing });

    await expect(
      updateAutodepositTargetActive(
        {
          active: false,
          policyAccount: "policy",
          recurringDelegation: "recurring",
          settings: "settings",
          vaultIndex: 1,
          walletAddress: "other-wallet",
        },
        { client } as never
      )
    ).rejects.toThrow("Autodeposit target does not match the wallet.");
    expect(calls).not.toContain("update");
  });

  test("newer setup cannot reactivate a closed target for the same policy", async () => {
    const { recordConfirmedAutodepositDelegation } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      active: false,
      closeSlot: BigInt(150),
      lifecycleStatus: "closed",
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const { calls, client } = createMutationClient({ existing });

    await expect(
      recordConfirmedAutodepositDelegation(
        createSetupInput({ confirmedSlot: BigInt(200) }) as never,
        { client, now: () => new Date("2026-06-02T00:00:00.000Z") } as never
      )
    ).rejects.toThrow("Closed autodeposit targets cannot be reactivated.");
    expect(calls).not.toContain("insert");
    expect(calls).not.toContain("update");
  });

  test("older setup confirmation returns an already closed target", async () => {
    const { recordConfirmedAutodepositDelegation } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      active: false,
      closeSlot: BigInt(250),
      lifecycleStatus: "closed",
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const { calls, client } = createMutationClient({ existing });

    const target = await recordConfirmedAutodepositDelegation(
      createSetupInput({ confirmedSlot: BigInt(200) }) as never,
      { client, now: () => new Date("2026-06-02T00:00:00.000Z") } as never
    );

    expect(target).toBe(existing);
    expect(calls).not.toContain("insert");
    expect(calls).not.toContain("update");
  });

  test("closing an autodeposit target cancels scheduled transactions before closing rows", async () => {
    const { recordClosedAutodepositTarget } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      active: true,
      lifecycleStatus: "active",
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const updated = {
      ...existing,
      active: false,
      closeSignature: "withdrawal-signature",
      closeSlot: BigInt(300),
      lifecycleStatus: "closed",
    };
    const { calls, client, getUpdateSet } = createMutationClient({
      existing,
      updated,
    });

    const target = await recordClosedAutodepositTarget(
      {
        cluster: "mainnet-beta",
        closeSignature: "withdrawal-signature",
        confirmedSlot: BigInt(300),
        delegatedSigner: "delegate",
        policyAccount: "policy",
        recurringDelegation: "recurring",
        settings: "settings",
        vaultIndex: 1,
        vaultPubkey: "vault",
        walletAddress: "wallet",
      },
      { client, now: () => new Date("2026-06-02T00:00:00.000Z") } as never
    );

    expect(target).toBe(updated);
    expect(getUpdateSet()).toMatchObject({
      active: false,
      closeSignature: "withdrawal-signature",
      closeSlot: BigInt(300),
      lifecycleStatus: "closed",
      recurringDelegation: "recurring",
    });
    expect(calls).toEqual([
      "select",
      "select.from",
      "select.where",
      "select.limit",
      "execute",
      "update",
      "update.set",
      "update.where",
      "update",
      "update.set",
      "update.where",
      "update.returning",
    ]);
  });

  test("already closed autodeposit targets still cancel stale scheduled transactions idempotently", async () => {
    const { recordClosedAutodepositTarget } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      active: false,
      closeSlot: BigInt(300),
      lifecycleStatus: "closed",
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const { calls, client } = createMutationClient({ existing });

    const target = await recordClosedAutodepositTarget(
      {
        cluster: "mainnet-beta",
        closeSignature: "withdrawal-signature",
        confirmedSlot: BigInt(250),
        delegatedSigner: "delegate",
        policyAccount: "policy",
        recurringDelegation: "recurring",
        settings: "settings",
        vaultIndex: 1,
        vaultPubkey: "vault",
        walletAddress: "wallet",
      },
      { client, now: () => new Date("2026-06-02T00:00:00.000Z") } as never
    );

    expect(target).toBe(existing);
    expect(calls).toEqual([
      "select",
      "select.from",
      "select.where",
      "select.limit",
      "execute",
    ]);
  });

  test("bootstrap setup scheduling inserts an initial surplus lot one hour after observation", async () => {
    const { scheduleBootstrapEarnAutodepositSweep } = await import(
      "./earn-autodeposit-repository.server"
    );
    const observedAt = new Date("2026-06-16T00:00:00.000Z");
    const lot = {
      classification: "initial_surplus" as const,
      confidence: "confirmed_snapshot",
      eligibleAfter: new Date("2026-06-16T01:00:00.000Z"),
      id: BigInt(41),
      originalAmountRaw: BigInt(500_000_000),
      reason: "initial Autodeposit surplus detected at setup confirmation",
      remainingAmountRaw: BigInt(500_000_000),
      status: "open" as const,
    };
    const { client, getInsertValues } = createBootstrapClient({
      existingProjection: [
        {
          amountRaw: BigInt(700_000_000),
        },
      ],
      insertedLot: lot,
    });

    const result = await scheduleBootstrapEarnAutodepositSweep(
      {
        snapshot: {
          accountDataHash: "hash",
          amountRaw: BigInt(1_000_000_000),
          mint: "mint",
          observedAt,
          observedSlot: BigInt(500),
          owner: "wallet",
          rawEvidence: { bootstrap: true },
          source: "app_autodeposit_setup_confirm",
          sourceCommitment: "confirmed",
        },
        target: createRecord({
          id: BigInt(11),
          lastSeenSignature: "setup-signature",
          walletBalanceFloorRaw: BigInt(500_000_000),
        }) as never,
      },
      {
        client,
        now: () => new Date("2026-06-16T00:05:00.000Z"),
      } as never
    );

    expect(result).toEqual({ status: "scheduled", sweep: lot });
    const [, eventValues, lotValues] = getInsertValues();
    expect(eventValues).toMatchObject({
      amountRaw: BigInt(1_000_000_000),
      deltaAmountRaw: BigInt(300_000_000),
      eventId: BigInt(-11),
      observedAt,
      observedSlot: BigInt(500),
      previousAmountRaw: BigInt(700_000_000),
      source: "app_autodeposit_setup_confirm",
      sourceCommitment: "confirmed",
      targetId: BigInt(11),
    });
    expect(lotValues).toMatchObject({
      classification: "initial_surplus",
      eligibleAfter: new Date("2026-06-16T01:00:00.000Z"),
      originalAmountRaw: BigInt(500_000_000),
      remainingAmountRaw: BigInt(500_000_000),
      sourceEventId: BigInt(-11),
      status: "open",
      targetId: BigInt(11),
    });
  });

  test("bootstrap setup scheduling skips at-or-below-floor balances after projection upsert", async () => {
    const { scheduleBootstrapEarnAutodepositSweep } = await import(
      "./earn-autodeposit-repository.server"
    );
    const { client, getInsertValues } = createBootstrapClient({});

    const result = await scheduleBootstrapEarnAutodepositSweep(
      {
        snapshot: {
          accountDataHash: "hash",
          amountRaw: BigInt(500_000_000),
          mint: "mint",
          observedAt: new Date("2026-06-16T00:00:00.000Z"),
          observedSlot: BigInt(500),
          owner: "wallet",
          source: "app_autodeposit_setup_confirm",
          sourceCommitment: "confirmed",
        },
        target: createRecord({
          id: BigInt(11),
          walletBalanceFloorRaw: BigInt(500_000_000),
        }) as never,
      },
      {
        client,
        now: () => new Date("2026-06-16T00:05:00.000Z"),
      } as never
    );

    expect(result).toEqual({
      reason: "wallet_balance_at_or_below_floor",
      status: "skipped",
    });
    expect(getInsertValues()).toHaveLength(1);
    expect(getInsertValues()[0]).toMatchObject({
      amountRaw: BigInt(500_000_000),
      targetId: BigInt(11),
    });
  });

  test("scheduled cancellation is scoped through observed source slots", async () => {
    const { cancelScheduledAutodepositTransactionsForClose } = await import(
      "./earn-autodeposit-repository.server"
    );
    const { calls, client, getExecuteSql } = createMutationClient({
      existing: null,
    });

    await cancelScheduledAutodepositTransactionsForClose({
      client: client as never,
      now: new Date("2026-06-02T00:00:00.000Z"),
      targetId: BigInt(11),
    });

    expect(calls).toEqual(["execute"]);
    const [query] = getExecuteSql();

    expect(query).toContain("WITH scheduled_slots AS");
    expect(query).toContain(
      '"loyal_yield"."balance_sweep_wallet_balance_events"'
    );
    expect(query).toContain("event.observed_slot");
    expect(query).toContain("scoped_lots AS");
    expect(query).toContain("claim.status = 'selected'");
    expect(query).toContain("status = 'released'");
    expect(query).toContain("status = 'suppressed'");
    expect(query).toContain("SELECT id FROM scoped_lots");
  });

  test("yield schema exposes wallet balance events for slot-scoped cancellation", async () => {
    const { yieldOptimizationSchema } = await import(
      "./yield-neon-client.server"
    );

    expect(
      yieldOptimizationSchema.balanceSweepWalletBalanceEvents
    ).toBeTruthy();
  });
});
