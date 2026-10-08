import "server-only";

import { sql } from "drizzle-orm";

import { getServerEnv } from "@/lib/core/config/server";
import { getYieldOptimizationClient } from "@/lib/yield-optimization/yield-neon-client.server";

import type { EarnMaxWithdrawalHealth } from "../types";
import { EARN_MAX_BACKYARD_ROUTE_KEY } from "./current-apy.server";
import { VOLTR_PROGRAM_ID, VOLTR_VAULT } from "./program";
import { parseWithdrawalHealth } from "./withdrawal-health";

/** Display-only, for authenticated users of the configured pooled Voltr vault. */
export async function readEarnMaxWithdrawalHealth(): Promise<EarnMaxWithdrawalHealth> {
  const environment = getServerEnv().solanaEnv;
  const scope = {
    cluster: environment === "mainnet" ? "mainnet-beta" : environment,
    program: VOLTR_PROGRAM_ID.toBase58(),
    routeKey: EARN_MAX_BACKYARD_ROUTE_KEY,
    vault: VOLTR_VAULT.toBase58(),
  };
  try {
    const result = await getYieldOptimizationClient().db.execute(sql`
      SELECT state->'withdrawalHealth' AS health
      FROM loyal_yield.multiply_route_states
      WHERE route_key = ${scope.routeKey}
    `);
    const rows: unknown[] = Array.isArray(result)
      ? result
      : (result as { rows?: unknown[] }).rows ?? [];
    const row = rows.length === 1 ? rows[0] : null;
    const health = row && typeof row === "object" && "health" in row
      ? row.health
      : null;
    return parseWithdrawalHealth(health, scope);
  } catch {
    // Missing/stale worker evidence never clears a block or permits a claim.
    return parseWithdrawalHealth(null, scope);
  }
}
