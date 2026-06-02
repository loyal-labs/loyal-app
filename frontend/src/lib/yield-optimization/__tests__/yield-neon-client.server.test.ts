import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  YieldOptimizationClient,
  getYieldOptimizationClient,
  managedVaults,
  rebalanceDecisions,
  routePolicies,
  userYieldPositionDeposits,
  userYieldPositions,
  vaultPositionSnapshotPositions,
  vaultPositionSnapshots,
  vaultReservePositionsCurrent,
} = await import("../yield-neon-client.server");

describe("yield optimization Neon client", () => {
  test("exposes loyal_yield table models", () => {
    expect(routePolicies.policyAccount.name).toBe("policy_account");
    expect(routePolicies.swapLanes.name).toBe("swap_lanes");
    expect(managedVaults.activePolicyId.name).toBe("active_policy_id");
    expect(vaultPositionSnapshots.isCurrent.name).toBe("is_current");
    expect(vaultPositionSnapshotPositions.amountRaw.name).toBe("amount_raw");
    expect(vaultReservePositionsCurrent.reserve.name).toBe("reserve");
    expect(rebalanceDecisions.decisionReason.name).toBe("decision_reason");
    expect(userYieldPositions.principalAmountRaw.name).toBe(
      "principal_amount_raw"
    );
    expect(userYieldPositionDeposits.depositSignature.name).toBe(
      "deposit_signature"
    );
  });

  test("creates a Drizzle-backed client without fetching data", () => {
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
