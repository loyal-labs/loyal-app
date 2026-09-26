import "server-only";

import { VOLTR_VAULT } from "./program";

const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 3_000;
const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export type EarnMaxVoltrApyPoint = {
  /** Annualized share-price growth into this UTC day, basis points. */
  apyBps: number;
  date: string;
};

export type EarnMaxVoltrApy = {
  /** Headline: share-price APY over the last 7 days (or since launch). */
  apyBps: number | null;
  /** Days the headline covers; below 7 while the vault is young. */
  apyWindowDays: number | null;
  /** Daily share-price APY for the chart, oldest first. */
  daily: EarnMaxVoltrApyPoint[];
};

const EMPTY: EarnMaxVoltrApy = { apyBps: null, apyWindowDays: null, daily: [] };

let cached: { at: number; value: EarnMaxVoltrApy } | null = null;

type DailyStats = {
  dateLabels?: unknown;
  lpData?: unknown;
  tvlData?: unknown;
};

/**
 * Share price = end-of-day TVL / LP supply (Voltr dailyStats) plus the live
 * vault value. Compounded growth over the window, annualized. Voltr's own
 * 1-day figure swings with every NAV report on a small vault, so the badge
 * uses 7 days.
 */
export function shareApy(
  stats: DailyStats,
  live: { lp: number; tvl: number } | null,
  now = Date.now()
): EarnMaxVoltrApy {
  const dates = Array.isArray(stats.dateLabels) ? stats.dateLabels : [];
  const tvl = Array.isArray(stats.tvlData) ? stats.tvlData : [];
  const lp = Array.isArray(stats.lpData) ? stats.lpData : [];
  const points: { at: number; date: string; price: number }[] = [];
  dates.forEach((date, i) => {
    const value = Number(tvl[i]);
    const supply = Number(lp[i]);
    const at = Date.parse(`${String(date)}T23:59:59Z`);
    if (value > 0 && supply > 0 && Number.isFinite(at)) {
      points.push({
        at: Math.min(at, now),
        date: String(date),
        price: value / supply,
      });
    }
  });
  if (live && live.tvl > 0 && live.lp > 0) {
    // Today's row is live on Voltr too; the vault read is fresher.
    const today = new Date(now).toISOString().slice(0, 10);
    const last = points.at(-1);
    if (last?.date === today) points.pop();
    points.push({ at: now, date: today, price: live.tvl / live.lp });
  }
  const annualize = (
    from: (typeof points)[number],
    to: (typeof points)[number]
  ) => {
    const years = (to.at - from.at) / (365 * DAY_MS);
    if (years <= 0) return null;
    return Math.round(
      (Math.pow(to.price / from.price, 1 / years) - 1) * 10_000
    );
  };
  const daily: EarnMaxVoltrApyPoint[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const apyBps = annualize(points[i - 1]!, points[i]!);
    if (apyBps !== null) daily.push({ apyBps, date: points[i]!.date });
  }
  const latest = points.at(-1);
  const start =
    latest &&
    [...points]
      .reverse()
      .find((p) => latest.at - p.at >= WINDOW_DAYS * DAY_MS - DAY_MS / 2);
  const from = start ?? points[0];
  // ponytail: under a day of history the growth is noise; wait for day two.
  const apyBps =
    latest && from && latest.at - from.at >= DAY_MS / 2
      ? annualize(from, latest)
      : null;
  return {
    apyBps,
    apyWindowDays:
      apyBps === null || !latest || !from
        ? null
        : Math.min(WINDOW_DAYS, Math.round((latest.at - from.at) / DAY_MS)),
    daily,
  };
}

export async function readEarnMaxVoltrApy(): Promise<EarnMaxVoltrApy> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const vault = VOLTR_VAULT.toBase58();
    const [detail, price] = await Promise.all(
      [
        `https://api.voltr.xyz/vault/${vault}`,
        `https://api.voltr.xyz/vault/${vault}/share-price`,
      ].map((url) =>
        fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }).then((r) => (r.ok ? r.json() : null))
      )
    );
    const stats = (detail as { vault?: { dailyStats?: DailyStats } } | null)
      ?.vault?.dailyStats;
    if (!stats) return cached?.value ?? EMPTY;
    // sharePrice is per 1 LP unit scaled by 1e9/1e6 decimals; derive live LP
    // from it so both points use the same TVL/LP definition.
    const live = (
      price as { data?: { sharePrice?: number; totalValue?: number } } | null
    )?.data;
    const lpNow =
      live?.sharePrice && live.totalValue
        ? live.totalValue / (live.sharePrice / 1000)
        : null;
    const value = shareApy(
      stats,
      lpNow && live?.totalValue ? { lp: lpNow, tvl: live.totalValue } : null
    );
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return cached?.value ?? EMPTY;
  }
}
