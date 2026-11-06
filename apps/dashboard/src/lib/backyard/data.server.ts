import "server-only";

import { unstable_cache } from "next/cache";

import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

import { apyHistory, type DailyPrice, realizedApy } from "./math";
import {
  BORROW_LANES,
  type BackyardVault,
  DEFAULT_LANE,
  findBackyardVault,
  LANES,
} from "./vaults";

// Read-only: every query here is a SELECT against the worker's own tables,
// bound by route key, and the same SQL the admin Earn MAX page runs.

const LANE_ORDER = ["AUTO", "OnRe", "Prime", "Maple"];

/** Every source loads on its own: one failure never hides the others. */
export type Part<T> = { ok: true; value: T } | { ok: false; error: string };

async function part<T>(load: () => Promise<T>): Promise<Part<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("backyard_dashboard_source_failed", { message });
    return { ok: false, error: message };
  }
}

type Json = Record<string, unknown>;
const rec = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const num = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const str = (value: unknown) =>
  typeof value === "string" && value ? value : null;
const usdOf = (raw: unknown) => {
  const value = num(raw);
  return value === null ? null : value / 1e6;
};

async function rows<T>(text: string, params: unknown[]) {
  return (await getYieldNeonSql().query(text, params)) as unknown as T[];
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  }
  return (await response.json()) as unknown;
}

export type LeverageLane = {
  apyPct: Record<string, number>;
  enterable: boolean;
  lane: string;
  levels: number[];
  older: boolean;
  spreadPct: number;
};

async function loadRoute(vault: BackyardVault) {
  const [row] = await rows<{
    report_age_s: number | null;
    state: unknown;
    updated_age_s: number;
  }>(
    `SELECT state,
       extract(epoch FROM now() - updated_at)::int AS updated_age_s,
       extract(epoch FROM now() - (state->'observation'->>'reportObservedAt')::timestamptz)::int AS report_age_s
     FROM loyal_yield.multiply_route_states WHERE route_key = $1`,
    [vault.routeKey]
  );
  if (!row) throw new Error("The worker has not written this vault yet.");
  const state = rec(row.state);
  const observation = rec(state.observation);
  const target = rec(state.leverageTarget);
  const apy = rec(state.currentApy);
  const selector = rec(rec(state.selector).result ?? state.selectorResult);
  const watch = rec(state.leverageWatch);
  const watchAt = str(watch.observedAt);
  const lanes: LeverageLane[] = (
    Array.isArray(watch.lanes) ? watch.lanes : []
  ).map((raw) => {
    const lane = rec(raw);
    const observedAt = str(lane.observedAt);
    return {
      apyPct: Object.fromEntries(
        Object.entries(rec(lane.apyBps)).map(([level, bps]) => [
          Number(level).toString(),
          (num(bps) ?? 0) / 100,
        ])
      ),
      enterable: lane.enterable === true,
      lane: String(lane.lane ?? "unknown"),
      levels: (Array.isArray(lane.levels) ? lane.levels : [])
        .map(num)
        .filter((level): level is number => level !== null),
      older: Boolean(
        watchAt && observedAt && Date.parse(observedAt) < Date.parse(watchAt)
      ),
      spreadPct: (num(lane.spreadBps) ?? 0) / 100,
    };
  });
  const laneRank = (lane: string) => {
    const index = LANE_ORDER.indexOf(lane.split("/")[0]);
    return index === -1 ? LANE_ORDER.length : index;
  };
  lanes.sort((a, b) => laneRank(a.lane) - laneRank(b.lane));
  const [lastHold] = await rows<{ reason: string | null }>(
    `SELECT expected_effects #>> '{decision,reason}' AS reason
     FROM loyal_yield.multiply_operations
     WHERE route_key = $1 AND action = 'HOLD' AND created_at > now() - interval '1 hour'
     ORDER BY created_at DESC LIMIT 1`,
    [vault.routeKey]
  );
  // Cash the worker holds outside Kamino: Squads idle USDC, borrowed tokens
  // not yet swapped, and collateral not yet deposited.
  const custodyParts = [
    usdOf(observation.squadsIdleRaw),
    usdOf(observation.debtIdleRaw),
    usdOf(observation.collateralIdleValueRaw),
  ];

  return {
    currentApy:
      apy.apyBps === undefined
        ? null
        : {
            apyPct: (num(apy.apyBps) ?? 0) / 100,
            flat: apy.flat === true,
            lane: str(apy.lane),
            level: num(apy.level),
            observedAt: str(apy.observedAt),
          },
    currentOperationId: str(state.currentOperationId),
    custodyUsd: custodyParts.some((value) => value === null)
      ? null
      : custodyParts.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    debtUsd: usdOf(observation.payoffDebtRaw),
    lastHoldReason: lastHold?.reason ?? null,
    leverageTarget: num(target.level),
    leverageWatch: watchAt ? { lanes, observedAt: watchAt } : null,
    navFresh:
      typeof observation.navFresh === "boolean" ? observation.navFresh : null,
    navUsd: usdOf(observation.navRaw),
    reportAgeS: row.report_age_s,
    reportObservedAt: str(observation.reportObservedAt),
    routeStatus: str(observation.routeStatus),
    selectorAction: str(selector.action),
    selectorReason: str(selector.reason),
    updatedAgeS: row.updated_age_s,
    voltrIdleUsd: usdOf(observation.voltrIdleRaw),
  };
}

