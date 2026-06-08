import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  YieldOptimizationClient,
  earnForecastSnapshots,
  getYieldOptimizationClient,
  managedVaults,
  rebalanceDecisions,
  routePolicies,
  userYieldPositionDeposits,
  userYieldPositionHoldingEvents,
  userYieldPositionWithdrawals,
  userYieldPositions,
  vaultPositionSnapshotPositions,
  vaultPositionSnapshots,
  vaultReservePositionsCurrent,
} = await import("../yield-neon-client.server");

describe("yield optimization Neon client", () => {
  test("creates a Drizzle-backed client with the loyal_yield export surface", () => {
    const client = new YieldOptimizationClient({
      databaseUrl: "postgresql://user:password@localhost/test",
    });

    expect(client.db).toBeDefined();
    expect(client.tables.routePolicies).toBe(routePolicies);
    expect(client.tables.managedVaults).toBe(managedVaults);
    expect(client.tables.vaultPositionSnapshots).toBe(vaultPositionSnapshots);
    expect(client.tables.vaultPositionSnapshotPositions).toBe(
      vaultPositionSnapshotPositions
    );
    expect(client.tables.vaultReservePositionsCurrent).toBe(
      vaultReservePositionsCurrent
    );
    expect(client.tables.rebalanceDecisions).toBe(rebalanceDecisions);
    expect(client.tables.userYieldPositions).toBe(userYieldPositions);
    expect(client.tables.userYieldPositionDeposits).toBe(
      userYieldPositionDeposits
    );
    expect(client.tables.userYieldPositionHoldingEvents).toBe(
      userYieldPositionHoldingEvents
    );
    expect(client.tables.userYieldPositionWithdrawals).toBe(
      userYieldPositionWithdrawals
    );
    expect(client.tables.earnForecastSnapshots).toBe(earnForecastSnapshots);
  });

  test("lazy singleton reads only the yield optimization database URL", () => {
    const previousNeonDatabaseUrl = process.env.NEON_DATABASE_URL;
    const previousPhalaApiKey = process.env.PHALA_API_KEY;

    try {
      process.env.NEON_DATABASE_URL =
        "postgresql://user:password@localhost/test";
      delete process.env.PHALA_API_KEY;

      const client = getYieldOptimizationClient();

      expect(client.db).toBeDefined();
      expect(client.tables.routePolicies).toBe(routePolicies);
    } finally {
      if (previousNeonDatabaseUrl === undefined) {
        delete process.env.NEON_DATABASE_URL;
      } else {
        process.env.NEON_DATABASE_URL = previousNeonDatabaseUrl;
      }

      if (previousPhalaApiKey === undefined) {
        delete process.env.PHALA_API_KEY;
      } else {
        process.env.PHALA_API_KEY = previousPhalaApiKey;
      }
    }
  });
});
