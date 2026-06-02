import "server-only";

import {
  RISK_BASKET_MARKETS,
  STABLECOIN_MINTS,
  STABLECOINS,
} from "@loyal/actions/constants";
import { RiskBasket, type Stablecoin } from "@loyal/actions/types";
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

export type TimescaleReserveUpdateRow =
  typeof timescaleReserveUpdates.$inferSelect;
export type CurrentBestApyReserveByStablecoin = TimescaleReserveUpdateRow & {
  stablecoin: Stablecoin;
};

const DEFAULT_MIN_TOTAL_SUPPLY_USD_ESTIMATE = 100_000;
const DEFAULT_MAX_SUPPLY_APY = 0.5;

const stablecoinByLiquidityMint = new Map<string, Stablecoin>(
  STABLECOINS.map((stablecoin) => [
    STABLECOIN_MINTS[stablecoin].toBase58(),
    stablecoin,
  ])
);

export function selectCurrentBestApyReserveByStablecoin(
  rows: readonly TimescaleReserveUpdateRow[]
): CurrentBestApyReserveByStablecoin[] {
  const bestByStablecoin = new Map<
    Stablecoin,
    CurrentBestApyReserveByStablecoin
  >();

  for (const row of rows) {
    const stablecoin = stablecoinByLiquidityMint.get(row.liquidityMint);
    const current = stablecoin ? bestByStablecoin.get(stablecoin) : undefined;
    if (!stablecoin || (current && current.supplyApy >= row.supplyApy)) {
      continue;
    }
    bestByStablecoin.set(stablecoin, { ...row, stablecoin });
  }

  return STABLECOINS.flatMap((stablecoin) => {
    const row = bestByStablecoin.get(stablecoin);
    return row ? [row] : [];
  });
}

export function getTimescaleReserveDatabaseUrl(): string | null {
  return (
    process.env.KAMINO_TIMESCALE_DATABASE_URL ??
    process.env.TIMESCALE_DATABASE_URL ??
    null
  );
}

export async function getCurrentBestApyReserveByStablecoin(args: {
  riskProfile: RiskBasket;
}): Promise<CurrentBestApyReserveByStablecoin[]> {
  const databaseUrl = getTimescaleReserveDatabaseUrl();
  if (!databaseUrl) {
    return [];
  }

  const client = new TimescaleReserveClient({ databaseUrl, maxConnections: 1 });
  try {
    return await client.getCurrentBestApyReserveByStablecoin(args);
  } finally {
    await client.close();
  }
}

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

  async getCurrentBestApyReserveByStablecoin(args: {
    riskProfile: RiskBasket;
    minTotalSupplyUsdEstimate?: number;
    maxSupplyApy?: number;
  }): Promise<CurrentBestApyReserveByStablecoin[]> {
    if (!Object.values(RiskBasket).includes(args.riskProfile)) {
      throw new Error(`unsupported risk profile: ${String(args.riskProfile)}`);
    }

    const reserveUpdates = this.tables.reserveUpdates;
    const latestReserveUpdates = this.tables.latestReserveUpdates;
    const marketAddresses = RISK_BASKET_MARKETS[args.riskProfile].map(
      (market) => market.toBase58()
    );
    const stablecoinLiquidityMints = STABLECOINS.map((stablecoin) =>
      STABLECOIN_MINTS[stablecoin].toBase58()
    );

    const rows = await this.db
      .select()
      .from(reserveUpdates)
      .innerJoin(
        latestReserveUpdates,
        and(
          eq(reserveUpdates.reserve, latestReserveUpdates.reserve),
          eq(reserveUpdates.slot, latestReserveUpdates.slot),
          eq(reserveUpdates.observedAt, latestReserveUpdates.observedAt)
        )
      )
      .where(
        and(
          eq(reserveUpdates.reserveLastUpdateStale, false),
          gt(
            reserveUpdates.totalSupplyUsdEstimate,
            args.minTotalSupplyUsdEstimate ??
              DEFAULT_MIN_TOTAL_SUPPLY_USD_ESTIMATE
          ),
          gte(reserveUpdates.supplyApy, 0),
          lt(
            reserveUpdates.supplyApy,
            args.maxSupplyApy ?? DEFAULT_MAX_SUPPLY_APY
          ),
          inArray(reserveUpdates.market, marketAddresses),
          inArray(reserveUpdates.liquidityMint, stablecoinLiquidityMints)
        )
      )
      .orderBy(desc(reserveUpdates.supplyApy));

    return selectCurrentBestApyReserveByStablecoin(
      rows.map((row) => row.reserve_updates)
    );
  }
}
