import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";

import { serverEnv } from "@/lib/core/config/server";
import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

import { earnedSinceEmpty, type LpFlow, realizedApy } from "./earn-max-math";

const DEFAULT_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const ROUTE_KEY = "rwa-multiply:ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh";
const VOLTR_VAULT = "HXtk15EA5pBg3rSKxBm8sWPExScPkTknSRp37fXNHgNA";
const LP_MINT = "6tNheTBYSpQkfMLhcczKgmTLSGffK54npKMG1WQR2tvb";
export const IDLE_ATA = "6LATwaB4yRwGURCBDyFeJGqofaXxb6xXws9wBGbr3RBh";
export const CUSTODY = {
  debt: "J4YFQzxhQ3pht2RRYes5yv1spPYBqvHzxn4zMX7iriHn",
  collateral: "9tDh95ofQ7B83bHAou1XJGJNnfRTs3hLfX8uyKW6u97G",
} as const;
// Debt reserve per lane, from the worker's route catalog.
const DEBT_RESERVES = [
  {
    lane: "AUTO",
    market: "Btu8835QDYgdTnMJJBSidbfQhrZzryZbMhCpty6h6Xdk",
    reserve: "6A8D3ExQ4CdiZTBmij7MScUeKsgs6mSHksYzJbiY61FM",
  },
  {
    lane: "OnRe",
    market: "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8",
    reserve: "AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z",
  },
  {
    lane: "Maple",
    market: "6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y",
    reserve: "Atj6UREVWa7WxbF2EMKNyfmYUY1U1txughe2gjhcPDCo",
  },
] as const;
const LANE_ORDER = ["AUTO", "OnRe", "Prime", "Maple"];

/** Every source loads on its own: one failure never hides the others. */
export type Part<T> = { ok: true; value: T } | { ok: false; error: string };

async function part<T>(load: () => Promise<T>): Promise<Part<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
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

function sql() {
  return getYieldNeonSql();
}

async function rows<T>(text: string, params: unknown[] = [ROUTE_KEY]) {
  return (await sql().query(text, params)) as unknown as T[];
}

