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

  test("maps earn reserve share price columns", async () => {
    const { earnReserveSharePrices } = await import(
      "./yield-neon-client.server"
    );
    const columns = getTableColumns(earnReserveSharePrices);

    expect(columns.observedHour.name).toBe("observed_hour");
    expect(columns.observedAt.name).toBe("observed_at");
    expect(columns.liquidityMint.name).toBe("liquidity_mint");
    expect(columns.sharePrice.name).toBe("share_price");
    expect(columns.sharePrice.columnType).toBe("PgDoublePrecision");
  });
});
