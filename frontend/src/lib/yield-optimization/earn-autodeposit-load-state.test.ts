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

  return {
    calls,
    getExecuteSql: () => executeSql,
    getUpdateSet: () => updateSet,
    getUpdateSets: () => updateSets,
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
    expect(getExecuteSql()[0]).toContain(
      "WITH scheduled_slots AS"
    );
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
