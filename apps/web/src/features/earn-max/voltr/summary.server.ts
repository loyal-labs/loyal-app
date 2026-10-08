import "server-only";

import { Connection } from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";

import type { EarnMaxSummary } from "../types";
import { readVoltrHistory, voltrActivity } from "./activity.server";
import { readEarnMaxVoltrApy } from "./apy.server";
import { readEarnMaxCurrentApyBps } from "./current-apy.server";
import {
  deriveEarnMaxVoltrAuthority,
  readVoltrPosition,
  voltrClaimBlockReason,
  voltrUserAccounts,
} from "./program";

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

function authorityFor(settings: string) {
  return deriveEarnMaxVoltrAuthority(
    settings,
    getServerEnv().loyalSmartAccounts.programId
  );
}

export async function readEarnMaxVoltrActivity(settings: string) {
  const authority = authorityFor(settings);
  const [position, history, apy] = await Promise.all([
    readVoltrPosition(getConnection(), authority),
    readVoltrHistory(getConnection(), authority),
    readEarnMaxVoltrApy(),
  ]);
  const { operations, performance } = voltrActivity(
    history,
    position,
    apy.dayEnd
  );
  return { operations, performance };
}

export async function readEarnMaxVoltrSummary(
  settings: string
): Promise<EarnMaxSummary> {
  const authority = authorityFor(settings);
  const [position, apy, history, currentApyBps] = await Promise.all([
    readVoltrPosition(getConnection(), authority),
    readEarnMaxVoltrApy(),
    readVoltrHistory(getConnection(), authority),
    readEarnMaxCurrentApyBps(),
  ]);
  const { earnedRaw } = voltrActivity(history, position);
  const pending = position.withdrawal;
  const blocked = voltrClaimBlockReason(position);
  const canClaim = blocked === null;
  return {
    balanceUsd: Number(position.valueRaw) / 1_000_000,
    claimAmountRaw: pending ? pending.payoutRaw.toString() : "0",
    coverage: history.complete ? "complete" : "history_incomplete",
    currentOperationId: null,
    earnedUsd: earnedRaw === null ? null : Number(earnedRaw) / 1_000_000,
    // Share-price APY over 7 days (or since launch, apyWindowDays); null = dash.
    apyHistory: apy.daily,
    apyWindowDays: apy.apyWindowDays,
    currentApyBps,
    forecastApyBps: apy.apyBps,
    // Pooled vault: nothing to install, so the deposit pane skips install().
    goal: "active",
    policyAccounts: [],
    policyStatus: "ready",
    realizedApyBps: apy.apyBps,
    strategyKey: null,
    withdrawal: pending
      ? {
          amountRaw: pending.payoutRaw.toString(),
          canCancel: false,
          canClaim,
          ...(blocked && blocked !== "not_ready"
            ? { claimBlockedReason: blocked }
            : {}),
          readyBy: new Date(pending.withdrawableFromTs * 1000).toISOString(),
          requestId: voltrUserAccounts(authority).receipt.toBase58(),
          status: canClaim
            ? "claimable"
            : blocked === "not_ready"
            ? "requested"
            : "unwinding",
        }
      : null,
  };
}
