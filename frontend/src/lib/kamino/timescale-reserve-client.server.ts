import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, desc, eq, gt, gte, inArray, lt, or } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import postgres, { type Sql } from "postgres";

const DEFAULT_MAX_CONNECTIONS = 5;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 5;

const kaminoTimescaleSchema = pgSchema("kamino");

export const timescaleReserveUpdates = kaminoTimescaleSchema.table(
  "reserve_updates",
  {
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    slot: bigint("slot", { mode: "number" }).notNull(),
    source: text("source").notNull(),
    reserve: text("reserve").notNull(),
    market: text("market"),
    marketName: text("market_name"),
    symbol: text("symbol"),
    liquidityMint: text("liquidity_mint").notNull(),
    supplyApy: doublePrecision("supply_apy").notNull(),
    borrowApy: doublePrecision("borrow_apy").notNull(),
    utilization: doublePrecision("utilization").notNull(),
    totalSupplyUsdEstimate: doublePrecision(
      "total_supply_usd_estimate"
    ).notNull(),
    totalBorrowUsdEstimate: doublePrecision(
      "total_borrow_usd_estimate"
    ).notNull(),
    reserveLastUpdateStale: boolean("reserve_last_update_stale").notNull(),
    diffChanged: boolean("diff_changed").notNull(),
    changedFields: text("changed_fields").array().notNull(),
    diffSummary: text("diff_summary").notNull(),
  }
);

export const timescaleLatestReserveUpdates = kaminoTimescaleSchema.table(
  "latest_reserve_updates",
  {
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    slot: bigint("slot", { mode: "number" }).notNull(),
    reserve: text("reserve").notNull(),
  }
);

export type TimescaleReserveClientConfig = {
  databaseUrl: string;
  maxConnections?: number;
  connectTimeoutSeconds?: number;
};

export type TimescaleReserveClientTables = {
  latestReserveUpdates: typeof timescaleLatestReserveUpdates;
  reserveUpdates: typeof timescaleReserveUpdates;
};

export type TimescaleReserveUpdateRow = typeof timescaleReserveUpdates.$inferSelect;

export class TimescaleReserveClient {
  readonly db: PostgresJsDatabase;
  readonly tables: TimescaleReserveClientTables = {
    latestReserveUpdates: timescaleLatestReserveUpdates,
    reserveUpdates: timescaleReserveUpdates,
  };

  private readonly sqlClient: Sql;

  constructor(config: TimescaleReserveClientConfig) {
    this.sqlClient = postgres(config.databaseUrl, {
      connect_timeout:
        config.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SECONDS,
      max: config.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
      prepare: false,
    });
    this.db = drizzle(this.sqlClient);
  }

  async close(): Promise<void> {
    await this.sqlClient.end();
  }

  async getSafeNoFeeReserveUpdates(args: {
    marketNames: readonly string[];
    stableSymbols: readonly string[];
    since: Date;
  }): Promise<TimescaleReserveUpdateRow[]> {
    const table = this.tables.reserveUpdates;

    return this.db
      .select()
      .from(table)
      .where(
        and(
          gte(table.observedAt, args.since),
          eq(table.reserveLastUpdateStale, false),
          gt(table.totalSupplyUsdEstimate, 100_000),
          gte(table.supplyApy, 0),
          lt(table.supplyApy, 0.5),
          inArray(table.symbol, [...args.stableSymbols]),
          or(
            inArray(table.marketName, [...args.marketNames]),
            inArray(table.market, [...args.marketNames])
          )
        )
      )
      .orderBy(desc(table.observedAt));
  }
}
