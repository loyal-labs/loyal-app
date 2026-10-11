import "server-only";

import {
  RISK_BASKET_MARKETS,
  STABLECOIN_MINTS,
  STABLECOINS,
} from "@loyal-labs/actions/constants";
import { RiskBasket, type Stablecoin } from "@loyal-labs/actions/types";
import { Connection } from "@solana/web3.js";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import postgres, { type Sql } from "postgres";

import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

const DEFAULT_MAX_CONNECTIONS = 5;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 5;

const kaminoTimescaleSchema = pgSchema("kamino");

export const timescaleReserveUpdates = kaminoTimescaleSchema.table(
  "reserve_updates",
  {
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    accountDataHash: text("account_data_hash").notNull(),
    sourceCommitment: text("source_commitment").notNull(),
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

export const timescaleReserveCurrentStates = kaminoTimescaleSchema.table(
  "reserve_current_states",
  {
    reserve: text("reserve").notNull(),
    stateEventId: bigint("state_event_id", { mode: "bigint" }).notNull(),
    accountDataHash: text("account_data_hash").notNull(),
    stateSlot: bigint("state_slot", { mode: "number" }).notNull(),
    stateObservedAt: timestamp("state_observed_at", {
      withTimezone: true,
    }).notNull(),
    stateSource: text("state_source").notNull(),
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
  getBlockTime?: (slot: number) => Promise<number | null>;
};

export type TimescaleReserveClientTables = {
  latestReserveUpdates: typeof timescaleLatestReserveUpdates;
  reserveCurrentStates: typeof timescaleReserveCurrentStates;
  reserveUpdates: typeof timescaleReserveUpdates;
  supportedReserves: typeof timescaleSupportedReserves;
};

// Keep the public row/JSON contract unchanged. Capture identities are only
// needed to join the current pointer to its exact confirmed observation.
const reserveUpdateColumns = {
  observedAt: timescaleReserveUpdates.observedAt,
  slot: timescaleReserveUpdates.slot,
  source: timescaleReserveUpdates.source,
  reserve: timescaleReserveUpdates.reserve,
  market: timescaleReserveUpdates.market,
  marketName: timescaleReserveUpdates.marketName,
  symbol: timescaleReserveUpdates.symbol,
  liquidityMint: timescaleReserveUpdates.liquidityMint,
  supplyApy: timescaleReserveUpdates.supplyApy,
  borrowApy: timescaleReserveUpdates.borrowApy,
  utilization: timescaleReserveUpdates.utilization,
  totalSupplyUsdEstimate: timescaleReserveUpdates.totalSupplyUsdEstimate,
  totalBorrowUsdEstimate: timescaleReserveUpdates.totalBorrowUsdEstimate,
  reserveLastUpdateStale: timescaleReserveUpdates.reserveLastUpdateStale,
  diffChanged: timescaleReserveUpdates.diffChanged,
  changedFields: timescaleReserveUpdates.changedFields,
  diffSummary: timescaleReserveUpdates.diffSummary,
};
export type TimescaleReserveUpdateRow = Omit<
  typeof timescaleReserveUpdates.$inferSelect,
  "eventId" | "accountDataHash" | "sourceCommitment"
>;
export type TimescaleReservePresenceRow = Pick<
  TimescaleReserveUpdateRow,
  "observedAt" | "reserve" | "totalSupplyUsdEstimate"
>;

export type TimescaleReserveApySample = Pick<
  TimescaleReserveUpdateRow,
  "observedAt" | "supplyApy"
>;
export type CurrentBestApyReserveByStablecoin = TimescaleReserveUpdateRow & {
  stablecoin: Stablecoin;
};
export type CurrentEligibleSafeReserve = CurrentBestApyReserveByStablecoin;

const DEFAULT_MIN_TOTAL_SUPPLY_USD_ESTIMATE = 100_000;
const DEFAULT_MAX_SUPPLY_APY = 0.5;
// Bound both receipt age and the frontier's actual chain age. The observer
// timestamps replays when received, so receipt alone cannot prove catch-up.
const RESERVE_STREAM_MAX_AGE_MS = 240 * 1000;

let reserveBlockTimeConnection: Connection | undefined;

function getMainnetReserveBlockTime(slot: number): Promise<number | null> {
  reserveBlockTimeConnection ??= new Connection(
    getServerSolanaEndpoints("mainnet").rpcEndpoint,
    {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
      fetchMiddleware: (input, init, next) =>
        next(input, {
          ...init,
          signal: AbortSignal.timeout(5000),
        }),
    }
  );
  return reserveBlockTimeConnection.getBlockTime(slot);
}

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

export function selectCurrentEligibleSafeReserves(
  rows: readonly TimescaleReserveUpdateRow[]
): CurrentEligibleSafeReserve[] {
  return rows.flatMap((row) => {
    const stablecoin = stablecoinByLiquidityMint.get(row.liquidityMint);
    return stablecoin ? [{ ...row, stablecoin }] : [];
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

export async function getCurrentEligibleSafeReserves(args: {
  riskProfile: RiskBasket;
}): Promise<CurrentEligibleSafeReserve[] | null> {
  const databaseUrl = getTimescaleReserveDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const client = new TimescaleReserveClient({ databaseUrl, maxConnections: 1 });
  try {
    return await client.getCurrentEligibleSafeReserves(args);
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

// Returns null (not []) when the Timescale feed is not configured so
// eligibility callers can tell "feed unavailable" from "reserve was never
// sampled" — the latter is what marks hidden/untracked reserves ineligible.
export async function getLatestReserveObservationsByReserve(args: {
  reserves: readonly string[];
}): Promise<TimescaleReservePresenceRow[] | null> {
  const databaseUrl = getTimescaleReserveDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const client = new TimescaleReserveClient({ databaseUrl, maxConnections: 1 });
  try {
    return await client.getLatestReserveObservationsByReserve(args);
  } finally {
    await client.close();
  }
}

export class TimescaleReserveClient {
  readonly db: PostgresJsDatabase;
  readonly tables: TimescaleReserveClientTables = {
    latestReserveUpdates: timescaleLatestReserveUpdates,
    reserveCurrentStates: timescaleReserveCurrentStates,
    reserveUpdates: timescaleReserveUpdates,
    supportedReserves: timescaleSupportedReserves,
  };

  private readonly sqlClient: Sql;
  private readonly getBlockTime: (slot: number) => Promise<number | null>;

  constructor(config: TimescaleReserveClientConfig) {
    this.getBlockTime = config.getBlockTime ?? getMainnetReserveBlockTime;
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

  private async isRecentChainFrontier(
    slot: number | undefined
  ): Promise<boolean> {
    if (slot === undefined || !Number.isSafeInteger(slot) || slot <= 0) {
      return false;
    }
    try {
      const blockTime = await this.getBlockTime(slot);
      if (
        blockTime === null ||
        !Number.isSafeInteger(blockTime) ||
        blockTime <= 0
      ) {
        return false;
      }
      // Evaluate after the RPC completes so a delayed response cannot renew
      // evidence that expired in flight. No cached eligibility verdicts.
      const ageMs = Date.now() - blockTime * 1000;
      return ageMs >= 0 && ageMs <= RESERVE_STREAM_MAX_AGE_MS;
    } catch {
      console.error(
        "[kamino-reserves] stream frontier block time unavailable",
        { slot }
      );
      return false;
    }
  }

  private currentConfirmedReserves() {
    const { reserveUpdates, reserveCurrentStates, supportedReserves } =
      this.tables;
    // Join by the complete observation identity, including observed_at for
    // Timescale chunk pruning, instead of expanding latest_reserve_updates.
    const current = this.db.$with("confirmed_current_reserves").as(
      this.db
        .select(reserveUpdateColumns)
        .from(reserveCurrentStates)
        .innerJoin(
          reserveUpdates,
          and(
            eq(reserveUpdates.reserve, reserveCurrentStates.reserve),
            eq(reserveUpdates.observedAt, reserveCurrentStates.stateObservedAt),
            eq(reserveUpdates.eventId, reserveCurrentStates.stateEventId),
            eq(reserveUpdates.slot, reserveCurrentStates.stateSlot),
            eq(
              reserveUpdates.accountDataHash,
              reserveCurrentStates.accountDataHash
            ),
            eq(reserveUpdates.source, reserveCurrentStates.stateSource)
          )
        )
        .innerJoin(
          supportedReserves,
          and(
            eq(supportedReserves.reserve, reserveUpdates.reserve),
            eq(supportedReserves.market, reserveUpdates.market),
            eq(supportedReserves.liquidityMint, reserveUpdates.liquidityMint),
            eq(supportedReserves.active, true)
          )
        )
        .where(
          and(
            eq(reserveUpdates.sourceCommitment, "confirmed"),
            inArray(reserveUpdates.source, [
              "laserstream_grpc",
              "http_snapshot",
              "http_confirmed_refresh",
            ])
          )
        )
    );
    // Compute progress before narrowing to a requested mint/reserve: a quiet
    // venue is still current while the observer receives other reserve updates.
    const frontier = this.db
      .$with("reserve_stream_frontier")
      .as(
        this.db
          .select({ observedAt: current.observedAt, slot: current.slot })
          .from(current)
          .orderBy(desc(current.slot), desc(current.observedAt))
          .limit(1)
      );
    // Use the database statement clock: rows committed while the connection
    // opens are not future observations relative to this query's snapshot.
    const now = sql`statement_timestamp()`;
    const freshness = and(
      gte(
        frontier.observedAt,
        sql`${now} - ${RESERVE_STREAM_MAX_AGE_MS} * interval '1 millisecond'`
      ),
      lte(frontier.observedAt, now),
      lte(current.observedAt, now)
    );
    return { current, frontier, freshness };
  }

  async getSafeNoFeeReserveUpdates(args: {
    marketNames: readonly string[];
    stableSymbols: readonly string[];
    since: Date;
  }): Promise<TimescaleReserveUpdateRow[]> {
    const table = this.tables.reserveUpdates;

    return this.db
      .select(reserveUpdateColumns)
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
      .select(reserveUpdateColumns)
      .from(table)
      .where(and(validReserveFilter, lt(table.observedAt, args.start)))
      .orderBy(desc(table.observedAt))
      .limit(1);
    const rangeRows = await this.db
      .select(reserveUpdateColumns)
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
          -- Union the indexer stream with the curated API backfill
          -- (kamino.reserve_apy_backfill) per branch so each side keeps its
          -- own index-backed ORDER BY ... LIMIT 1 instead of materializing
          -- the full sample set. Backfill covers reserves the indexer never
          -- sampled (e.g. hidden reserves a position historically held);
          -- earnings coverage is the only path that reads it.
          SELECT observed_at, supply_apy
          FROM (
            (
              SELECT observed_at, supply_apy
              FROM kamino.reserve_updates
              WHERE reserve = r.reserve
                AND reserve_last_update_stale = false
                AND supply_apy >= 0
                AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
                AND observed_at < ${startIso}::timestamptz
              ORDER BY observed_at DESC
              LIMIT 1
            )
            UNION ALL
            (
              SELECT observed_at, supply_apy
              FROM kamino.reserve_apy_backfill
              WHERE reserve = r.reserve
                AND supply_apy >= 0
                AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
                AND observed_at < ${startIso}::timestamptz
              ORDER BY observed_at DESC
              LIMIT 1
            )
          ) candidates
          ORDER BY observed_at DESC
          LIMIT 1
        ) sample
      ),
      latest_samples AS (
        SELECT r.reserve, sample.observed_at, sample.supply_apy
        FROM requested_reserves r
        CROSS JOIN LATERAL (
          SELECT observed_at, supply_apy
          FROM (
            (
              SELECT observed_at, supply_apy
              FROM kamino.reserve_updates
              WHERE reserve = r.reserve
                AND reserve_last_update_stale = false
                AND supply_apy >= 0
                AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
                AND observed_at <= ${endIso}::timestamptz
              ORDER BY observed_at DESC
              LIMIT 1
            )
            UNION ALL
            (
              SELECT observed_at, supply_apy
              FROM kamino.reserve_apy_backfill
              WHERE reserve = r.reserve
                AND supply_apy >= 0
                AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
                AND observed_at <= ${endIso}::timestamptz
              ORDER BY observed_at DESC
              LIMIT 1
            )
          ) candidates
          ORDER BY observed_at DESC
          LIMIT 1
        ) sample
      ),
      -- One index probe per reserve × bucket instead of scanning every raw
      -- row in the window: months of reserve_updates collapse to a handful
      -- of binned samples, and the raw scan took tens of seconds against the
      -- 8s earnings budget (ASK-2209). Buckets are anchored at start, so
      -- they match the previous date_bin(..., start) binning; each LATERAL
      -- keeps the same validity filters and picks the latest sample in the
      -- bucket, like DISTINCT ON ... ORDER BY observed_at DESC did.
      range_samples AS (
        SELECT r.reserve, sample.observed_at, sample.supply_apy
        FROM requested_reserves r
        CROSS JOIN generate_series(
          ${startIso}::timestamptz,
          ${endIso}::timestamptz,
          make_interval(secs => ${sampleIntervalSeconds})
        ) AS bucket(bucket_start)
        CROSS JOIN LATERAL (
          SELECT observed_at, supply_apy
          FROM (
            (
              SELECT observed_at, supply_apy
              FROM kamino.reserve_updates
              WHERE reserve = r.reserve
                AND reserve_last_update_stale = false
                AND supply_apy >= 0
                AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
                AND observed_at >= bucket.bucket_start
                AND observed_at <
                  bucket.bucket_start
                    + make_interval(secs => ${sampleIntervalSeconds})
                AND observed_at <= ${endIso}::timestamptz
              ORDER BY observed_at DESC
              LIMIT 1
            )
            UNION ALL
            (
              SELECT observed_at, supply_apy
              FROM kamino.reserve_apy_backfill
              WHERE reserve = r.reserve
                AND supply_apy >= 0
                AND supply_apy < ${DEFAULT_MAX_SUPPLY_APY}
                AND observed_at >= bucket.bucket_start
                AND observed_at <
                  bucket.bucket_start
                    + make_interval(secs => ${sampleIntervalSeconds})
                AND observed_at <= ${endIso}::timestamptz
              ORDER BY observed_at DESC
              LIMIT 1
            )
          ) candidates
          ORDER BY observed_at DESC
          LIMIT 1
        ) sample
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
      .select(reserveUpdateColumns)
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

    return rows;
  }

  async getLatestReserveObservationsByReserve(args: {
    reserves: readonly string[];
  }): Promise<TimescaleReservePresenceRow[]> {
    if (args.reserves.length === 0) {
      return [];
    }

    const { current, frontier, freshness } = this.currentConfirmedReserves();

    // Deliberately no stale-flag or APY-bounds filters: presence in the
    // observer's active current state is the eligibility signal (a hidden
    // reserve is never sampled at all), and a transiently stale row must not fail
    // deposits — that flakiness is why #381 removed the old APY-ranked
    // picker.
    const rows = await this.db
      .with(current, frontier)
      .select({
        observation: {
          observedAt: current.observedAt,
          reserve: current.reserve,
          totalSupplyUsdEstimate: current.totalSupplyUsdEstimate,
        },
        frontierSlot: frontier.slot,
      })
      .from(current)
      .innerJoin(frontier, freshness)
      .where(inArray(current.reserve, [...new Set(args.reserves)]))
      .orderBy(asc(current.reserve));

    if (!(await this.isRecentChainFrontier(rows[0]?.frontierSlot))) {
      return [];
    }
    return rows.map((row) => row.observation);
  }

  async getCurrentBestApyReserveByStablecoin(args: {
    riskProfile: RiskBasket;
    minTotalSupplyUsdEstimate?: number;
    maxSupplyApy?: number;
  }): Promise<CurrentBestApyReserveByStablecoin[]> {
    if (!Object.values(RiskBasket).includes(args.riskProfile)) {
      throw new Error(`unsupported risk profile: ${String(args.riskProfile)}`);
    }

    return selectCurrentBestApyReserveByStablecoin(
      await this.getCurrentEligibleSafeReserves(args)
    );
  }

  async getCurrentEligibleSafeReserves(args: {
    riskProfile: RiskBasket;
    minTotalSupplyUsdEstimate?: number;
    maxSupplyApy?: number;
  }): Promise<CurrentEligibleSafeReserve[]> {
    if (!Object.values(RiskBasket).includes(args.riskProfile)) {
      throw new Error(`unsupported risk profile: ${String(args.riskProfile)}`);
    }

    const { current, frontier, freshness } = this.currentConfirmedReserves();
    const marketAddresses = RISK_BASKET_MARKETS[args.riskProfile].map(
      (market) => market.toBase58()
    );
    const stablecoinLiquidityMints = STABLECOINS.map((stablecoin) =>
      STABLECOIN_MINTS[stablecoin].toBase58()
    );

    const rows = await this.db
      .with(current, frontier)
      .select()
      .from(current)
      .innerJoin(frontier, freshness)
      .where(
        and(
          gt(
            current.totalSupplyUsdEstimate,
            args.minTotalSupplyUsdEstimate ??
              DEFAULT_MIN_TOTAL_SUPPLY_USD_ESTIMATE
          ),
          gte(current.supplyApy, 0),
          lt(current.supplyApy, args.maxSupplyApy ?? DEFAULT_MAX_SUPPLY_APY),
          inArray(current.market, marketAddresses),
          inArray(current.liquidityMint, stablecoinLiquidityMints)
        )
      )
      .orderBy(desc(current.supplyApy));

    if (
      !(await this.isRecentChainFrontier(rows[0]?.reserve_stream_frontier.slot))
    ) {
      return [];
    }
    return selectCurrentEligibleSafeReserves(
      rows.map((row) => row.confirmed_current_reserves)
    );
  }
}
