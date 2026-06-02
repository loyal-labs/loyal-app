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
  userYieldPositions,
} = await import("../yield-neon-client.server");
const { createRoutePolicyValuesFromPlan, recordConfirmedYieldDeposit } = await import(
  "../yield-deposit-repository.server"
);

const settings = new PublicKey("11111111111111111111111111111112");
const walletAddress = new PublicKey("11111111111111111111111111111113");
const smartAccountAddress = new PublicKey("11111111111111111111111111111114");

type InsertCall = {
  conflict?: unknown;
  table: unknown;
  values?: Record<string, unknown>;
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
    policySeed: BigInt(7),
    policySignature: "policy-sig-1",
    principalAmountRaw: BigInt(1_000_000),
    settings: settings.toBase58(),
    smartAccountAddress: smartAccountAddress.toBase58(),
    targetReserve: "reserve-1",
    targetSupplyApyBps: BigInt(523),
    vaultIndex: 0,
    vaultPubkey: "11111111111111111111111111111115",
    walletAddress: walletAddress.toBase58(),
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
    vaultIndex: 0,
    vaultPubkey: "11111111111111111111111111111115",
    walletAddress: walletAddress.toBase58(),
    ...overrides,
  };
}

function createFakeClient(args: {
  duplicateDeposit?: boolean;
  existingPosition?: ReturnType<typeof position>;
  upsertedPosition?: ReturnType<typeof position>;
}) {
  const insertCalls: InsertCall[] = [];
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

    returning() {
      this.returnsSelection = true;
      return this;
    }

    async execute() {
      if (this.call.table === userYieldPositionDeposits) {
        return args.duplicateDeposit ? [] : [{ id: BigInt(99) }];
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

  const db = {
    batch: mock(async (queries: InsertBuilder[]) =>
      Promise.all(queries.map((query) => query.execute()))
    ),
    insert: mock((table: unknown) => new InsertBuilder(table)),
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
  });

  test("duplicate deposit signature returns the existing position without another aggregate upsert", async () => {
    const existingPosition = position({ principalAmountRaw: BigInt(1_000_000) });
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

  test("second distinct deposit into the same target updates aggregate principal", async () => {
    const fake = createFakeClient({
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
});
