import "server-only";

import { Connection } from "@solana/web3.js";
import { sql } from "drizzle-orm";

import { getServerEnv } from "@/lib/core/config/server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getYieldOptimizationClient } from "@/lib/yield-optimization/yield-neon-client.server";

import type { EarnMaxSummary } from "../types";
import {
  deriveEarnMaxVoltrAuthority,
  readVoltrPosition,
  voltrUserAccounts,
} from "./program";

// The pooled worker's route; its forecast is the strategy APY for everyone.
const VOLTR_ROUTE_KEY =
  "rwa-multiply:ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh";

let connection: Connection | null = null;

function getConnection(): Connection {
  if (!connection) {
    const { rpcEndpoint } = getServerSolanaEndpoints(getServerEnv().solanaEnv);
    connection = new Connection(rpcEndpoint, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    });
  }
  return connection;
}

async function readForecastApyBps(): Promise<number | null> {
  const result = (await getYieldOptimizationClient().db.execute(sql`
    SELECT forecast_apy_bps
    FROM loyal_yield.multiply_position_snapshots
    WHERE route_key = ${VOLTR_ROUTE_KEY} AND forecast_apy_bps IS NOT NULL
    ORDER BY observed_at DESC, id DESC
    LIMIT 1
  `)) as
    | { rows?: { forecast_apy_bps: unknown }[] }
    | { forecast_apy_bps: unknown }[];
  const row = (Array.isArray(result) ? result : result.rows ?? [])[0];
  return row ? Number(row.forecast_apy_bps) : null;
}

export async function readEarnMaxVoltrSummary(
  settings: string
): Promise<EarnMaxSummary> {
  const authority = deriveEarnMaxVoltrAuthority(
    settings,
    getServerEnv().loyalSmartAccounts.programId
  );
  const [position, forecastApyBps] = await Promise.all([
    readVoltrPosition(getConnection(), authority),
    readForecastApyBps(),
  ]);
  const pending = position.withdrawal;
  const canClaim =
    pending !== null && Date.now() / 1000 >= pending.withdrawableFromTs;
  return {
    balanceUsd: Number(position.valueRaw) / 1_000_000,
    claimAmountRaw: pending ? pending.payoutRaw.toString() : "0",
    coverage: "history_incomplete",
    currentOperationId: null,
    earnedUsd: null,
    forecastApyBps,
    // Pooled vault: nothing to install, so the deposit pane skips install().
    goal: "active",
    policyAccounts: [],
    policyStatus: "ready",
    realizedApyBps: null,
    strategyKey: null,
    withdrawal: pending
      ? {
          amountRaw: pending.payoutRaw.toString(),
          canCancel: false,
          canClaim,
          readyBy: new Date(pending.withdrawableFromTs * 1000).toISOString(),
          requestId: voltrUserAccounts(authority).receipt.toBase58(),
          status: canClaim ? "claimable" : "requested",
        }
      : null,
  };
}
