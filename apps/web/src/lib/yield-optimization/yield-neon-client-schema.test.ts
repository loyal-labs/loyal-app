import { describe, expect, mock, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";

mock.module("server-only", () => ({}));

describe("Yield Neon schema", () => {
  test("maps migration 59 target projection columns", async () => {
    const { balanceSweepTargets, routePolicies } = await import(
      "./yield-neon-client.server"
    );
    const targetColumns = getTableColumns(balanceSweepTargets);

    expect(targetColumns.active.name).toBe("desired_active");
    expect(targetColumns.lifecycleStatus.name).toBe("chain_status");
    expect(targetColumns.chainObservationSlot.name).toBe(
      "chain_observation_slot"
    );
    expect(targetColumns.setupGeneration.name).toBe("setup_generation");
    expect(targetColumns.bootstrapGeneration.name).toBe("bootstrap_generation");
    expect(getTableColumns(routePolicies).active.name).toBe("active");
  });
});