async function loadNavSeries(vault: BackyardVault) {
  // One reconciled NAV report per 30 minutes; the request is base64 JSON.
  const reports = await rows<{ at: string; request: string | null }>(
    `SELECT DISTINCT ON (date_bin('30 minutes', created_at, 'epoch'::timestamptz))
       created_at AS at, expected_effects->'phase3'->'buildInput'->>'request' AS request
     FROM loyal_yield.multiply_operations
     WHERE route_key = $1 AND action = 'REPORT_NAV' AND status = 'reconciled'
       AND created_at > now() - interval '24 hours'
     ORDER BY date_bin('30 minutes', created_at, 'epoch'::timestamptz), created_at DESC`,
    [vault.routeKey]
  );

  return reports.flatMap(({ at, request }) => {
    try {
      const report = rec(
        rec(JSON.parse(Buffer.from(request ?? "", "base64").toString("utf8")))
          .Report
      );
      const nav = num(report.NAVAfterRaw);
      return nav === null
        ? []
        : [{ at: new Date(at).toISOString(), navUsd: nav / 1e6 }];
    } catch {
      return [];
    }
  });
}

async function loadHealth(vault: BackyardVault) {
  const [nav, refused, latches] = await Promise.all([
    rows<{ count: number; status: string }>(
      `SELECT status, count(*)::int AS count
       FROM loyal_yield.multiply_operations
       WHERE route_key = $1 AND action = 'REPORT_NAV' AND created_at > now() - interval '24 hours'
       GROUP BY 1`,
      [vault.routeKey]
    ),
    // Refused by the worker's own pre-send checks: never reached the chain.
    rows<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM loyal_yield.multiply_operations
       WHERE route_key = $1 AND status = 'failed' AND transaction_signature IS NULL
         AND created_at > now() - interval '24 hours'
         AND action NOT IN ('HOLD', 'REPORT_NAV')`,
      [vault.routeKey]
    ),
    rows<{ reason: string }>(
      `SELECT reason FROM loyal_yield.backyard_manual_recovery_latches
       WHERE route_key = $1 AND cleared_at IS NULL`,
      [vault.routeKey]
    ),
  ]);

  return {
    navAll: nav.reduce((sum, row) => sum + row.count, 0),
    navReconciled: nav
      .filter((row) => row.status === "reconciled")
      .reduce((sum, row) => sum + row.count, 0),
    openStops: latches.map((row) => row.reason),
    refusedBeforeSending: refused[0]?.count ?? 0,
  };
}

const MONEY_ACTIONS_EXCLUDED = `('HOLD', 'REPORT_NAV', 'HOLD_MANUAL_RECOVERY', 'HOLD_CLEARED')`;

export type MoneyMove = {
  action: string;
  amountRaw: string | null;
  at: string;
  reason: string | null;
  signature: string | null;
  status: string;
  strategyKey: string | null;
};

async function loadMoves(vault: BackyardVault) {
  const moves = await rows<{
    action: string;
    amount_raw: string | null;
    created_at: string;
    reason: string | null;
    status: string;
    strategy_key: string | null;
    transaction_signature: string | null;
  }>(
    `SELECT action, status, strategy_key, transaction_signature, created_at,
       -- A borrow's decision amount is 0 (its size comes from the leverage
       -- target); the amount is what landed in the vault's own accounts.
       CASE WHEN expected_effects #>> '{expectedEffects,kind}' = 'kamino-borrow'
         THEN (SELECT sum((a->>'afterRaw')::numeric - (a->>'beforeRaw')::numeric)::text
               FROM jsonb_array_elements(expected_effects #> '{expectedEffects,accounts}') a
               WHERE a->>'authority' = $2
                 AND (a->>'afterRaw')::numeric > (a->>'beforeRaw')::numeric)
         ELSE expected_effects #>> '{decision,amountRaw}'
       END AS amount_raw,
       COALESCE(recovery_reason, expected_effects #>> '{decision,reason}') AS reason
     FROM loyal_yield.multiply_operations
     WHERE route_key = $1 AND transaction_signature IS NOT NULL
       AND action NOT IN ${MONEY_ACTIONS_EXCLUDED}
     ORDER BY created_at DESC LIMIT 30`,
    [vault.routeKey, vault.squads]
  );

  return moves.map<MoneyMove>((move) => ({
    action: move.action,
    amountRaw: move.amount_raw,
    at: new Date(move.created_at).toISOString(),
    reason: move.reason,
    signature: move.transaction_signature,
    status: move.status,
    strategyKey: move.strategy_key,
  }));
}

/** Days the worker changed the position on chain, for chart markers. */
async function loadMoveDays(vault: BackyardVault) {
  const days = await rows<{ count: number; day: string }>(
    `SELECT date_trunc('day', created_at) AS day, count(*)::int AS count
     FROM loyal_yield.multiply_operations
     WHERE route_key = $1 AND transaction_signature IS NOT NULL AND status = 'reconciled'
       AND action NOT IN ${MONEY_ACTIONS_EXCLUDED}
       AND created_at > now() - interval '366 days'
     GROUP BY 1 ORDER BY 1`,
    [vault.routeKey]
  );
  return days.map((row) => ({
    count: row.count,
    day: new Date(row.day).toISOString().slice(0, 10),
  }));
}

async function loadHistory(vault: BackyardVault) {
  // Large table: always bound by route + time and aggregate in SQL.
  const points = await rows<{
    equity: number | null;
    hour: string;
    ltv: number | null;
  }>(
    `SELECT date_trunc('hour', observed_at) AS hour,
       (avg(equity_usd_micros) / 1e6)::float8 AS equity,
       (avg(ltv_bps) / 100)::float8 AS ltv
     FROM loyal_yield.multiply_position_snapshots
     WHERE route_key = $1 AND observed_at > now() - interval '7 days'
     GROUP BY 1 ORDER BY 1`,
    [vault.routeKey]
  );

  return points.map((point) => ({
    at: new Date(point.hour).toISOString(),
    equityUsd: point.equity,
    ltvPct: point.ltv,
  }));
}

async function loadVoltr(vault: BackyardVault) {
  const [body, priceBody] = await Promise.all([
    fetchJson(`https://api.voltr.xyz/vault/${vault.voltrVault}`),
    fetchJson(`https://api.voltr.xyz/vault/${vault.voltrVault}/share-price`),
  ]);
  const live = rec(rec(priceBody).data);
  const sharePrice = num(live.sharePrice);
  if (sharePrice === null) throw new Error("Voltr returned no share price.");
  const stats = rec(rec(rec(body).vault).dailyStats);
  const days = Array.isArray(stats.dateLabels) ? stats.dateLabels : [];
  const tvl = Array.isArray(stats.tvlData) ? stats.tvlData : [];
  const lp = Array.isArray(stats.lpData) ? stats.lpData : [];
  // Voltr's share price is per 1,000 LP; tvl / lp (raw) is per LP unit.
  const priceNow = sharePrice / 1000;
  const daily: DailyPrice[] = [];
  const tvlDaily: Array<{ at: string; value: number }> = [];
  days.forEach((day, index) => {
    const t = num(tvl[index]);
    const l = num(lp[index]);
    if (typeof day !== "string") return;
    if (t !== null)
      tvlDaily.push({ at: `${day}T23:59:59.000Z`, value: t / 1e6 });
    if (t && l) daily.push({ day, price: t / l });
  });
  const now = Date.now();
  const totalValueUsd = usdOf(live.totalValue);
  // Today's Voltr point is unfinished; the live total replaces it.
  const today = new Date(now).toISOString().slice(0, 10);
  const tvlSeries = tvlDaily.filter((point) => point.at.slice(0, 10) < today);
  if (totalValueUsd !== null)
    tvlSeries.push({ at: new Date(now).toISOString(), value: totalValueUsd });

  return {
    apyHistory: apyHistory(daily, priceNow, now),
    daily,
    priceNow,
    realized: realizedApy(daily, priceNow, now),
    sharePrice,
    totalValueUsd,
    tvl: tvlSeries,
  };
}

async function loadBorrowing() {
  return Promise.all(
    BORROW_LANES.map(async (lane) => {
      const { debtReserve, market } = LANES[lane];
      const reserves = await fetchJson(
        `https://api.kamino.finance/kamino-market/${market}/reserves/metrics?env=mainnet-beta`
      );
      const row = rec(
        (Array.isArray(reserves) ? reserves : []).find(
          (item) => rec(item).reserve === debtReserve
        )
      );
      const supplyUsd = num(row.totalSupplyUsd);
      const borrowUsd = num(row.totalBorrowUsd);
      if (supplyUsd === null || borrowUsd === null || supplyUsd <= 0) {
        throw new Error(`Kamino has no metrics for the ${lane} debt reserve.`);
      }
      return {
        borrowApyPct: (num(row.borrowApy) ?? 0) * 100,
        lane,
        roomTo90Usd: Math.max(0.9 * supplyUsd - borrowUsd, 0),
        supplyUsd,
        token: str(row.liquidityToken) ?? "?",
        utilization: borrowUsd / supplyUsd,
      };
    })
  );
}

async function reserveHistory(market: string, reserve: string, start: string) {
  const end = new Date().toISOString();
  const body = rec(
    await fetchJson(
      `https://api.kamino.finance/kamino-market/${market}/reserves/${reserve}/metrics/history?env=mainnet-beta&start=${start}&end=${end}&frequency=day`
    )
  );
  return (Array.isArray(body.history) ? body.history : []).map((raw) => {
    const point = rec(raw);
    const metrics = rec(point.metrics);
    return {
      at: String(point.timestamp ?? ""),
      assetYield: num(metrics.assetYieldApy) ?? 0,
      borrow: num(metrics.borrowInterestAPY) ?? 0,
      supply: num(metrics.supplyInterestAPY) ?? 0,
    };
  });
}

/**
 * Breakdown for one lane: what the collateral earns (its own yield plus
 * Kamino supply interest) against what the debt costs, per day.
 */
async function loadBreakdown(lane: string, since: string) {
  const reserves = LANES[lane];
  if (!reserves) throw new Error(`No Kamino reserves known for ${lane}.`);
  const [collateral, debt] = await Promise.all([
    reserveHistory(reserves.market, reserves.collateralReserve, since),
    reserveHistory(reserves.market, reserves.debtReserve, since),
  ]);
  const debtByDay = new Map(debt.map((p) => [p.at.slice(0, 10), p.borrow]));
  return {
    lane,
    points: collateral.flatMap((point) => {
      const borrow = debtByDay.get(point.at.slice(0, 10));
      return borrow === undefined
        ? []
        : [
            {
              at: point.at,
              borrowPct: borrow * 100,
              supplyPct: (point.assetYield + point.supply) * 100,
            },
          ];
    }),
  };
}

async function load(slug: string) {
  const vault = findBackyardVault(slug);
  if (!vault) throw new Error(`Unknown vault ${slug}`);
  const [route, navSeries, health, moves, moveDays, history, voltr, borrowing] =
    await Promise.all([
      part(() => loadRoute(vault)),
      part(() => loadNavSeries(vault)),
      part(() => loadHealth(vault)),
      part(() => loadMoves(vault)),
      part(() => loadMoveDays(vault)),
      part(() => loadHistory(vault)),
      part(() => loadVoltr(vault)),
      part(loadBorrowing),
    ]);
  const lane =
    (route.ok && route.value.currentApy?.lane) ||
    (moves.ok && moves.value.find((m) => m.strategyKey)?.strategyKey) ||
    DEFAULT_LANE;
  const firstDay = voltr.ok ? voltr.value.daily[0]?.day : undefined;
  const since = firstDay
    ? `${firstDay}T00:00:00Z`
    : new Date(Date.now() - 30 * 86_400_000).toISOString();
  const breakdown = await part(() => loadBreakdown(lane, since));

  return {
    borrowing,
    breakdown,
    health,
    history,
    loadedAt: new Date().toISOString(),
    moveDays,
    moves,
    navSeries,
    route,
    voltr,
  };
}

export type BackyardData = Awaited<ReturnType<typeof load>>;

/** One load per vault per minute, shared by every viewer. */
export const getBackyardData = unstable_cache(load, ["backyard-dashboard-v1"], {
  revalidate: 60,
});
