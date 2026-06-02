import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  TimescaleReserveClient,
  timescaleLatestReserveUpdates,
  timescaleReserveUpdates,
} = await import("../timescale-reserve-client.server");

describe("timescale reserve client", () => {
  test("exposes Kamino Timescale table models", () => {
    expect(timescaleReserveUpdates.reserve.name).toBe("reserve");
    expect(timescaleReserveUpdates.observedAt.name).toBe("observed_at");
    expect(timescaleReserveUpdates.supplyApy.name).toBe("supply_apy");
    expect(timescaleLatestReserveUpdates.slot.name).toBe("slot");
  });

  test("creates a Drizzle-backed client without fetching data", async () => {
    const client = new TimescaleReserveClient({
      databaseUrl: "postgres://localhost/test",
    });

    expect(client.db).toBeDefined();
    expect(client.tables.reserveUpdates).toBe(timescaleReserveUpdates);
    expect(client.tables.latestReserveUpdates).toBe(
      timescaleLatestReserveUpdates
    );

    await client.close();
  });
});
