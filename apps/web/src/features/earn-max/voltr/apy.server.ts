import "server-only";

import { VOLTR_VAULT } from "./program";

const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 3_000;

export type EarnMaxVoltrApy = {
  /** Headline: 7-day APY, or all-time until 7 days of history exist. */
  apyBps: number | null;
  oneDayBps: number | null;
  sevenDaysBps: number | null;
  thirtyDaysBps: number | null;
  allTimeBps: number | null;
};

const EMPTY: EarnMaxVoltrApy = {
  allTimeBps: null,
  apyBps: null,
  oneDayBps: null,
  sevenDaysBps: null,
  thirtyDaysBps: null,
};

let cached: { at: number; value: EarnMaxVoltrApy } | null = null;

// Voltr's public API returns APY in percent; null until a window exists.
const toBps = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 100)
    : null;

// Realized vault APY as Voltr computes it for its own UI. Cached per server
// instance so browsers never call Voltr and a Voltr outage shows a dash.
export async function readEarnMaxVoltrApy(): Promise<EarnMaxVoltrApy> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const response = await fetch(
      `https://api.voltr.xyz/vault/${VOLTR_VAULT.toBase58()}`,
      { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    const body = (await response.json()) as {
      vault?: { apy?: Record<string, unknown> };
    };
    const apy = response.ok ? body.vault?.apy : undefined;
    if (!apy) return cached?.value ?? EMPTY;
    const value: EarnMaxVoltrApy = {
      allTimeBps: toBps(apy.allTime),
      oneDayBps: toBps(apy.oneDay),
      sevenDaysBps: toBps(apy.sevenDays),
      thirtyDaysBps: toBps(apy.thirtyDays),
      apyBps: toBps(apy.sevenDays) ?? toBps(apy.allTime),
    };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return cached?.value ?? EMPTY;
  }
}
