import "server-only";

import {
  RISK_BASKET_MARKETS,
  STABLECOIN_MINTS,
  STABLECOINS,
} from "@loyal-labs/actions/constants";
import { RiskBasket, type Stablecoin } from "@loyal-labs/actions/types";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, or } from "drizzle-orm";
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

export const timescaleSupportedReserves = kaminoTimescaleSchema.table(
  "supported_reserves",
  {
    active: boolean("active").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    liquidityMint: text("liquidity_mint").notNull(),
    market: text("market").notNull(),
    marketName: text("market_name"),
    reserve: text("reserve").notNull(),
    riskBaskets: text("risk_baskets").array().notNull(),
    source: text("source").notNull(),
    symbol: text("symbol"),
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
  supportedReserves: typeof timescaleSupportedReserves;
};

export type TimescaleReserveUpdateRow =
  typeof timescaleReserveUpdates.$inferSelect;
export type TimescaleSupportedReserveRow =
  typeof timescaleSupportedReserves.$inferSelect;
export type TimescaleReserveApySample = Pick<
  TimescaleReserveUpdateRow,
  "observedAt" | "supplyApy"
>;
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
  return process.env.TIMESCALEDB_URL ?? null;
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

export async function getCurrentReserveUpdatesByReserve(args: {
  reserves: readonly string[];
}): Promise<TimescaleReserveUpdateRow[]> {
  const databaseUrl = getTimescaleReserveDatabaseUrl();
  if (!databaseUrl) {
    return [];
  }

  const client = new TimescaleReserveClient({ databaseUrl, maxConnections: 1 });
  try {
    return await client.getCurrentReserveUpdatesByReserve(args);
  } finally {
    await client.close();
  }
}

export class TimescaleReserveClient {
  readonly db: PostgresJsDatabase;
  readonly tables: TimescaleReserveClientTables = {
    latestReserveUpdates: timescaleLatestReserveUpdates,
    reserveUpdates: timescaleReserveUpdates,
    supportedReserves: timescaleSupportedReserves,
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

  async getMediumStableSupportedReserves(): Promise<
    TimescaleSupportedReserveRow[]
  > {
    const table = this.tables.supportedReserves;
    const marketAddresses = RISK_BASKET_MARKETS[RiskBasket.Medium].map(
      (market) => market.toBase58()
    );
    const stablecoinLiquidityMints = STABLECOINS.map((stablecoin) =>
      STABLECOIN_MINTS[stablecoin].toBase58()
    );

    return this.db
      .select()
      .from(table)
      .where(
        and(
          eq(table.active, true),
          inArray(table.market, marketAddresses),
          inArray(table.liquidityMint, stablecoinLiquidityMints)
        )
      )
      .orderBy(asc(table.market), asc(table.liquidityMint), asc(table.reserve));
  }

  async getReserveUpdatesWithSeedRows(args: {
    end: Date;
    reserves: readonly string[];
    start: Date;
  }): Promise<TimescaleReserveUpdateRow[]> {
    if (args.reserves.length === 0) {
      return [];
    }

    const table = this.tables.reserveUpdates;
    const previousRows = await Promise.all(
      args.reserves.map((reserve) =>
        this.db
          .select()
          .from(table)
          .where(
            and(
              eq(table.reserve, reserve),
              eq(table.reserveLastUpdateStale, false),
              gte(table.supplyApy, 0),
              lt(table.supplyApy, DEFAULT_MAX_SUPPLY_APY),
              lt(table.observedAt, args.start)
            )
          )
          .orderBy(desc(table.observedAt))
          .limit(1)
      )
    );
    const rangeRows = await this.db
      .select()
      .from(table)
      .where(
        and(
          inArray(table.reserve, [...args.reserves]),
          eq(table.reserveLastUpdateStale, false),
          gt(
            table.totalSupplyUsdEstimate,
            DEFAULT_MIN_TOTAL_SUPPLY_USD_ESTIMATE
          ),
          gte(table.supplyApy, 0),
          lt(table.supplyApy, DEFAULT_MAX_SUPPLY_APY),
          gte(table.observedAt, args.start),
          lte(table.observedAt, args.end)
        )
      )
      .orderBy(asc(table.observedAt), asc(table.reserve));

    return [...previousRows.flat(), ...rangeRows].sort(
      (a, b) =>
        a.observedAt.getTime() - b.observedAt.getTime() ||
        a.reserve.localeCompare(b.reserve)
    );
  }

  async getReserveApyHistory(args: {
    end: Date;
    reserve: string;
    start: Date;
  }): Promise<TimescaleReserveUpdateRow[]> {
    const table = this.tables.reserveUpdates;
    const validReserveFilter = and(
      eq(table.reserve, args.reserve),
      eq(table.reserveLastUpdateStale, false),
      gte(table.supplyApy, 0),
      lt(table.supplyApy, DEFAULT_MAX_SUPPLY_APY)
    );
    const previousRows = await this.db
      .select()
      .from(table)
      .where(and(validReserveFilter, lt(table.observedAt, args.start)))
      .orderBy(desc(table.observedAt))
      .limit(1);
    const rangeRows = await this.db
      .select()
      .from(table)
      .where(
        and(
          validReserveFilter,
          gte(table.observedAt, args.start),
          lte(table.observedAt, args.end)
        )
      )
      .orderBy(asc(table.observedAt));

    return [...previousRows, ...rangeRows].sort(
      (a, b) => a.observedAt.getTime() - b.observedAt.getTime()
    );
  }

  async getReserveApyHistorySamples(args: {
    end: Date;
    reserve: string;
    sampleIntervalSeconds?: number;
    start: Date;
  }): Promise<TimescaleReserveApySample[]> {
    const sampleIntervalSeconds = args.sampleIntervalSeconds ?? 24 * 60 * 60;
    const endIso = args.end.toISOString();
    const startIso = args.start.toISOString();
    const rows = await this.sqlClient<
      { observed_at: Date | string; supply_apy: number | string }[]
    >`
      WITH previous_sample AS (
        SELECT observed_at, supply_apy
        FROM kamino.reserve_updates
        WHERE reserve = ${args.reserve}
          AND reserve_last_update_stale = false
          AND supply_apy >= 0
          AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
          AND observed_at < ${startIso}::timestamptz
        ORDER BY observed_at DESC
        LIMIT 1
      ),
      latest_sample AS (
        SELECT observed_at, supply_apy
        FROM kamino.reserve_updates
        WHERE reserve = ${args.reserve}
          AND reserve_last_update_stale = false
          AND supply_apy >= 0
          AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
          AND observed_at <= ${endIso}::timestamptz
        ORDER BY observed_at DESC
        LIMIT 1
      ),
      range_candidates AS (
        SELECT
          date_bin(
            make_interval(secs => ${sampleIntervalSeconds}),
            observed_at,
            ${startIso}::timestamptz
          ) AS sample_bucket,
          observed_at,
          supply_apy
        FROM kamino.reserve_updates
        WHERE reserve = ${args.reserve}
          AND reserve_last_update_stale = false
          AND supply_apy >= 0
          AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
          AND observed_at >= ${startIso}::timestamptz
          AND observed_at <= ${endIso}::timestamptz
      ),
      range_samples AS (
        SELECT DISTINCT ON (sample_bucket)
          observed_at,
          supply_apy
        FROM range_candidates
        ORDER BY
          sample_bucket,
          observed_at DESC
      )
      SELECT observed_at, supply_apy
      FROM (
        SELECT observed_at, supply_apy FROM previous_sample
        UNION
        SELECT observed_at, supply_apy FROM range_samples
        UNION
        SELECT observed_at, supply_apy FROM latest_sample
      ) samples
      ORDER BY observed_at ASC
    `;

    return rows.map((row) => ({
      observedAt:
        row.observed_at instanceof Date
          ? row.observed_at
          : new Date(row.observed_at),
      supplyApy: Number(row.supply_apy),
    }));
  }

  async getReserveApyHistorySamplesForReserves(args: {
    end: Date;
    reserves: readonly string[];
    sampleIntervalSeconds?: number;
    start: Date;
  }): Promise<(TimescaleReserveApySample & { reserve: string })[]> {
    const reserves = [...new Set(args.reserves)].sort();
    if (reserves.length === 0) {
      return [];
    }

    const sampleIntervalSeconds = args.sampleIntervalSeconds ?? 24 * 60 * 60;
    const endIso = args.end.toISOString();
    const startIso = args.start.toISOString();
    const rows = await this.sqlClient<
      {
        observed_at: Date | string;
        reserve: string;
        supply_apy: number | string;
      }[]
    >`
      WITH requested_reserves AS (
        SELECT unnest(${reserves}::text[]) AS reserve
      ),
      previous_samples AS (
        SELECT r.reserve, sample.observed_at, sample.supply_apy
        FROM requested_reserves r
        CROSS JOIN LATERAL (
          SELECT observed_at, supply_apy
          FROM kamino.reserve_updates
          WHERE reserve = r.reserve
            AND reserve_last_update_stale = false
            AND supply_apy >= 0
            AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
            AND observed_at < ${startIso}::timestamptz
          ORDER BY observed_at DESC
          LIMIT 1
        ) sample
      ),
      latest_samples AS (
        SELECT r.reserve, sample.observed_at, sample.supply_apy
        FROM requested_reserves r
        CROSS JOIN LATERAL (
          SELECT observed_at, supply_apy
          FROM kamino.reserve_updates
          WHERE reserve = r.reserve
            AND reserve_last_update_stale = false
            AND supply_apy >= 0
            AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
            AND observed_at <= ${endIso}::timestamptz
          ORDER BY observed_at DESC
          LIMIT 1
        ) sample
      ),
      range_candidates AS (
        SELECT
          reserve,
          date_bin(
            make_interval(secs => ${sampleIntervalSeconds}),
            observed_at,
            ${startIso}::timestamptz
          ) AS sample_bucket,
          observed_at,
          supply_apy
        FROM kamino.reserve_updates
        WHERE reserve = ANY(${reserves}::text[])
          AND reserve_last_update_stale = false
          AND supply_apy >= 0
          AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
          AND observed_at >= ${startIso}::timestamptz
          AND observed_at <= ${endIso}::timestamptz
      ),
      range_samples AS (
        SELECT DISTINCT ON (reserve, sample_bucket)
          reserve,
          observed_at,
          supply_apy
        FROM range_candidates
        ORDER BY reserve, sample_bucket, observed_at DESC
      )
      SELECT reserve, observed_at, supply_apy
      FROM (
        SELECT reserve, observed_at, supply_apy FROM previous_samples
        UNION
        SELECT reserve, observed_at, supply_apy FROM range_samples
        UNION
        SELECT reserve, observed_at, supply_apy FROM latest_samples
      ) samples
      ORDER BY observed_at ASC, reserve ASC
    `;

    return rows.map((row) => ({
      observedAt:
        row.observed_at instanceof Date
          ? row.observed_at
          : new Date(row.observed_at),
      reserve: row.reserve,
      supplyApy: Number(row.supply_apy),
    }));
  }

  async getCurrentReserveUpdatesByReserve(args: {
    reserves: readonly string[];
  }): Promise<TimescaleReserveUpdateRow[]> {
    if (args.reserves.length === 0) {
      return [];
    }

    const reserveUpdates = this.tables.reserveUpdates;
    const latestReserveUpdates = this.tables.latestReserveUpdates;

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
          gte(reserveUpdates.supplyApy, 0),
          lt(reserveUpdates.supplyApy, DEFAULT_MAX_SUPPLY_APY),
          inArray(reserveUpdates.reserve, [...new Set(args.reserves)])
        )
      )
      .orderBy(asc(reserveUpdates.reserve));

    return rows.map((row) => row.reserve_updates);
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