function connection() {
  return new Connection(
    serverEnv.solanaMainnetRpcUrl ?? DEFAULT_MAINNET_RPC_URL,
    { commitment: "confirmed" }
  );
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
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

async function loadRoute() {
  const [row] = await rows<{
    lease_owner: string | null;
    report_age_s: number | null;
    state: unknown;
    updated_age_s: number;
  }>(
    `SELECT state, lease_owner,
       extract(epoch FROM now() - updated_at)::int AS updated_age_s,
       extract(epoch FROM now() - (state->'observation'->>'reportObservedAt')::timestamptz)::int AS report_age_s
     FROM loyal_yield.multiply_route_states WHERE route_key = $1`
  );
  if (!row) throw new Error("The Earn MAX route has no state row yet.");
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
    const apyBps = rec(lane.apyBps);
    const observedAt = str(lane.observedAt);

    return {
      apyPct: Object.fromEntries(
        Object.entries(apyBps).map(([level, bps]) => [
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
  const navRaw = num(observation.navRaw);
  const debtRaw = num(observation.payoffDebtRaw);
  const [lastHold] = await rows<{ reason: string | null }>(
    `SELECT expected_effects #>> '{decision,reason}' AS reason
     FROM loyal_yield.multiply_operations
     WHERE route_key = $1 AND action = 'HOLD' AND created_at > now() - interval '1 hour'
     ORDER BY created_at DESC LIMIT 1`
  );

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
    debtUsd: debtRaw === null ? null : debtRaw / 1e6,
    goal: str(state.goal),
    lastHoldReason: lastHold?.reason ?? null,
    leaseOwner: row.lease_owner,
    leverageTarget: num(target.level),
    leverageTargetAt: str(target.decidedAt),
    leverageWatch: watchAt ? { lanes, observedAt: watchAt } : null,
    navFresh:
      typeof observation.navFresh === "boolean" ? observation.navFresh : null,
    navUsd: navRaw === null ? null : navRaw / 1e6,
    reportAgeS: row.report_age_s,
    reportObservedAt: str(observation.reportObservedAt),
    reportSlot: num(observation.reportSlot),
    routeStatus: str(observation.routeStatus),
    selectorAction: str(selector.action),
    selectorReason: str(selector.reason),
    updatedAgeS: row.updated_age_s,
    // The lease owner ends with the worker image sha.
    version: row.lease_owner ? row.lease_owner.slice(-40).slice(0, 7) : null,
    withdrawalStatus: str(rec(state.withdrawal).status),
  };
}

async function loadNavSeries() {
  // One reconciled NAV report per 30 minutes; the request is base64 JSON.
  const reports = await rows<{ at: string; request: string | null }>(
    `SELECT DISTINCT ON (date_bin('30 minutes', created_at, 'epoch'::timestamptz))
       created_at AS at, expected_effects->'phase3'->'buildInput'->>'request' AS request
     FROM loyal_yield.multiply_operations
     WHERE route_key = $1 AND action = 'REPORT_NAV' AND status = 'reconciled'
       AND created_at > now() - interval '24 hours'
     ORDER BY date_bin('30 minutes', created_at, 'epoch'::timestamptz), created_at DESC`
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

async function loadHealth() {
  const [nav, failedSteps] = await Promise.all([
    rows<{ count: number; reason: string | null; status: string }>(
      `SELECT status, recovery_reason AS reason, count(*)::int AS count
       FROM loyal_yield.multiply_operations
       WHERE route_key = $1 AND action = 'REPORT_NAV' AND created_at > now() - interval '24 hours'
       GROUP BY 1, 2 ORDER BY 3 DESC`
    ),
    rows<{ action: string; count: number }>(
      `SELECT action, count(*)::int AS count
       FROM loyal_yield.multiply_operations
       WHERE route_key = $1 AND status = 'failed' AND created_at > now() - interval '24 hours'
         AND action NOT IN ('HOLD', 'REPORT_NAV')
       GROUP BY 1 ORDER BY 2 DESC`
    ),
  ]);
  const count = (status: string) =>
    nav.filter((row) => row.status === status).reduce((s, r) => s + r.count, 0);

  return {
    failedSteps,
    navAll: nav.reduce((sum, row) => sum + row.count, 0),
    navFailed: count("failed"),
    navFailureReasons: nav
      .filter((row) => row.status === "failed")
      .slice(0, 5)
      .map((row) => ({ count: row.count, reason: row.reason ?? "no reason" })),
    navReconciled: count("reconciled"),
  };
}

export type MoneyMove = {
  action: string;
  amountRaw: string | null;
  at: string;
  reason: string | null;
  signature: string | null;
  status: string;
  strategyKey: string | null;
};

async function loadMoves() {
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
       expected_effects #>> '{decision,amountRaw}' AS amount_raw,
       COALESCE(recovery_reason, expected_effects #>> '{decision,reason}') AS reason
     FROM loyal_yield.multiply_operations
     WHERE route_key = $1
       AND action NOT IN ('HOLD', 'REPORT_NAV', 'HOLD_MANUAL_RECOVERY', 'HOLD_CLEARED')
     ORDER BY created_at DESC LIMIT 30`
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

async function loadLatches() {
  const [open, cleared] = await Promise.all([
    rows<{ latched_at: string; reason: string }>(
      `SELECT reason, latched_at FROM loyal_yield.backyard_manual_recovery_latches
       WHERE route_key = $1 AND cleared_at IS NULL`
    ),
    // The latch table keeps one row per route; the clear history is the
    // HOLD_CLEARED journal.
    rows<{ effects: unknown; created_at: string }>(
      `SELECT expected_effects AS effects, created_at
       FROM loyal_yield.multiply_operations
       WHERE route_key = $1 AND action = 'HOLD_CLEARED'
       ORDER BY created_at DESC LIMIT 10`
    ),
  ]);

  return {
    cleared: cleared.map((row) => {
      const effects = rec(row.effects);
      return {
        clearedAt:
          str(effects.clearedAt) ?? new Date(row.created_at).toISOString(),
        clearedReason: str(effects.clearedReason),
        latchedAt: str(effects.latchedAt),
        reason: str(effects.latchedReason),
      };
    }),
    open: open.map((row) => ({
      latchedAt: new Date(row.latched_at).toISOString(),
      reason: row.reason,
    })),
  };
}

async function loadHistory() {
  // ~187k snapshot rows: always bound by route + time and aggregate in SQL.
  const points = await rows<{
    apy: number | null;
    equity: number | null;
    hour: string;
    ltv: number | null;
  }>(
    `SELECT date_trunc('hour', observed_at) AS hour,
       (avg(equity_usd_micros) / 1e6)::float8 AS equity,
       (avg(ltv_bps) / 100)::float8 AS ltv,
       (avg(forecast_apy_bps) / 100)::float8 AS apy
     FROM loyal_yield.multiply_position_snapshots
     WHERE route_key = $1 AND observed_at > now() - interval '7 days'
     GROUP BY 1 ORDER BY 1`
  );

  return points.map((point) => ({
    apyPct: point.apy,
    at: new Date(point.hour).toISOString(),
    equityUsd: point.equity,
    ltvPct: point.ltv,
  }));
}

async function tokenBalance(address: string) {
  const balance = await connection().getTokenAccountBalance(
    new PublicKey(address),
    "confirmed"
  );
  return Number(balance.value.amount) / 1e6;
}

async function loadCustody() {
  const [debt, collateral] = await Promise.all([
    tokenBalance(CUSTODY.debt),
    tokenBalance(CUSTODY.collateral),
  ]);
  return { collateral, debt };
}

async function sharePrice() {
  const body = rec(
    rec(
      await fetchJson(`https://api.voltr.xyz/vault/${VOLTR_VAULT}/share-price`)
    ).data
  );
  const price = num(body.sharePrice);
  if (price === null) throw new Error("Voltr returned no share price.");
  return price;
}

async function loadRealizedApy() {
  const [vault, price] = await Promise.all([
    fetchJson(`https://api.voltr.xyz/vault/${VOLTR_VAULT}`),
    sharePrice(),
  ]);
  const stats = rec(rec(rec(vault).vault).dailyStats);
  const days = Array.isArray(stats.dateLabels) ? stats.dateLabels : [];
  const tvl = Array.isArray(stats.tvlData) ? stats.tvlData : [];
  const lp = Array.isArray(stats.lpData) ? stats.lpData : [];
  const daily = days.flatMap((day, index) => {
    const t = num(tvl[index]);
    const l = num(lp[index]);
    return typeof day === "string" && t && l ? [{ day, price: t / l }] : [];
  });

  return realizedApy(daily, price / 1000, Date.now());
}

// Confirmed transactions never change; the earned figure is reused for 10
// minutes while the LP supply is unchanged.
const flowCache = new Map<string, LpFlow>();
let earnedCache: {
  at: number;
  lpSupply: string;
  value: ReturnType<typeof earnedSinceEmpty> & { valueUsd: number };
} | null = null;

async function loadVaultEarned() {
  const rpc = connection();
  const lpMint = new PublicKey(LP_MINT);
  const supply = (await rpc.getTokenSupply(lpMint, "confirmed")).value.amount;
  if (
    earnedCache &&
    earnedCache.lpSupply === supply &&
    Date.now() - earnedCache.at < 600_000
  ) {
    return earnedCache.value;
  }
  const holders = (await rpc.getTokenLargestAccounts(lpMint, "confirmed"))
    .value;
  const scanned = holders.reduce((sum, h) => sum + BigInt(h.amount), BigInt(0));
  // ponytail: getTokenLargestAccounts caps at 20 accounts; page by holders when the vault grows.
  if (scanned !== BigInt(supply) || holders.length >= 20) {
    throw new Error("holder_scan_incomplete");
  }
  const signatures = new Set<string>();
  for (const holder of holders) {
    const found = await rpc.getSignaturesForAddress(holder.address, {
      limit: 1000,
    });
    found.filter((s) => !s.err).forEach((s) => signatures.add(s.signature));
  }
  const missing = [...signatures].filter((sig) => !flowCache.has(sig));
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const txs = await rpc.getParsedTransactions(batch, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    txs.forEach((tx, index) => {
      if (!tx?.meta || !tx.blockTime) {
        throw new Error(`Transaction ${batch[index]} is unavailable.`);
      }
      const keys = tx.transaction.message.accountKeys.map((k) =>
        k.pubkey.toBase58()
      );
      const sum = (
        side: typeof tx.meta.preTokenBalances,
        pick: (mint: string, address: string) => boolean
      ) =>
        (side ?? [])
          .filter((b) => pick(b.mint, keys[b.accountIndex]))
          .reduce((total, b) => total + Number(b.uiTokenAmount.amount), 0);
      const isLp = (mint: string) => mint === LP_MINT;
      const isIdle = (_: string, address: string) => address === IDLE_ATA;
      flowCache.set(batch[index], {
        blockTime: tx.blockTime,
        idleDelta:
          sum(tx.meta.postTokenBalances, isIdle) -
          sum(tx.meta.preTokenBalances, isIdle),
        lpNet:
          sum(tx.meta.postTokenBalances, isLp) -
          sum(tx.meta.preTokenBalances, isLp),
      });
    });
  }
  // Holders' value = LP they hold x share price. Voltr's totalValue also
  // prices 1,000 LP no account holds, which is not any holder's money.
  const valueUsd = (Number(supply) * (await sharePrice())) / 1000 / 1e6;
  const value = {
    ...earnedSinceEmpty(
      [...signatures].map((sig) => flowCache.get(sig)!),
      valueUsd
    ),
    valueUsd,
  };
  earnedCache = { at: Date.now(), lpSupply: supply, value };
  return value;
}

async function loadBorrowing() {
  return Promise.all(
    DEBT_RESERVES.map(async ({ lane, market, reserve }) => {
      const reserves = await fetchJson(
        `https://api.kamino.finance/kamino-market/${market}/reserves/metrics?env=mainnet-beta`
      );
      const row = rec(
        (Array.isArray(reserves) ? reserves : []).find(
          (item) => rec(item).reserve === reserve
        )
      );
      const supplyUsd = num(row.totalSupplyUsd);
      const borrowUsd = num(row.totalBorrowUsd);
      if (supplyUsd === null || borrowUsd === null || supplyUsd <= 0) {
        throw new Error(`Kamino has no metrics for the ${lane} debt reserve.`);
      }

      return {
        borrowApyPct: (num(row.borrowApy) ?? 0) * 100,
        borrowUsd,
        lane,
        roomTo90Usd: Math.max(0.9 * supplyUsd - borrowUsd, 0),
        supplyUsd,
        token: str(row.liquidityToken) ?? "?",
        utilization: borrowUsd / supplyUsd,
      };
    })
  );
}

export async function getEarnMaxData() {
  const [
    route,
    navSeries,
    health,
    moves,
    latches,
    history,
    custody,
    idle,
    vault,
    apy,
    borrowing,
  ] = await Promise.all([
    part(loadRoute),
    part(loadNavSeries),
    part(loadHealth),
    part(loadMoves),
    part(loadLatches),
    part(loadHistory),
    part(loadCustody),
    part(() => tokenBalance(IDLE_ATA)),
    part(loadVaultEarned),
    part(loadRealizedApy),
    part(loadBorrowing),
  ]);

  return {
    apy,
    borrowing,
    custody,
    health,
    history,
    idle,
    latches,
    loadedAt: new Date().toISOString(),
    moves,
    navSeries,
    route,
    vault,
  };
}

export type EarnMaxData = Awaited<ReturnType<typeof getEarnMaxData>>;
