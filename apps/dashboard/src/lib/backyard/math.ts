// Pure money math for the Backyard dashboard. Mirrors the admin Earn MAX page
// (apps/admin/.../earn-max/earn-max-math.ts) so both show the same numbers.

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;

export type DailyPrice = { day: string; price: number };

/**
 * Obligation LTV: collateral actually in Kamino = NAV + debt - cash held in
 * the worker's custody. USD at ~$1 is good enough for a gauge.
 */
export function loanToValue(
  navUsd: number,
  debtUsd: number,
  custodyUsd: number
) {
  const collateral = navUsd + debtUsd - custodyUsd;
  return collateral > 0 ? debtUsd / collateral : null;
}

function finishedDays(daily: DailyPrice[], nowMs: number) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  return daily
    .filter((point) => point.day < today && point.price > 0)
    .map((point) => ({
      day: point.day,
      price: point.price,
      time: Date.parse(`${point.day}T23:59:59Z`),
    }));
}

/**
 * Realized APY from the share price over the last 7 days (or since the first
 * daily point), once at least 12 hours have passed. Daily points are
 * end-of-day UTC, today excluded.
 */
export function realizedApy(
  daily: DailyPrice[],
  priceNow: number,
  nowMs: number
) {
  const points = finishedDays(daily, nowMs);
  const start =
    [...points].reverse().find((point) => nowMs - point.time >= 6.5 * DAY_MS) ??
    points[0];
  if (!start || nowMs - start.time < DAY_MS / 2) return null;
  const years = (nowMs - start.time) / YEAR_MS;

  return {
    apy: (priceNow / start.price) ** (1 / years) - 1,
    since: new Date(start.time).toISOString().slice(0, 10),
  };
}

/**
 * Per UTC day: that day's share-price growth annualized, and the 7-day
 * realized APY as of that day's end. The last point is now (live price).
 */
export function apyHistory(
  daily: DailyPrice[],
  priceNow: number,
  nowMs: number
) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const points = [
    ...finishedDays(daily, nowMs),
    { day: today, price: priceNow, time: nowMs },
  ];

  return points.slice(1).map((point, index) => {
    const previous = points[index];
    const years = (point.time - previous.time) / YEAR_MS;
    return {
      at: new Date(point.time).toISOString(),
      dayApy:
        point.day === today
          ? null
          : (point.price / previous.price) ** (1 / years) - 1,
      sevenDayApy:
        realizedApy(points.slice(0, index + 1), point.price, point.time)?.apy ??
        null,
    };
  });
}

/**
 * Realized APY over a window ending now: share price now against the last
 * end-of-day price at or before the window start (or the first price).
 */
export function windowApy(
  daily: DailyPrice[],
  priceNow: number,
  nowMs: number,
  windowDays: number
) {
  const points = finishedDays(daily, nowMs);
  const from = nowMs - windowDays * DAY_MS;
  const start =
    [...points].reverse().find((point) => point.time <= from) ?? points[0];
  if (!start || nowMs - start.time < DAY_MS / 2) return null;
  const years = (nowMs - start.time) / YEAR_MS;

  return {
    apy: (priceNow / start.price) ** (1 / years) - 1,
    days: (nowMs - start.time) / DAY_MS,
    since: new Date(start.time).toISOString().slice(0, 10),
  };
}
