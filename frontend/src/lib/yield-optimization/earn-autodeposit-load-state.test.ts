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
    policyConfirmedSlot: BigInt(123),
    policySeed: BigInt(1),
    policySignature: "policy-signature",
    policyType: "subscription_sweep",
    recurringDelegation: "recurring",
    recurringDelegationConfirmedSlot: BigInt(123),
    settings: "settings",
    recurringDelegationSignature: "delegation-signature",
    startTimestamp: BigInt(1_780_185_600),
    subscriptionAuthority: "subscription-authority",
    subscriptionDelegatee: "subscription-delegatee",
    threshold: 1,
    tokenMint: "mint",
    vaultIndex: 1,
    vaultPubkey: "vault",
    vaultTokenAta: "vault-ata",
    vaultUsdcAta: "vault-ata",
    wallet: "wallet",
    walletBalanceFloorRaw: BigInt(500_000_000),
    walletTokenAta: "wallet-ata",
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
    leftJoin() {
      calls.push("leftJoin");
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
  insertReturnValues = [],
  updated,
}: {
  existing: unknown | null;
  insertReturnValues?: unknown[];
  updated?: unknown;
}) {
  const calls: string[] = [];
  const dialect = new PgDialect();
  const executeSql: string[] = [];
  const insertValues: Record<string, unknown>[] = [];
  const insertConflictSets: Record<string, unknown>[] = [];
  let insertReturnIndex = 0;
  let updateSet: Record<string, unknown> | null = null;
  const updateSets: Record<string, unknown>[] = [];
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
      updateSets.push(values);
      return updateQuery;
    },
    where() {
      calls.push("update.where");
      return updateQuery;
    },
  };
  const insertQuery = {
    onConflictDoUpdate(args: { set: Record<string, unknown> }) {
      calls.push("insert.onConflictDoUpdate");
      insertConflictSets.push(args.set);
      return insertQuery;
    },
    returning() {
      calls.push("insert.returning");
      const returned = insertReturnValues[insertReturnIndex] ?? updated;
      insertReturnIndex += 1;
      return returned ? [returned] : [];
    },
    values(values: Record<string, unknown>) {
      calls.push("insert.values");
      insertValues.push(values);
      return insertQuery;
    },
  };

  return {
    calls,
    getExecuteSql: () => executeSql,
    getInsertConflictSets: () => insertConflictSets,
    getInsertValues: () => insertValues,
    getUpdateSet: () => updateSet,
    getUpdateSets: () => updateSets,
    client: {
      db: {
        execute(query: SQL) {
          calls.push("execute");
          executeSql.push(dialect.sqlToQuery(query).sql);
          return {};
        },
        insert() {
          calls.push("insert");
          return insertQuery;
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
  existingLot = null,
  existingProjection = [],
  insertedLot,
  scheduledSweep,
}: {
  existingLot?: unknown | null;
  existingProjection?: unknown[];
  insertedLot?: unknown;
  scheduledSweep?: Record<string, unknown> | null;
}) {
  const dialect = new PgDialect();
  const executeSql: string[] = [];
  const insertValues: Record<string, unknown>[] = [];
  const slotId = BigInt(42);
  let selectCallCount = 0;
  const selectQuery = {
    from() {
      return selectQuery;
    },
    limit() {
      selectCallCount += 1;
      if (selectCallCount === 1) {
        return existingProjection;
      }
      if (selectCallCount === 2) {
        return existingLot ? [existingLot] : [];
      }
      return [];
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
        execute(query: SQL) {
          executeSql.push(dialect.sqlToQuery(query).sql);
          if (executeSql.length === 1) {
            return { rows: [{ id: slotId }] };
          }
          return { rows: scheduledSweep ? [scheduledSweep] : [] };
        },
        insert() {
          return insertQuery;
        },
        select() {
          return selectQuery;
        },
      },
    },
    getExecuteSql: () => executeSql,
    getInsertValues: () => insertValues,
  };
}

function createImmediateSweepClient(row: Record<string, unknown> | null) {
  const dialect = new PgDialect();
  const executeParams: unknown[][] = [];

  return {
    client: {
      db: {
        execute(query: SQL) {
          const compiled = dialect.sqlToQuery(query);
          executeParams.push(compiled.params);
          return { rows: row ? [row] : [] };
        },
      },
    },
    getExecuteParams: () => executeParams,
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
    lotSlotId: BigInt(52),
    lotStatus: "scheduled",
    projectionAmountRaw: BigInt(1_000_000_000),
    skippedReason: null,
    ...overrides,
  };
}

function createScheduledSweepRecord(overrides: Record<string, unknown> = {}) {
  return {
    classification: "initial_surplus",
    confidence: "confirmed_projection",
    eligibleAfter: new Date("2026-06-16T01:00:00.000Z"),
    id: BigInt(51),
    lotCount: 1,
    originalAmountRaw: BigInt(600_000_000),
    reason: "Autodeposit scheduled sweep",
    remainingAmountRaw: BigInt(600_000_000),
    slotId: BigInt(52),
    status: "scheduled",
    ...overrides,
  };
}

function createLoadedScheduledSweep(overrides: Record<string, unknown> = {}) {
  return {
    classification: "initial_surplus",
    confidence: "confirmed_projection",
    eligibleAfter: "2026-06-16T01:00:00.000Z",
    id: "51",
    lotCount: 1,
    originalAmountRaw: "600000000",
    reason: "Autodeposit scheduled sweep",
    remainingAmountRaw: "600000000",
    slotId: "52",
    status: "scheduled",
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
    const { client } = createClient([{ policy, target }]);

    const state = await findCurrentEarnAutodepositState(
      {
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
      },
      { client } as never
    );

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

  test("delegation-only target loads as pending without a policy row", async () => {
    const { findCurrentEarnAutodepositState } = await import(
      "./earn-autodeposit-repository.server"
    );
    const target = createRecord({
      active: false,
      balanceSweepPolicyId: null,
      lifecycleStatus: "pending_policy",
      policyConfirmedSlot: null,
      policySignature: null,
      recurringDelegationConfirmedSlot: BigInt(200),
      recurringDelegationSignature: "delegation-signature",
    });
    const { client } = createClient([{ policy: null, target }]);

    const state = await findCurrentEarnAutodepositState(
      {
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
      },
      { client } as never
    );

    expect(state?.status).toBe("pending");
    expect(state?.policy).toBeNull();
    expect(state?.target.lifecycleStatus).toBe("pending_policy");
    expect(state?.target.balanceSweepPolicyId).toBeNull();
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

  test("loaded autodeposit config only keeps scheduled sweeps while active", async () => {
    const { earnAutodepositConfigFromLoadedState } = await import(
      "./earn-autodeposit-loaded-state.shared"
    );
    const scheduledSweep = createLoadedScheduledSweep();
    const loaded = {
      amountPerPeriodRaw: "100000000",
      depositedThisPeriodRaw: "0",
      policyAccount: "policy",
      policySeed: "1",
      periodLengthSeconds: "2592000",
      recurringDelegation: "recurring",
      scheduledSweeps: [scheduledSweep],
      startTimestamp: "1780185600",
      walletBalanceFloorRaw: "500000000",
    };

    expect(
      earnAutodepositConfigFromLoadedState({
        ...loaded,
        status: "active",
      })?.scheduledSweeps
    ).toEqual([scheduledSweep]);
    expect(
      earnAutodepositConfigFromLoadedState({
        ...loaded,
        status: "paused",
      })?.scheduledSweeps
    ).toEqual([]);
    expect(
      earnAutodepositConfigFromLoadedState({
        ...loaded,
        status: "pending",
      })?.scheduledSweeps
    ).toEqual([]);
  });

  test("scheduled sweep availability copy counts down until delegation readiness", async () => {
    const {
      formatLoadedScheduledSweepAvailableIn,
      getLoadedScheduledSweepExecuteNowAvailableAtMs,
    } = await import("./earn-autodeposit-loaded-state.shared");
    const availableAtMs = getLoadedScheduledSweepExecuteNowAvailableAtMs(
      createLoadedScheduledSweep({
        executeNowAvailableAt: "2026-06-16T00:00:30.000Z",
      })
    );

    expect(availableAtMs).toBe(
      new Date("2026-06-16T00:00:30.000Z").getTime()
    );
    expect(
      formatLoadedScheduledSweepAvailableIn(
        availableAtMs!,
        new Date("2026-06-16T00:00:01.200Z").getTime()
      )
    ).toBe("Available in 29s");
    expect(
      formatLoadedScheduledSweepAvailableIn(
        availableAtMs!,
        new Date("2026-06-16T00:00:30.000Z").getTime()
      )
    ).toBeNull();
  });

  test("serialized autodeposit state hides scheduled sweeps while paused", async () => {
    const { serializeAutodepositState } = await import(
      "./earn-state-serializers.server"
    );
    const policy = createRecord({ id: BigInt(7) });
    const target = createRecord({
      active: false,
      balanceSweepPolicyId: BigInt(7),
      lifecycleStatus: "active",
      recurringDelegation: "recurring",
    });

    const serialized = serializeAutodepositState({
      depositedThisPeriodRaw: BigInt(0),
      policy,
      scheduledSweeps: [createScheduledSweepRecord()],
      status: "paused",
      target,
    } as never);

    expect(serialized.status).toBe("paused");
    expect(serialized.scheduledSweeps).toEqual([]);
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

    const { client } = createSumClient([{ totalRaw: "65520000" }]);
    await expect(
      sumEarnAutodepositCurrentPeriodDeposits(target, { client, now } as never)
    ).resolves.toBe(BigInt(65_520_000));

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
    const { client, getExecuteSql } = createFloorUpdateClient({
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

    expect(result.target.walletBalanceFloorRaw).toBe(BigInt(400_000_000));
    expect(result.rebaselineSweep).toMatchObject({
      status: "scheduled",
      sweep: {
        classification: "floor_rebaseline",
        originalAmountRaw: BigInt(600_000_000),
        remainingAmountRaw: BigInt(600_000_000),
      },
    });
    expect(getExecuteSql()[0]).toContain("SET wallet_balance_floor_raw = $");
    expect(getExecuteSql()[0]).toContain("status = 'suppressed'");
    expect(getExecuteSql()[0]).toContain(
      "'previousWalletBalanceFloorRaw', $9::text"
    );
    expect(getExecuteSql()[0]).toContain("'walletBalanceFloorRaw', $10::text");
    expect(getExecuteSql()[0]).not.toContain(
      'SET "loyal_yield"."balance_sweep_targets"."wallet_balance_floor_raw"'
    );
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

    expect(result.rebaselineSweep).toMatchObject({
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

    expect(result.rebaselineSweep).toMatchObject({
      reason: "wallet_balance_projection_missing",
      status: "skipped",
    });
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
    const { client, getUpdateSet } = createMutationClient({
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
    const { client } = createMutationClient({ existing });

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
    const { client } = createMutationClient({ existing });

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
  });

  test("missing on-chain policy reconciliation closes policy and target", async () => {
    const { reconcileMissingOnChainEarnAutodepositPolicy } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      active: true,
      lifecycleStatus: "active",
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const closed = createRecord({
      active: false,
      closeSignature: "reconciled_missing_policy:policy",
      lifecycleStatus: "closed",
      policyAccount: "policy",
      recurringDelegation: "recurring",
    });
    const now = new Date("2026-06-18T00:00:00.000Z");
    const { client, getExecuteSql, getUpdateSets } = createMutationClient({
      existing,
      updated: closed,
    });

    const target = await reconcileMissingOnChainEarnAutodepositPolicy(
      {
        policyAccount: "policy",
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
      },
      { client, now: () => now } as never
    );

    expect(target).toMatchObject({
      active: false,
      lifecycleStatus: "closed",
      policyAccount: "policy",
    });
    expect(getExecuteSql()[0]).toContain("WITH scheduled_slots AS");
    expect(getUpdateSets()[0]).toMatchObject({
      active: false,
      closeSignature: "reconciled_missing_policy:policy",
      closedAt: now,
      lastSeenAt: now,
      lastSeenSignature: "reconciled_missing_policy:policy",
    });
    expect(getUpdateSets()[1]).toMatchObject({
      active: false,
      closeSignature: "reconciled_missing_policy:policy",
      closedAt: now,
      lastSeenAt: now,
      lastSeenSignature: "reconciled_missing_policy:policy",
      lifecycleStatus: "closed",
    });
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
    const { client } = createMutationClient({ existing });

    await expect(
      recordConfirmedAutodepositDelegation(
        createSetupInput({ confirmedSlot: BigInt(200) }) as never,
        { client, now: () => new Date("2026-06-02T00:00:00.000Z") } as never
      )
    ).rejects.toThrow("Closed autodeposit targets cannot be reactivated.");
  });

  test("delegation-first confirmation inserts pending_policy without a fake policy row", async () => {
    const { recordConfirmedAutodepositDelegation } = await import(
      "./earn-autodeposit-repository.server"
    );
    const inserted = createRecord({
      active: false,
      balanceSweepPolicyId: null,
      lifecycleStatus: "pending_policy",
      policyConfirmedSlot: null,
      policySignature: null,
      recurringDelegationConfirmedSlot: BigInt(200),
      recurringDelegationSignature: "delegation-signature",
    });
    const { client, getInsertValues } = createMutationClient({
      existing: null,
      insertReturnValues: [inserted],
    });

    const target = await recordConfirmedAutodepositDelegation(
      createSetupInput({
        setupSignature: "delegation-signature",
        setupStage: "create_recurring_delegation",
      }) as never,
      { client, now: () => new Date("2026-06-02T00:00:00.000Z") } as never
    );

    expect(target).toMatchObject({
      active: false,
      balanceSweepPolicyId: null,
      lifecycleStatus: "pending_policy",
      policyConfirmedSlot: null,
      policySignature: null,
      recurringDelegationConfirmedSlot: BigInt(200),
      recurringDelegationSignature: "delegation-signature",
    });
    expect(getInsertValues()[0]).toMatchObject({
      active: false,
      balanceSweepPolicyId: null,
      lifecycleStatus: "pending_policy",
      policyConfirmedSlot: null,
      policySignature: null,
      recurringDelegationConfirmedSlot: BigInt(200),
      recurringDelegationSignature: "delegation-signature",
    });
  });

  test("policy confirmation activates an existing delegation-only target", async () => {
    const { recordPendingAutodepositSetup } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      active: false,
      balanceSweepPolicyId: null,
      lastSeenSignature: "delegation-signature",
      lastSeenSlot: BigInt(199),
      lifecycleStatus: "pending_policy",
      policyConfirmedSlot: null,
      policySignature: null,
      recurringDelegationConfirmedSlot: BigInt(199),
      recurringDelegationSignature: "delegation-signature",
    });
    const updated = {
      ...existing,
      active: true,
      balanceSweepPolicyId: BigInt(7),
      lastSeenSignature: "policy-signature",
      lastSeenSlot: BigInt(200),
      lifecycleStatus: "active",
      policyConfirmedSlot: BigInt(200),
      policySignature: "policy-signature",
    };
    const { client, getUpdateSet } = createMutationClient({
      existing,
      insertReturnValues: [{ id: BigInt(7) }],
      updated,
    });

    const target = await recordPendingAutodepositSetup(
      createSetupInput({
        confirmedSlot: BigInt(200),
        policyId: BigInt(7),
        policySeed: BigInt(7),
        setupSignature: "policy-signature",
        setupStage: "create_policy",
      }) as never,
      { client, now: () => new Date("2026-06-02T00:00:00.000Z") } as never
    );

    expect(target).toMatchObject({
      active: true,
      lifecycleStatus: "active",
      policyConfirmedSlot: BigInt(200),
      policySignature: "policy-signature",
      recurringDelegationConfirmedSlot: BigInt(199),
      recurringDelegationSignature: "delegation-signature",
    });
    expect(getUpdateSet()).toMatchObject({
      active: true,
      balanceSweepPolicyId: BigInt(7),
      lifecycleStatus: "active",
      policyConfirmedSlot: BigInt(200),
      policySignature: "policy-signature",
      recurringDelegationConfirmedSlot: BigInt(199),
      recurringDelegationSignature: "delegation-signature",
    });
  });

  test("duplicate delegation confirmations return the recorded target without downgrading", async () => {
    const { recordConfirmedAutodepositDelegation } = await import(
      "./earn-autodeposit-repository.server"
    );
    const existing = createRecord({
      active: false,
      balanceSweepPolicyId: null,
      lifecycleStatus: "pending_policy",
      policyConfirmedSlot: null,
      policySignature: null,
      recurringDelegationConfirmedSlot: BigInt(250),
      recurringDelegationSignature: "delegation-signature",
    });
    const { calls, client } = createMutationClient({ existing });

    const target = await recordConfirmedAutodepositDelegation(
      createSetupInput({
        confirmedSlot: BigInt(200),
        setupSignature: "older-delegation-signature",
        setupStage: "create_recurring_delegation",
      }) as never,
      { client, now: () => new Date("2026-06-02T00:00:00.000Z") } as never
    );

    expect(target).toBe(existing);
    expect(calls).not.toContain("update");
    expect(calls).not.toContain("insert");
  });

  test("racy target upsert merges policy and delegation confirmation fields", async () => {
    const { recordPendingAutodepositSetup } = await import(
      "./earn-autodeposit-repository.server"
    );
    const inserted = createRecord({
      active: true,
      balanceSweepPolicyId: BigInt(7),
      lifecycleStatus: "active",
      policyConfirmedSlot: BigInt(200),
      policySignature: "policy-signature",
      recurringDelegationConfirmedSlot: BigInt(199),
      recurringDelegationSignature: "delegation-signature",
    });
    const { client, getInsertConflictSets } = createMutationClient({
      existing: null,
      insertReturnValues: [{ id: BigInt(7) }, inserted],
    });

    const target = await recordPendingAutodepositSetup(
      createSetupInput({
        confirmedSlot: BigInt(200),
        setupSignature: "policy-signature",
        setupStage: "create_policy",
      }) as never,
      { client, now: () => new Date("2026-06-02T00:00:00.000Z") } as never
    );

    expect(target).toMatchObject({
      active: true,
      lifecycleStatus: "active",
      recurringDelegationSignature: "delegation-signature",
    });
    const [, targetConflictSet] = getInsertConflictSets();
    expect(targetConflictSet).toMatchObject({
      active: expect.anything(),
      lifecycleStatus: expect.anything(),
      policyConfirmedSlot: BigInt(200),
      policySignature: "policy-signature",
      recurringDelegationConfirmedSlot: expect.anything(),
      recurringDelegationSignature: expect.anything(),
    });
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
    const { client } = createMutationClient({ existing });

    const target = await recordConfirmedAutodepositDelegation(
      createSetupInput({ confirmedSlot: BigInt(200) }) as never,
      { client, now: () => new Date("2026-06-02T00:00:00.000Z") } as never
    );

    expect(target).toBe(existing);
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
    expect(calls.indexOf("execute")).toBeLessThan(calls.lastIndexOf("update"));
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
    expect(calls).toContain("execute");
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
    const scheduledSweep = {
      classification: lot.classification,
      confidence: lot.confidence,
      eligibleAfter: lot.eligibleAfter,
      id: BigInt(42),
      lotCount: BigInt(1),
      originalAmountRaw: lot.originalAmountRaw,
      reason: lot.reason,
      remainingAmountRaw: lot.remainingAmountRaw,
      slotId: BigInt(42),
      status: "scheduled",
    };
    const { client, getInsertValues } = createBootstrapClient({
      existingProjection: [
        {
          amountRaw: BigInt(700_000_000),
        },
      ],
      insertedLot: lot,
      scheduledSweep,
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

    expect(result.status).toBe("scheduled");
    if (result.status !== "scheduled") {
      throw new Error("expected bootstrap sweep to be scheduled");
    }
    expect(result.sweep.originalAmountRaw).toBe(BigInt(500_000_000));
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
      scheduledSlotId: BigInt(42),
      sourceEventId: BigInt(-11),
      status: "open",
      targetId: BigInt(11),
    });
  });

  test("bootstrap setup scheduling waits for future delegation readiness", async () => {
    const { scheduleBootstrapEarnAutodepositSweep } = await import(
      "./earn-autodeposit-repository.server"
    );
    const observedAt = new Date("2026-06-16T00:00:00.000Z");
    const delegationReadyAt = new Date("2026-06-16T02:00:00.000Z");
    const scheduledSweep = {
      classification: "initial_surplus",
      confidence: "confirmed_snapshot",
      eligibleAfter: delegationReadyAt,
      executeNowAvailableAt: delegationReadyAt,
      id: BigInt(42),
      lotCount: BigInt(1),
      originalAmountRaw: BigInt(500_000_000),
      reason: "initial Autodeposit surplus detected at setup confirmation",
      remainingAmountRaw: BigInt(500_000_000),
      slotId: BigInt(42),
      status: "scheduled",
    };
    const { client, getInsertValues } = createBootstrapClient({
      insertedLot: { id: BigInt(41), scheduledSlotId: BigInt(42) },
      scheduledSweep,
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
          source: "app_autodeposit_setup_confirm",
          sourceCommitment: "confirmed",
        },
        target: createRecord({
          id: BigInt(11),
          startTimestamp: BigInt(
            Math.floor(delegationReadyAt.getTime() / 1000)
          ),
          walletBalanceFloorRaw: BigInt(500_000_000),
        }) as never,
      },
      {
        client,
        now: () => new Date("2026-06-16T00:05:00.000Z"),
      } as never
    );

    expect(result.status).toBe("scheduled");
    const [, , lotValues] = getInsertValues();
    expect(lotValues).toMatchObject({
      eligibleAfter: delegationReadyAt,
    });
  });

  test("execute now cannot request a sweep before delegation readiness", async () => {
    const { requestImmediateEarnAutodepositScheduledSweep } = await import(
      "./earn-autodeposit-repository.server"
    );
    const now = new Date("2026-06-16T00:00:00.000Z");
    const delegationReadyAt = new Date("2026-06-16T00:00:30.000Z");
    const { client, getExecuteParams } = createImmediateSweepClient({
      acceleratedAmountRaw: BigInt(334_480_000),
      acceleratedLotCount: BigInt(2),
      eligibleAfter: delegationReadyAt,
      slotId: BigInt(42),
      status: "requested",
    });

    const result = await requestImmediateEarnAutodepositScheduledSweep(
      {
        policy: createRecord({ id: BigInt(7), policyAccount: "policy" }),
        status: "active",
        target: createRecord({
          id: BigInt(11),
          startTimestamp: BigInt(
            Math.floor(delegationReadyAt.getTime() / 1000)
          ),
        }),
      },
      {},
      { client, now: () => now } as never
    );

    expect(result?.eligibleAfter).toEqual(delegationReadyAt);
    expect(getExecuteParams()[0]).toContainEqual(delegationReadyAt);
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

    expect(result).toMatchObject({
      reason: "wallet_balance_at_or_below_floor",
      status: "skipped",
    });
    expect(getInsertValues()).toHaveLength(1);
    expect(getInsertValues()[0]).toMatchObject({
      amountRaw: BigInt(500_000_000),
      targetId: BigInt(11),
    });
  });

  test("scheduled cancellation executes a close-scoped mutation", async () => {
    const { cancelScheduledAutodepositTransactionsForClose } = await import(
      "./earn-autodeposit-repository.server"
    );
    const { calls, client } = createMutationClient({
      existing: null,
    });

    await cancelScheduledAutodepositTransactionsForClose({
      client: client as never,
      now: new Date("2026-06-02T00:00:00.000Z"),
      targetId: BigInt(11),
    });

    expect(calls).toEqual(["execute"]);
  });
});
