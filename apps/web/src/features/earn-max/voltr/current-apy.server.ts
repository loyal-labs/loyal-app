import "server-only";

import { sql } from "drizzle-orm";

import { getYieldOptimizationClient } from "@/lib/yield-optimization/yield-neon-client.server";

// The Backyard RWA worker route that manages the Voltr vault's strategy.
const ROUTE_KEY = "rwa-multiply:ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh";
const MAX_AGE_MS = 30 * 60 * 1000;
const CACHE_MS = 60 * 1000;

let cached: { at: number; value: number | null } | null = null;

/**
 * Net APY of the vault's live position right now (token yield on the
 * collateral minus borrow cost, at the current leverage), as the worker
 * computes and stores it. Null when missing, stale or the vault is flat.
 */
export async function readEarnMaxCurrentApyBps(): Promise<number | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value: number | null = null;
  try {
    const result = await getYieldOptimizationClient().db.execute(sql`
      SELECT state->'currentApy' AS current_apy
      FROM loyal_yield.multiply_route_states
      WHERE route_key = ${ROUTE_KEY}
    `);
    // postgres-js returns an array, neon-http a { rows } object.
    const list: unknown[] = Array.isArray(result)
      ? result
      : (result as { rows?: unknown[] }).rows ?? [];
    const row = list[0] as { current_apy?: unknown } | undefined;
    const apy = row?.current_apy as
      | { apyBps?: unknown; flat?: unknown; observedAt?: unknown }
      | null
      | undefined;
    const observedAt = Date.parse(String(apy?.observedAt ?? ""));
    if (
      apy &&
      apy.flat !== true &&
      typeof apy.apyBps === "number" &&
      Number.isFinite(apy.apyBps) &&
      Date.now() - observedAt < MAX_AGE_MS
    ) {
      value = Math.round(apy.apyBps);
    }
  } catch {
    // The badge falls back to the 7-day APY.
    return cached?.value ?? null;
  }
  cached = { at: Date.now(), value };
  return value;
}
