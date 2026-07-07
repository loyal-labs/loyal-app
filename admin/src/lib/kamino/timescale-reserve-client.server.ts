import "server-only";

import { neon } from "@neondatabase/serverless";
import { and, eq, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import { serverEnv } from "@/lib/core/config/server";
import {
  type SafeReserveApyChartPoint,
  type SafeReserveApyMonitorData,
  type SafeReserveApySeries,
  type SafeReserveApyStatus,
  type SafeReserveApyStatusRow,
} from "@/lib/kamino/timescale-reserve-monitor.shared";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SAMPLE_INTERVAL_SECONDS = 5 * 60;
const MIN_TOTAL_SUPPLY_USD = 100_000;
const MAX_SUPPLY_APY = 0.5;
const SAFE_RISK_BASKET = "safe";
const USDC_LIQUIDITY_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const EXCLUDED_GRAPH_RESERVES = new Set([
  "CAPsU1H49e6WuiQdte1ZU6zJaSGWXBSogAa1w6mhiKo2",
]);
const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_CACHE_TTL_MS = 15 * 60 * 1000;

const kaminoSchema = pgSchema("kamino");

const supportedReserves = kaminoSchema.table("supported_reserves", {
  active: boolean("active").notNull(),
  liquidityMint: text("liquidity_mint").notNull(),
  market: text("market").notNull(),
  marketName: text("market_name"),
  reserve: text("reserve").notNull(),
  riskBaskets: text("risk_baskets").array().notNull(),
  symbol: text("symbol"),
});

const latestReserveUpdates = kaminoSchema.table("latest_reserve_updates", {
  liquidityMint: text("liquidity_mint").notNull(),
  market: text("market"),
  marketName: text("market_name"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  reserve: text("reserve").notNull(),
  reserveLastUpdateStale: boolean("reserve_last_update_stale").notNull(),
  supplyApy: doublePrecision("supply_apy").notNull(),
  symbol: text("symbol"),
  totalSupplyUsdEstimate: doublePrecision(
    "total_supply_usd_estimate"
  ).notNull(),
});

type KaminoTimescaleDb = NeonHttpDatabase;

type CurrentCandidateRow = {
  liquidityMint: string;
  market: string;
  marketName: string | null;
  observedAt: Date | string | null;
  reserve: string;
  reserveLastUpdateStale: boolean | null;
  supplyApy: number | null;
  symbol: string | null;
  totalSupplyUsdEstimate: number | null;
};

type HistoryRow = {
  observed_at: Date | string;
  reserve: string;
  supply_apy: number | string;
};

let timescaleDb: KaminoTimescaleDb | null = null;
let monitorDataCache: {
  expiresAt: number;
  staleUntil: number;
  value: SafeReserveApyMonitorData;
} | null = null;
let monitorDataPromise: Promise<SafeReserveApyMonitorData> | null = null;

export function getKaminoTimescaleDb(): KaminoTimescaleDb {
  if (timescaleDb) {
    return timescaleDb;
  }

  timescaleDb = drizzle(neon(serverEnv.timescaleDatabaseUrl));
  return timescaleDb;
}

function toIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toApyPercent(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value * 100
    : null;
}

function classifyCandidate(row: CurrentCandidateRow): SafeReserveApyStatus {
  if (row.observedAt === null) {
    return "no-current-row";
  }

  if (row.reserveLastUpdateStale !== false) {
    return "stale";
  }

  if (
    typeof row.totalSupplyUsdEstimate !== "number" ||
    row.totalSupplyUsdEstimate <= MIN_TOTAL_SUPPLY_USD
  ) {
    return "below-liquidity";
  }

  if (
    typeof row.supplyApy !== "number" ||
    row.supplyApy < 0 ||
    row.supplyApy >= MAX_SUPPLY_APY
  ) {
    return "apy-out-of-range";
  }

  return "eligible";
}

function compareStrings(left: string | null, right: string | null) {
  return (left ?? "").localeCompare(right ?? "", "en-US");
}

function toSqlStringLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function toSqlTextArrayLiteral(values: readonly string[]) {
  return `ARRAY[${values.map(toSqlStringLiteral).join(", ")}]::text[]`;
}

function getReserveLabel(row: SafeReserveApyStatusRow) {
  if (row.marketName) {
    return row.marketName;
  }

  if (row.market) {
    return row.market;
  }

  return `${row.reserve.slice(0, 4)}...${row.reserve.slice(-4)}`;
}

function createStatusRows(
  rows: readonly CurrentCandidateRow[]
): SafeReserveApyStatusRow[] {
  return rows
    .map((row) => ({
      average24hApyPercent: null,
      average7dApyPercent: null,
      latestObservedAt: toIsoString(row.observedAt),
      liquidityMint: row.liquidityMint,
      market: row.market,
      marketName: row.marketName,
      reserve: row.reserve,
      status: classifyCandidate(row),
      supplyApyPercent: toApyPercent(row.supplyApy),
      symbol: row.symbol,
      totalSupplyUsdEstimate: row.totalSupplyUsdEstimate,
    }))
    .sort((left, right) => {
      const marketNameDelta = compareStrings(left.marketName, right.marketName);
      if (marketNameDelta !== 0) {
        return marketNameDelta;
      }

      const marketDelta = compareStrings(left.market, right.market);
      if (marketDelta !== 0) {
        return marketDelta;
      }

      return compareStrings(left.reserve, right.reserve);
    });
}

async function loadCurrentCandidates(
  db: KaminoTimescaleDb
): Promise<CurrentCandidateRow[]> {
  const rows = await db
    .select({
      liquidityMint: supportedReserves.liquidityMint,
      market: supportedReserves.market,
      marketName: supportedReserves.marketName,
      observedAt: latestReserveUpdates.observedAt,
      reserve: supportedReserves.reserve,
      reserveLastUpdateStale: latestReserveUpdates.reserveLastUpdateStale,
      supplyApy: latestReserveUpdates.supplyApy,
      symbol: supportedReserves.symbol,
      totalSupplyUsdEstimate: latestReserveUpdates.totalSupplyUsdEstimate,
    })
    .from(supportedReserves)
    .leftJoin(
      latestReserveUpdates,
      and(
        eq(latestReserveUpdates.reserve, supportedReserves.reserve),
        eq(latestReserveUpdates.market, supportedReserves.market),
        eq(latestReserveUpdates.liquidityMint, supportedReserves.liquidityMint)
      )
    )
    .where(
      and(
        eq(supportedReserves.active, true),
        eq(supportedReserves.liquidityMint, USDC_LIQUIDITY_MINT),
        sql`${SAFE_RISK_BASKET} = ANY(${supportedReserves.riskBaskets})`
      )
    );

  return rows;
}

async function loadApyHistoryRows(args: {
  db: KaminoTimescaleDb;
  endedAt: Date;
  reserves: readonly string[];
  startedAt: Date;
}): Promise<HistoryRow[]> {
  if (args.reserves.length === 0) {
    return [];
  }

  const reserveIds = [...new Set(args.reserves)];
  const startIso = args.startedAt.toISOString();
  const endIso = args.endedAt.toISOString();
  const startTimestamp = sql.raw(
    `${toSqlStringLiteral(startIso)}::timestamptz`
  );
  const endTimestamp = sql.raw(`${toSqlStringLiteral(endIso)}::timestamptz`);
  const reserveArray = sql.raw(toSqlTextArrayLiteral(reserveIds));

  const result = await args.db.execute(sql<HistoryRow>`
    WITH reserve_ids AS (
      SELECT unnest(${reserveArray}) AS reserve
    ),
    previous_samples AS (
      SELECT
        ${startTimestamp} AS observed_at,
        reserve_ids.reserve,
        previous.supply_apy
      FROM reserve_ids
      LEFT JOIN LATERAL (
        SELECT updates.supply_apy
        FROM kamino.reserve_updates AS updates
        WHERE updates.reserve = reserve_ids.reserve
          AND updates.observed_at < ${startTimestamp}
          AND updates.reserve_last_update_stale = false
          AND updates.supply_apy >= 0
          AND updates.supply_apy < ${MAX_SUPPLY_APY}
        ORDER BY updates.observed_at DESC
        LIMIT 1
      ) previous ON true
      WHERE previous.supply_apy IS NOT NULL
    ),
    range_candidates AS (
      SELECT
        date_bin(
          make_interval(secs => ${SAMPLE_INTERVAL_SECONDS}),
          updates.observed_at,
          ${startTimestamp}
        ) AS sample_bucket,
        updates.observed_at,
        updates.reserve,
        updates.supply_apy
      FROM kamino.reserve_updates AS updates
      WHERE updates.reserve = ANY(${reserveArray})
        AND updates.observed_at >= ${startTimestamp}
        AND updates.observed_at <= ${endTimestamp}
        AND updates.reserve_last_update_stale = false
        AND updates.supply_apy >= 0
        AND updates.supply_apy < ${MAX_SUPPLY_APY}
    ),
    range_samples AS (
      SELECT DISTINCT ON (reserve, sample_bucket)
        sample_bucket AS observed_at,
        reserve,
        supply_apy
      FROM range_candidates
      ORDER BY reserve, sample_bucket, observed_at DESC
    )
    SELECT observed_at, reserve, supply_apy
    FROM (
      SELECT observed_at, reserve, supply_apy, 0 AS sample_order
      FROM previous_samples
      UNION ALL
      SELECT observed_at, reserve, supply_apy, 1 AS sample_order
      FROM range_samples
    ) samples
    ORDER BY observed_at ASC, reserve ASC, sample_order ASC
  `);

  return result.rows as HistoryRow[];
}

function createChartPoints(args: {
  endedAt: Date;
  historyRows: readonly HistoryRow[];
  series: readonly SafeReserveApySeries[];
  startedAt: Date;
}): SafeReserveApyChartPoint[] {
  const rowsByReserve = new Map<string, HistoryRow[]>();

  for (const row of args.historyRows) {
    const rows = rowsByReserve.get(row.reserve) ?? [];
    rows.push(row);
    rowsByReserve.set(row.reserve, rows);
  }

  for (const rows of rowsByReserve.values()) {
    rows.sort(
      (left, right) =>
        new Date(left.observed_at).getTime() -
        new Date(right.observed_at).getTime()
    );
  }

  const intervalMs = SAMPLE_INTERVAL_SECONDS * 1000;
  const bucketCount =
    Math.floor(
      (args.endedAt.getTime() - args.startedAt.getTime()) / intervalMs
    ) + 1;
  const rowIndexesByReserve = new Map<string, number>();
  const currentApyByKey = new Map<string, number>();
  const points: SafeReserveApyChartPoint[] = [];

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const bucketTime = args.startedAt.getTime() + bucketIndex * intervalMs;
    const point: SafeReserveApyChartPoint = {
      observedAt: new Date(bucketTime).toISOString(),
      observedAtMs: bucketTime,
    };

    for (const series of args.series) {
      const rows = rowsByReserve.get(series.reserve) ?? [];
      let rowIndex = rowIndexesByReserve.get(series.reserve) ?? 0;

      while (
        rowIndex < rows.length &&
        new Date(rows[rowIndex].observed_at).getTime() <= bucketTime
      ) {
        const supplyApy = Number(rows[rowIndex].supply_apy);
        if (Number.isFinite(supplyApy)) {
          currentApyByKey.set(series.key, supplyApy * 100);
        }
        rowIndex += 1;
      }

      rowIndexesByReserve.set(series.reserve, rowIndex);
      point[series.key] = currentApyByKey.get(series.key) ?? null;
    }

    points.push(point);
  }

  return points;
}

function createSeries(
  statuses: readonly SafeReserveApyStatusRow[]
): SafeReserveApySeries[] {
  return statuses.map((row, index) => ({
    key: `reserve${index + 1}`,
    label: getReserveLabel(row),
    marketName: row.marketName,
    reserve: row.reserve,
  }));
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function withApySummaries(args: {
  chartPoints: readonly SafeReserveApyChartPoint[];
  endedAt: Date;
  series: readonly SafeReserveApySeries[];
  statuses: readonly SafeReserveApyStatusRow[];
}): SafeReserveApyStatusRow[] {
  const seriesByReserve = new Map(
    args.series.map((series) => [series.reserve, series])
  );
  const dayStartedAtMs = args.endedAt.getTime() - 24 * 60 * 60 * 1000;

  return args.statuses.map((status) => {
    const series = seriesByReserve.get(status.reserve);
    if (!series) {
      return status;
    }

    const values7d: number[] = [];
    const values24h: number[] = [];

    for (const point of args.chartPoints) {
      const value = point[series.key];
      if (typeof value !== "number") {
        continue;
      }

      values7d.push(value);
      if (
        typeof point.observedAtMs === "number" &&
        point.observedAtMs >= dayStartedAtMs
      ) {
        values24h.push(value);
      }
    }

    return {
      ...status,
      average24hApyPercent: average(values24h),
      average7dApyPercent: average(values7d),
    };
  });
}

async function loadSafeReserveApyMonitorData(
  now = new Date()
): Promise<SafeReserveApyMonitorData> {
  const db = getKaminoTimescaleDb();
  const endedAt = now;
  const startedAt = new Date(endedAt.getTime() - WINDOW_MS);
  const currentRows = await loadCurrentCandidates(db);
  const baseStatuses = createStatusRows(currentRows).filter(
    (status) => !EXCLUDED_GRAPH_RESERVES.has(status.reserve)
  );
  const series = createSeries(baseStatuses);
  const historyRows = await loadApyHistoryRows({
    db,
    endedAt,
    reserves: series.map((item) => item.reserve),
    startedAt,
  });
  const chartPoints = createChartPoints({
    endedAt,
    historyRows,
    series,
    startedAt,
  });
  const statuses = withApySummaries({
    chartPoints,
    endedAt,
    series,
    statuses: baseStatuses,
  });

  const data: SafeReserveApyMonitorData = {
    chartPoints,
    generatedAt: now.toISOString(),
    sampleIntervalMinutes: SAMPLE_INTERVAL_SECONDS / 60,
    series,
    statuses,
    window: {
      endedAt: endedAt.toISOString(),
      startedAt: startedAt.toISOString(),
    },
  };

  return data;
}

export async function getSafeReserveApyMonitorData(
  now?: Date
): Promise<SafeReserveApyMonitorData> {
  if (now) {
    return loadSafeReserveApyMonitorData(now);
  }

  const currentTime = Date.now();

  if (monitorDataCache && monitorDataCache.expiresAt > currentTime) {
    return monitorDataCache.value;
  }

  monitorDataPromise ??= loadSafeReserveApyMonitorData()
    .then((data) => {
      const refreshedAt = Date.now();

      monitorDataCache = {
        expiresAt: refreshedAt + CACHE_TTL_MS,
        staleUntil: refreshedAt + STALE_CACHE_TTL_MS,
        value: data,
      };

      return data;
    })
    .finally(() => {
      monitorDataPromise = null;
    });

  if (monitorDataCache && monitorDataCache.staleUntil > currentTime) {
    void monitorDataPromise.catch(() => null);
    return monitorDataCache.value;
  }

  return monitorDataPromise;
}
