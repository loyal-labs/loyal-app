import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  LoyalCluster,
  RiskBasket,
  createVaultYieldRoutingPolicyPlan,
} from "@loyal/actions";
import { PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

const {
  managedVaults,
  routePolicies,
  userYieldPositionDeposits,
  userYieldPositionWithdrawals,
  userYieldPositions,
} = await import("../yield-neon-client.server");
const {
  createRoutePolicyValuesFromPlan,
  recordConfirmedYieldDeposit,
  recordConfirmedYieldWithdrawal,
} = await import("../yield-deposit-repository.server");

const settings = new PublicKey("11111111111111111111111111111112");
const walletAddress = new PublicKey("11111111111111111111111111111113");
const smartAccountAddress = new PublicKey("11111111111111111111111111111114");

type InsertCall = {
  conflict?: unknown;
  table: unknown;
  values?: Record<string, unknown>;
};

type UpdateCall = {
  table: unknown;
  set?: Record<string, unknown>;
  where?: unknown;
};

function input(overrides = {}) {
  return {
    cluster: "devnet",
    confirmedSlot: BigInt(123),
    depositMint: "USDC-mint",
    depositSignature: "deposit-sig-1",
    liquidityMint: "USDC-mint",
    market: "Main",
    policyAccount: "policy-account-1",
    policyId: BigInt(42),
    policyInitialization: "create" as const,
    policySeed: BigInt(7),
    policySignature: "policy-sig-1",
    principalAmountRaw: BigInt(1_000_000),
    settings: settings.toBase58(),
    smartAccountAddress: smartAccountAddress.toBase58(),
    targetReserve: "reserve-1",
    targetSupplyApyBps: BigInt(523),
    vaultIndex: 1,
    vaultPubkey: "11111111111111111111111111111115",
    walletAddress: walletAddress.toBase58(),
    ...overrides,
  };
}

function withdrawalInput(overrides = {}) {
  return {
    cluster: "devnet",
    confirmedSlot: BigInt(140),
    liquidityMint: "USDC-mint",
    market: "Main",
    mode: "partial" as const,
    policyAccount: "policy-account-1",
    policyId: BigInt(42),
    policySeed: BigInt(7),
    settings: settings.toBase58(),
    smartAccountAddress: smartAccountAddress.toBase58(),
    targetReserve: "reserve-1",
    vaultIndex: 1,
    vaultPubkey: "11111111111111111111111111111115",
    walletAddress: walletAddress.toBase58(),
    withdrawalSignature: "withdrawal-sig-1",
    withdrawnAmountRaw: BigInt(250_000),
    ...overrides,
  };
}

function position(overrides = {}) {
  const now = new Date("2026-06-01T00:00:00.000Z");
  return {
    cluster: "devnet",
    createdAt: now,
    depositMint: "USDC-mint",
    firstDepositSignature: "deposit-sig-1",
    id: BigInt(1),
    lastConfirmedSlot: BigInt(123),
    lastDepositSignature: "deposit-sig-1",
    liquidityMint: "USDC-mint",
    market: "Main",
    policyAccount: "policy-account-1",
    policyId: BigInt(42),
    policySeed: BigInt(7),
    principalAmountRaw: BigInt(1_000_000),
    settings: settings.toBase58(),
    smartAccountAddress: smartAccountAddress.toBase58(),
    status: "active" as const,
    targetReserve: "reserve-1",
    targetSupplyApyBps: BigInt(523),
    updatedAt: now,
    vaultIndex: 1,
    vaultPubkey: "11111111111111111111111111111115",
    walletAddress: walletAddress.toBase58(),
    ...overrides,
  };
}

function createFakeClient(args: {
  duplicateDeposit?: boolean;
  duplicateWithdrawal?: boolean;
  existingPosition?: ReturnType<typeof position>;
  upsertedRoutePolicyId?: bigint;
  upsertedPosition?: ReturnType<typeof position>;
  updatedPosition?: ReturnType<typeof position>;
}) {
  const insertCalls: InsertCall[] = [];
  const updateCalls: UpdateCall[] = [];
  const findFirst = mock(async () => args.existingPosition ?? null);

  class InsertBuilder {
    readonly call: InsertCall;
    private returnsSelection = false;

    constructor(table: unknown) {
      this.call = { table };
      insertCalls.push(this.call);
    }

    values(values: Record<string, unknown>) {
      this.call.values = values;
      return this;
    }

    onConflictDoUpdate(conflict: unknown) {
      this.call.conflict = conflict;
      return this;
    }

    onConflictDoNothing(conflict: unknown) {
      this.call.conflict = conflict;
      return this;
    }

    returning(_selection?: unknown) {
      this.returnsSelection = true;
      return this;
    }

    async execute() {
      if (this.call.table === routePolicies && this.returnsSelection) {
        return [{ id: args.upsertedRoutePolicyId ?? BigInt(4200) }];
      }
      if (this.call.table === userYieldPositionDeposits) {
        return args.duplicateDeposit ? [] : [{ id: BigInt(99) }];
      }
      if (this.call.table === userYieldPositionWithdrawals) {
        return args.duplicateWithdrawal ? [] : [{ id: BigInt(100) }];
      }
      if (this.call.table === userYieldPositions && this.returnsSelection) {
        return [args.upsertedPosition ?? position()];
      }
      return [];
    }

    then(resolve: (value: unknown) => void, reject: (error: unknown) => void) {
      return this.execute().then(resolve, reject);
    }
  }

  class UpdateBuilder {
    readonly call: UpdateCall;
    private returnsSelection = false;

    constructor(table: unknown) {
      this.call = { table };
      updateCalls.push(this.call);
    }

    set(values: Record<string, unknown>) {
      this.call.set = values;
      return this;
    }

    where(where: unknown) {
      this.call.where = where;
      return this;
    }

    returning() {
      this.returnsSelection = true;
      return this;
    }

    async execute() {
      if (this.call.table === userYieldPositions && this.returnsSelection) {
        return [args.updatedPosition ?? position()];
      }
      return [];
    }

    then(resolve: (value: unknown) => void, reject: (error: unknown) => void) {
      return this.execute().then(resolve, reject);
    }
  }

  const db = {
    batch: mock(async (queries: Array<InsertBuilder | UpdateBuilder>) =>
      Promise.all(queries.map((query) => query.execute()))
    ),
    insert: mock((table: unknown) => new InsertBuilder(table)),
    update: mock((table: unknown) => new UpdateBuilder(table)),
    query: {
      userYieldPositions: {
        findFirst,
      },
    },
  };

  return {
    client: { db },
    db,
    findFirst,
    insertCalls,
    updateCalls,
  };
}

describe("recordConfirmedYieldDeposit", () => {
  beforeEach(() => {
    mock.restore();
  });

  test("creates policy, managed vault, deposit event, and aggregate position", async () => {
    const fake = createFakeClient({ upsertedPosition: position() });

    const result = await recordConfirmedYieldDeposit(input(), {
      client: fake.client as never,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result.principalAmountRaw).toBe(BigInt(1_000_000));
    expect(fake.db.batch).toHaveBeenCalledTimes(1);
    expect(fake.insertCalls.map((call) => call.table)).toEqual([
      routePolicies,
      managedVaults,
      userYieldPositionDeposits,
      userYieldPositions,
    ]);
  });

  test("writes route policy values from the canonical plan", async () => {
    const fake = createFakeClient({ upsertedPosition: position() });
    const depositInput = input();
    const now = new Date("2026-06-01T00:00:00.000Z");
    const plan = createVaultYieldRoutingPolicyPlan({
      cluster: LoyalCluster.Devnet,
      risk: RiskBasket.Safe,
      smartAccount: {
        settings,
        authority: walletAddress,
        delegatedSigner: walletAddress,
      },
      vaultIndex: depositInput.vaultIndex,
    });

    await recordConfirmedYieldDeposit(depositInput, {
      client: fake.client as never,
      now: () => now,
    });

    const routePolicyCall = fake.insertCalls.find(
      (call) => call.table === routePolicies
    );
    const managedVaultCall = fake.insertCalls.find(
      (call) => call.table === managedVaults
    );

    expect(routePolicyCall?.values).toEqual(
      createRoutePolicyValuesFromPlan(plan, depositInput, now)
    );
    expect(routePolicyCall?.values).not.toHaveProperty("id");
    expect(routePolicyCall?.values?.authority).toBe(walletAddress.toBase58());
    expect(routePolicyCall?.values?.delegatedSigners).toEqual([
      walletAddress.toBase58(),
    ]);
    expect(routePolicyCall?.values?.stableMints).toEqual(
      plan.persistence.stableMints
    );
    expect(routePolicyCall?.values?.kaminoMarkets).toEqual(
      plan.persistence.kaminoMarkets
    );
    expect(routePolicyCall?.values?.swapLanes).toEqual(
      plan.persistence.swapLanes
    );
    expect(routePolicyCall?.values?.vaultPubkey).toBe(
      plan.metadata.vault.toBase58()
    );
    expect(managedVaultCall?.values?.vaultPubkey).toBe(
      plan.metadata.vault.toBase58()
    );
    expect(managedVaultCall?.values?.activePolicyId).toBe(BigInt(4200));
    expect(managedVaultCall?.values?.activePolicyId).not.toBe(
      depositInput.policyId
    );
    expect(
      (managedVaultCall?.conflict as { target: unknown[] }).target
    ).toEqual([
      managedVaults.cluster,
      managedVaults.settings,
      managedVaults.vaultIndex,
      managedVaults.vaultPubkey,
    ]);
  });

  test("allows same on-chain policy seed across different policy accounts", async () => {
    const firstFake = createFakeClient({
      upsertedPosition: position({ policyAccount: "policy-account-a" }),
      upsertedRoutePolicyId: BigInt(101),
    });
    const secondSettings = new PublicKey("11111111111111111111111111111116");
    const secondFake = createFakeClient({
      upsertedPosition: position({
        policyAccount: "policy-account-b",
        settings: secondSettings.toBase58(),
      }),
      upsertedRoutePolicyId: BigInt(202),
    });

    await recordConfirmedYieldDeposit(
      input({
        policyAccount: "policy-account-a",
        policyId: BigInt(1),
        policySeed: BigInt(1),
      }),
      {
        client: firstFake.client as never,
        now: () => new Date("2026-06-01T00:00:00.000Z"),
      }
    );
    await recordConfirmedYieldDeposit(
      input({
        depositSignature: "deposit-sig-2",
        policyAccount: "policy-account-b",
        policyId: BigInt(1),
        policySeed: BigInt(1),
        policySignature: "policy-sig-2",
        settings: secondSettings.toBase58(),
      }),
      {
        client: secondFake.client as never,
        now: () => new Date("2026-06-01T00:00:00.000Z"),
      }
    );

    const firstRoutePolicyCall = firstFake.insertCalls.find(
      (call) => call.table === routePolicies
    );
    const firstManagedVaultCall = firstFake.insertCalls.find(
      (call) => call.table === managedVaults
    );
    const secondRoutePolicyCall = secondFake.insertCalls.find(
      (call) => call.table === routePolicies
    );
    const secondManagedVaultCall = secondFake.insertCalls.find(
      (call) => call.table === managedVaults
    );

    expect(firstRoutePolicyCall?.values).not.toHaveProperty("id");
    expect(secondRoutePolicyCall?.values).not.toHaveProperty("id");
    expect(firstRoutePolicyCall?.values).toMatchObject({
      policyAccount: "policy-account-a",
      policySeed: BigInt(1),
    });
    expect(secondRoutePolicyCall?.values).toMatchObject({
      policyAccount: "policy-account-b",
      policySeed: BigInt(1),
    });
    expect(firstManagedVaultCall?.values?.activePolicyId).toBe(BigInt(101));
    expect(secondManagedVaultCall?.values?.activePolicyId).toBe(BigInt(202));
  });

  test("duplicate deposit signature returns the existing position without another aggregate upsert", async () => {
    const existingPosition = position({
      principalAmountRaw: BigInt(1_000_000),
    });
    const fake = createFakeClient({
      duplicateDeposit: true,
      existingPosition,
    });

    const result = await recordConfirmedYieldDeposit(input(), {
      client: fake.client as never,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result).toBe(existingPosition);
    expect(fake.insertCalls.map((call) => call.table)).toEqual([
      routePolicies,
      managedVaults,
      userYieldPositionDeposits,
    ]);
    expect(fake.findFirst).toHaveBeenCalledTimes(1);
  });

  test("duplicate deposit signature recovers the aggregate when the position is missing", async () => {
    const recoveredPosition = position({
      principalAmountRaw: BigInt(1_000_000),
    });
    const fake = createFakeClient({
      duplicateDeposit: true,
      upsertedPosition: recoveredPosition,
    });

    const result = await recordConfirmedYieldDeposit(input(), {
      client: fake.client as never,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result).toBe(recoveredPosition);
    expect(fake.insertCalls.map((call) => call.table)).toEqual([
      routePolicies,
      managedVaults,
      userYieldPositionDeposits,
      userYieldPositions,
    ]);
    expect(fake.findFirst).toHaveBeenCalledTimes(1);
  });

  test("second distinct deposit into the same target updates aggregate principal", async () => {
    const fake = createFakeClient({
      existingPosition: position({
        principalAmountRaw: BigInt(1_000_000),
      }),
      upsertedPosition: position({
        lastConfirmedSlot: BigInt(130),
        lastDepositSignature: "deposit-sig-2",
        principalAmountRaw: BigInt(2_500_000),
      }),
    });

    const result = await recordConfirmedYieldDeposit(
      input({
        confirmedSlot: BigInt(130),
        depositSignature: "deposit-sig-2",
        policyInitialization: "reuse" as const,
        principalAmountRaw: BigInt(1_500_000),
      }),
      {
        client: fake.client as never,
        now: () => new Date("2026-06-01T00:00:00.000Z"),
      }
    );

    const aggregateCall = fake.insertCalls.find(
      (call) => call.table === userYieldPositions
    );
    expect(aggregateCall?.values?.principalAmountRaw).toBe(BigInt(1_500_000));
    expect(result.principalAmountRaw).toBe(BigInt(2_500_000));
    expect(result.lastDepositSignature).toBe("deposit-sig-2");
  });

  test("rejects top-up deposits without an active position", async () => {
    const fake = createFakeClient({});

    await expect(
      recordConfirmedYieldDeposit(input({ policyInitialization: "reuse" }), {
        client: fake.client as never,
        now: () => new Date("2026-06-01T00:00:00.000Z"),
      })
    ).rejects.toThrow("Top-up yield deposit requires an existing active position.");
    expect(fake.insertCalls).toHaveLength(0);
  });

  test("rejects first deposits when an active Earn position already exists", async () => {
    const fake = createFakeClient({
      existingPosition: position({
        principalAmountRaw: BigInt(1_000_000),
      }),
    });

    await expect(
      recordConfirmedYieldDeposit(
        input({
          depositSignature: "deposit-sig-new-create",
          policyInitialization: "create",
        }),
        {
          client: fake.client as never,
          now: () => new Date("2026-06-01T00:00:00.000Z"),
        }
      )
    ).rejects.toThrow("Initial yield deposit cannot recreate an active Earn policy.");
    expect(fake.insertCalls).toHaveLength(0);
  });
});

describe("recordConfirmedYieldWithdrawal", () => {
  beforeEach(() => {
    mock.restore();
  });

  test("records a partial withdrawal and decrements the active position", async () => {
    const fake = createFakeClient({
      existingPosition: position({ principalAmountRaw: BigInt(1_000_000) }),
      updatedPosition: position({
        lastConfirmedSlot: BigInt(140),
        principalAmountRaw: BigInt(750_000),
      }),
    });

    const result = await recordConfirmedYieldWithdrawal(withdrawalInput(), {
      client: fake.client as never,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result.principalAmountRaw).toBe(BigInt(750_000));
    expect(fake.insertCalls.map((call) => call.table)).toEqual([
      userYieldPositionWithdrawals,
    ]);
    expect(fake.updateCalls.map((call) => call.table)).toEqual([
      userYieldPositions,
    ]);
    expect(fake.insertCalls[0]?.values).toMatchObject({
      mode: "partial",
      withdrawalSignature: "withdrawal-sig-1",
      withdrawnAmountRaw: BigInt(250_000),
    });
    expect(fake.updateCalls[0]?.set).toMatchObject({
      lastConfirmedSlot: BigInt(140),
      status: "active",
    });
  });

  test("full withdrawal closes position, policy, and managed vault", async () => {
    const fake = createFakeClient({
      existingPosition: position({ principalAmountRaw: BigInt(1_000_000) }),
      updatedPosition: position({
        lastConfirmedSlot: BigInt(140),
        principalAmountRaw: BigInt(0),
        status: "closed",
      }),
    });

    const result = await recordConfirmedYieldWithdrawal(
      withdrawalInput({
        mode: "full" as const,
        withdrawnAmountRaw: BigInt(1_000_000),
      }),
      {
        client: fake.client as never,
        now: () => new Date("2026-06-01T00:00:00.000Z"),
      }
    );

    expect(result.status).toBe("closed");
    expect(result.principalAmountRaw).toBe(BigInt(0));
    expect(fake.updateCalls.map((call) => call.table)).toEqual([
      userYieldPositions,
      routePolicies,
      managedVaults,
    ]);
    expect(fake.updateCalls[1]?.set).toMatchObject({ active: false });
    expect(fake.updateCalls[2]?.set).toMatchObject({ active: false });
  });

  test("duplicate withdrawal signature returns existing position", async () => {
    const existingPosition = position({ principalAmountRaw: BigInt(750_000) });
    const fake = createFakeClient({
      duplicateWithdrawal: true,
      existingPosition,
    });

    const result = await recordConfirmedYieldWithdrawal(withdrawalInput(), {
      client: fake.client as never,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result).toBe(existingPosition);
    expect(fake.updateCalls).toHaveLength(0);
  });

  test("rejects over-withdrawal before writing an event", async () => {
    const fake = createFakeClient({
      existingPosition: position({ principalAmountRaw: BigInt(100_000) }),
    });

    await expect(
      recordConfirmedYieldWithdrawal(withdrawalInput(), {
        client: fake.client as never,
        now: () => new Date("2026-06-01T00:00:00.000Z"),
      })
    ).rejects.toThrow("exceeds the active yield position amount");
    expect(fake.insertCalls).toHaveLength(0);
  });
});
