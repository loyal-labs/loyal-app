import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { earnForecastSnapshots } = await import("../yield-neon-client.server");
type YieldOptimizationClient =
  import("../yield-neon-client.server").YieldOptimizationClient;
const {
  getLatestEarnForecastSnapshot,
  snapshotRecordToEarnForecast,
  toEarnForecastSnapshotInput,
  upsertEarnForecastSnapshot,
} = await import("../earn-forecast-snapshot-repository.server");

type SelectCall = {
  orderBy?: unknown[];
  table?: unknown;
  where?: unknown;
};

type InsertCall = {
  conflict?: unknown;
  table: unknown;
  values?: Record<string, unknown>;
};

const sampleRows = [
  { apyBps: 870, observedAt: "2026-05-15T00:00:00.000Z" },
  { apyBps: 910, observedAt: "2026-05-31T00:00:00.000Z" },
];
const mainUsdcRows = [
  { apyBps: 520, observedAt: "2026-05-15T00:00:00.000Z" },
  { apyBps: 560, observedAt: "2026-05-31T00:00:00.000Z" },
];
const seriesRows = [
  {
    key: "loyal" as const,
    label: "Loyal Earn",
    metadata: {
      metric: "cumulative_annualized_apy_bps",
    },
    samples: sampleRows,
  },
  {
    key: "mainUsdcReserve" as const,
    label: "Kamino Main USDC",
    metadata: {
      market: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
      metric: "cumulative_annualized_apy_bps",
      reserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
    },
    samples: mainUsdcRows,
  },
];

const snapshot = {
  apyBps: 910,
  cluster: "devnet",
  feeBps: 1,
  generatedAt: new Date("2026-06-01T00:00:00.000Z"),
  id: BigInt(7),
  rangeHighBps: 940,
  rangeLowBps: 870,
  riskProfile: "medium",
  samples: sampleRows,
  series: seriesRows,
  snapshotDate: new Date("2026-06-01T00:00:00.000Z"),
  strategy: "medium_fee_aware_1bps",
  windowEndedAt: new Date("2026-06-01T00:00:00.000Z"),
  windowStartedAt: new Date("2026-05-02T00:00:00.000Z"),
};

function createFakeClient(rows = [snapshot]) {
  const insertCalls: InsertCall[] = [];
  const selectCalls: SelectCall[] = [];

  class SelectBuilder {
    readonly call: SelectCall = {};

    constructor() {
      selectCalls.push(this.call);
    }

    from(table: unknown) {
      this.call.table = table;
      return this;
    }

    where(where: unknown) {
      this.call.where = where;
      return this;
    }

    orderBy(...orderBy: unknown[]) {
      this.call.orderBy = orderBy;
      return this;
    }

    async limit(limit: number) {
      return rows.slice(0, limit);
    }
  }

  class InsertBuilder {
    readonly call: InsertCall;

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

    async returning() {
      return rows.slice(0, 1);
    }
  }

  const db = {
    insert: mock((table: unknown) => new InsertBuilder(table)),
    select: mock(() => new SelectBuilder()),
  };

  return {
    client: { db, tables: {} } as unknown as YieldOptimizationClient,
    insertCalls,
    selectCalls,
  };
}

describe("Earn forecast snapshot repository", () => {
  test("latest snapshot query returns the newest persisted row shape", async () => {
    const fake = createFakeClient();

    const result = await getLatestEarnForecastSnapshot(
      {
        cluster: "devnet",
        feeBps: 1,
        riskProfile: "medium",
        strategy: "medium_fee_aware_1bps",
      },
      fake
    );

    expect(result).toEqual(snapshot);
    expect(fake.selectCalls[0]?.table).toBe(earnForecastSnapshots);
    expect(fake.selectCalls[0]?.where).toBeDefined();
    expect(fake.selectCalls[0]?.orderBy?.length).toBe(2);
  });

  test("upsert is idempotent for the same logical key and snapshot date", async () => {
    const fake = createFakeClient();

    const result = await upsertEarnForecastSnapshot(
      {
        apyBps: 910,
        cluster: "devnet",
        feeBps: 1,
        generatedAt: new Date("2026-06-01T00:00:00.000Z"),
        rangeHighBps: 940,
        rangeLowBps: 870,
        riskProfile: "medium",
        samples: sampleRows,
        series: seriesRows,
        snapshotDate: new Date("2026-06-01T00:00:00.000Z"),
        strategy: "medium_fee_aware_1bps",
        windowEndedAt: new Date("2026-06-01T00:00:00.000Z"),
        windowStartedAt: new Date("2026-05-02T00:00:00.000Z"),
      },
      fake
    );

    expect(result).toEqual(snapshot);
    expect(fake.insertCalls).toHaveLength(1);
    expect(fake.insertCalls[0]?.table).toBe(earnForecastSnapshots);
    expect(fake.insertCalls[0]?.values?.samples).toEqual(sampleRows);
    expect(fake.insertCalls[0]?.values?.series).toEqual(seriesRows);
    expect(fake.insertCalls[0]?.conflict).toBeDefined();
  });

  test("JSON samples and series round-trip in order through the response shape", () => {
    const history = snapshotRecordToEarnForecast(snapshot).history;

    expect(history.samples).toEqual(sampleRows);
    expect(history.series).toEqual(seriesRows);
  });

  test("backfills legacy rows with a Loyal series from samples", () => {
    const legacySnapshot = { ...snapshot, series: undefined };
    const history = snapshotRecordToEarnForecast(
      legacySnapshot as typeof snapshot
    ).history;

    expect(history.samples).toEqual(sampleRows);
    expect(history.series).toEqual([
      {
        key: "loyal",
        label: "Loyal Earn",
        samples: sampleRows,
      },
    ]);
  });

  test("converts forecast responses to snapshot insert values", () => {
    const input = toEarnForecastSnapshotInput({
      cluster: "devnet",
      forecast: snapshotRecordToEarnForecast(snapshot),
    });

    expect(input).toMatchObject({
      apyBps: 910,
      cluster: "devnet",
      feeBps: 1,
      rangeHighBps: 940,
      rangeLowBps: 870,
      riskProfile: "medium",
      samples: sampleRows,
      series: seriesRows,
      snapshotDate: new Date("2026-06-01T00:00:00.000Z"),
      strategy: "medium_fee_aware_1bps",
    });
    expect(input.snapshotDate.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(input.windowEndedAt.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});
