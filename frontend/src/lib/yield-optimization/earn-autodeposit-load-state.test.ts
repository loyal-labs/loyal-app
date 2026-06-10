import { describe, expect, mock, test } from "bun:test";

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
    getUpdateSet: () => updateSet,
    client: {
      db: {
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
      "@/app/api/smart-accounts/yield-optimization/earn-state/route"
    );
    const policy = createRecord({ id: BigInt(7) });
    const target = createRecord({
      active: true,
      balanceSweepPolicyId: BigInt(7),
      lifecycleStatus: "active",
    });

    expect(
      serializeAutodepositState({
        policy,
        status: "active",
        target,
      } as never)
    ).toMatchObject({
      active: true,
      amountPerPeriodRaw: "100000000",
      balanceSweepPolicyId: "7",
      policyAccount: "policy",
      recurringDelegation: "recurring",
      status: "active",
      startTimestamp: "1780185600",
      walletBalanceFloorRaw: "500000000",
    });
  });

  test("earn-state serializes pending autodeposit metadata", async () => {
    const { serializeAutodepositState } = await import(
      "@/app/api/smart-accounts/yield-optimization/earn-state/route"
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
      "@/app/api/smart-accounts/yield-optimization/earn-state/route"
    );
    const policy = createRecord({ id: BigInt(7) });
    const target = createRecord({
      active: false,
      balanceSweepPolicyId: BigInt(7),
      lifecycleStatus: "active",
    });

    expect(
      serializeAutodepositState({
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
        policyAccount: "policy",
        policySeed: "1",
        periodLengthSeconds: "2592000",
        recurringDelegation: "recurring",
        startTimestamp: "4102444800",
        status: "active",
        walletBalanceFloorRaw: "500000000",
      })
    ).toEqual({
      amount: "100",
      keepAmount: "500",
      nextPeriodLabel: "Jan 01",
      nonce: "1",
      policyAccount: "policy",
      recurringDelegation: "recurring",
      state: "created",
    });
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
});
