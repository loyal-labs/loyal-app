import "server-only";

import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { resolveLoyalSmartAccountsProgramIdFromEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

import { verifyEarnFullExitZeroBalances } from "./earn-full-exit-zero-proof.server";
import { serializeRoutePolicyState } from "./earn-state-serializers.server";
import {
  EARN_FINAL_EXIT_IDLE_DUST_TOLERANCE_RAW,
  findEarnCleanupVaultState,
  recordConfirmedEarnCleanup,
} from "./yield-deposit-repository.server";
import {
  getYieldOptimizationClient,
  userYieldPositions,
  userYieldPositionWithdrawals,
} from "./yield-neon-client.server";

// Finalizes "ghost" Earn positions: rows still `active` although the wallet's
// full withdrawal is recorded and the chain proves the exit. The two-phase
// exit (#481) made the cleanup confirm the only DB finalizer, so a dropped
// confirm (mobile fire-and-forget) or a cleanup the client never ran leaves
// the row active-at-$0 forever — which also dead-blocks the policy-refund
// scan with "Active Earn position". ASK-1844 found 260 such rows in the nine
// days after deploy. For each candidate this re-runs the same slot-pinned
// zero proof the confirm route uses (anchored at the RECORDED withdrawal
// slot, so a stale RPC read can never close a live position) and then
// finalizes through `recordConfirmedEarnCleanup`. Positions whose on-chain
// policies are still open finalize too: the wallet's rents then surface in
// the policy-refund scan, which is the user's recovery path.
const EARN_VAULT_INDEX = 1;
const DEFAULT_CANDIDATE_LIMIT = 15; // ~5 RPC calls each under a 5 rps budget
const POLICY_CLOSE_SIGNATURE_PROBE_LIMIT = 10;

export type EarnCleanupReconcileOutcome = {
  wallet: string;
  settings: string;
  vaultPubkey: string;
  status: "finalized" | "ready" | "skipped" | "error";
  // `confirm_missed`: cleanup landed on-chain but its confirm never recorded.
  // `cleanup_pending`: no cleanup transaction exists; policies remain open.
  ghostClass?: "confirm_missed" | "cleanup_pending";
  cleanupSignature?: string;
  reason?: string;
};

export type EarnCleanupReconcileSummary = {
  candidates: number;
  scanned: number;
  finalized: EarnCleanupReconcileOutcome[];
  skipped: number;
  errors: number;
  truncated: boolean;
  dryRun: boolean;
};

function getConnection(solanaEnv: SolanaEnv): Connection {
  const { rpcEndpoint, websocketEndpoint } =
    getServerSolanaEndpoints(solanaEnv);
  return new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
}

type GhostCandidate = {
  settings: string;
  vaultPubkey: string;
  walletAddress: string;
  withdrawalConfirmedSlot: bigint;
  withdrawalSignature: string;
};

// Active positions with a recorded full withdrawal at or after the position's
// last confirmed slot. A deposit that lands after the withdrawal advances
// `lastConfirmedSlot` past it, so resumed positions never qualify. One row
// per position (the newest qualifying withdrawal wins).
//
// Ordering has two jobs, because a skip is invisible: it neither closes the
// position nor touches `updatedAt`, so under a stable sort an unfinalizable row
// keeps its place at the head of the queue on every run, forever.
//
// First, rows that look exited sort ahead of rows that clearly still hold
// value. The slot guard above does not catch every resumed position — a
// re-deposit that leaves `lastConfirmedSlot` at or below the withdrawal slot
// still qualifies — and the chain proof refuses those every run. In production
// 37 such rows held the head of the queue and the cron was scanning 15 and
// finalizing 0 while 286 finalizable ghosts waited behind them (ASK-2021).
// They are deprioritised rather than filtered out, because the recorded amount
// can be stale: rows reading non-zero here have been proven fully exited on
// chain, so the proof, not this ordering, stays the authority on whether a
// position closes.
//
// Second, the order within each bucket is randomised. The bucket is a heuristic
// over a possibly-stale amount, so it cannot guarantee that everything sorted
// to the front is finalizable — a row reading zero here whose vault still holds
// idle liquidity is refused every run just the same. Randomising means no set
// of unfinalizable rows can hold the head of the queue: throughput degrades in
// proportion to how many are stuck instead of collapsing to zero the moment 15
// of them collect at the front. A durable per-candidate cooldown would target
// the retries more precisely, but it needs a column to persist attempts in;
// this keeps the guarantee without a migration.
//
// `updatedAt` is deliberately not used as a tiebreak. It is only advanced by a
// successful finalize, so ordering by it is what let the stuck rows pin
// themselves to the front in the first place.
export async function findGhostCandidates(
  limit: number,
  client: Pick<
    ReturnType<typeof getYieldOptimizationClient>,
    "db"
  > = getYieldOptimizationClient()
): Promise<GhostCandidate[]> {
  const looksExited = sql`${userYieldPositions.currentAmountRaw} < ${EARN_FINAL_EXIT_IDLE_DUST_TOLERANCE_RAW}`;
  const rows = await client.db
    .select({
      settings: userYieldPositions.settings,
      vaultPubkey: userYieldPositions.vaultPubkey,
      walletAddress: userYieldPositions.walletAddress,
      withdrawalConfirmedSlot: userYieldPositionWithdrawals.confirmedSlot,
      withdrawalSignature: userYieldPositionWithdrawals.withdrawalSignature,
    })
    .from(userYieldPositions)
    .innerJoin(
      userYieldPositionWithdrawals,
      and(
        eq(userYieldPositionWithdrawals.mode, "full"),
        eq(userYieldPositionWithdrawals.settings, userYieldPositions.settings),
        eq(
          userYieldPositionWithdrawals.vaultIndex,
          userYieldPositions.vaultIndex
        ),
        eq(
          userYieldPositionWithdrawals.vaultPubkey,
          userYieldPositions.vaultPubkey
        ),
        eq(
          userYieldPositionWithdrawals.walletAddress,
          userYieldPositions.walletAddress
        ),
        gte(
          userYieldPositionWithdrawals.confirmedSlot,
          userYieldPositions.lastConfirmedSlot
        )
      )
    )
    .where(
      and(
        eq(userYieldPositions.status, "active"),
        eq(userYieldPositions.vaultIndex, EARN_VAULT_INDEX)
      )
    )
    .orderBy(desc(looksExited), sql`random()`)
    .limit(limit * 4);

  const byPosition = new Map<string, GhostCandidate>();
  for (const row of rows) {
    const key = `${row.settings}:${row.vaultPubkey}:${row.walletAddress}`;
    const existing = byPosition.get(key);
    if (
      !existing ||
      row.withdrawalConfirmedSlot > existing.withdrawalConfirmedSlot
    ) {
      byPosition.set(key, row);
    }
  }
  return [...byPosition.values()];
}

export async function reconcileEarnCleanupGhosts(args: {
  dryRun?: boolean;
  limit?: number;
}): Promise<EarnCleanupReconcileSummary> {
  const dryRun = args.dryRun ?? false;
  const limit = args.limit ?? DEFAULT_CANDIDATE_LIMIT;
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const programId = new PublicKey(
    resolveLoyalSmartAccountsProgramIdFromEnv(process.env)
  );
  const connection = getConnection(solanaEnv);

  const candidates = await findGhostCandidates(limit);
  const summary: EarnCleanupReconcileSummary = {
    candidates: candidates.length,
    scanned: 0,
    finalized: [],
    skipped: 0,
    errors: 0,
    truncated: candidates.length > limit,
    dryRun,
  };

  for (const candidate of candidates.slice(0, limit)) {
    summary.scanned += 1;
    const outcome = await reconcileCandidate({
      candidate,
      cluster,
      connection,
      dryRun,
      programId,
    });
    if (outcome.status === "finalized" || outcome.status === "ready") {
      summary.finalized.push(outcome);
    } else if (outcome.status === "skipped") {
      summary.skipped += 1;
    } else {
      summary.errors += 1;
      console.error("[earn-cleanup-reconcile] candidate failed", outcome);
    }
  }
  return summary;
}

async function reconcileCandidate(args: {
  candidate: GhostCandidate;
  cluster: ReturnType<typeof resolveLoyalClusterForSolanaEnv>;
  connection: Connection;
  dryRun: boolean;
  programId: PublicKey;
}): Promise<EarnCleanupReconcileOutcome> {
  const { candidate, cluster, connection, dryRun, programId } = args;
  const base = {
    wallet: candidate.walletAddress,
    settings: candidate.settings,
    vaultPubkey: candidate.vaultPubkey,
  };

  try {
    const cleanupState = await findEarnCleanupVaultState({
      authority: candidate.walletAddress,
      includeInactive: true,
      settings: candidate.settings,
      vaultIndex: EARN_VAULT_INDEX,
      vaultPubkey: candidate.vaultPubkey,
    });
    if (!cleanupState) {
      return { ...base, status: "skipped", reason: "missing_policy_state" };
    }

    // Anchored server-side at the recorded withdrawal slot, exactly like the
    // confirm route: the proof can never observe a pre-exit snapshot.
    const minContextSlot = Number(candidate.withdrawalConfirmedSlot);
    if (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0) {
      return { ...base, status: "skipped", reason: "invalid_withdrawal_slot" };
    }

    const proof = await verifyEarnFullExitZeroBalances({
      cluster,
      connection,
      minContextSlot,
      policy: serializeRoutePolicyState(
        cleanupState.routePolicy,
        cleanupState.setupPolicy
      ),
      programId,
      settingsPda: new PublicKey(candidate.settings),
    });
    if (proof.status !== "policy_close_required") {
      // Balances remain — not a ghost (or the RPC is behind); leave it alone.
      return { ...base, status: "skipped", reason: "balances_remain" };
    }

    const policyAccounts = [
      cleanupState.routePolicy.policyAccount,
      ...(cleanupState.setupPolicy
        ? [cleanupState.setupPolicy.policyAccount]
        : []),
    ];
    const { context, value } =
      await connection.getMultipleAccountsInfoAndContext(
        policyAccounts.map((account) => new PublicKey(account)),
        { commitment: "confirmed", minContextSlot }
      );
    if (context.slot < minContextSlot) {
      return { ...base, status: "skipped", reason: "rpc_behind_exit_slot" };
    }
    const policiesClosed = value.every((account) => account === null);

    // The finalizing signature: the on-chain policy close when one exists,
    // otherwise the recorded withdrawal (the exit evidence) — cleanup never
    // ran for those, and the refund scan owns the remaining on-chain rents.
    let ghostClass: "confirm_missed" | "cleanup_pending" = "cleanup_pending";
    let cleanupSignature = candidate.withdrawalSignature;
    let confirmedSlot = candidate.withdrawalConfirmedSlot;
    if (policiesClosed) {
      ghostClass = "confirm_missed";
      const closeSignature = await resolvePolicyCloseSignature({
        connection,
        policyAccount: cleanupState.routePolicy.policyAccount,
      });
      if (closeSignature) {
        cleanupSignature = closeSignature.signature;
        confirmedSlot = closeSignature.slot;
      }
    }

    if (dryRun) {
      return { ...base, status: "ready", ghostClass, cleanupSignature };
    }

    await recordConfirmedEarnCleanup({
      cleanupSignature,
      cluster,
      confirmedSlot,
      settings: candidate.settings,
      vaultIndex: EARN_VAULT_INDEX,
      vaultPubkey: candidate.vaultPubkey,
      walletAddress: candidate.walletAddress,
    });

    console.info("[earn-cleanup-reconcile] ghost finalized", {
      ...base,
      cleanupSignature,
      confirmedSlot: confirmedSlot.toString(),
      ghostClass,
    });
    return { ...base, status: "finalized", ghostClass, cleanupSignature };
  } catch (error) {
    return {
      ...base,
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

// The close transaction is the policy account's most recent successful one —
// the account no longer exists past it.
async function resolvePolicyCloseSignature(args: {
  connection: Connection;
  policyAccount: string;
}): Promise<{ signature: string; slot: bigint } | null> {
  const signatures = await args.connection.getSignaturesForAddress(
    new PublicKey(args.policyAccount),
    { limit: POLICY_CLOSE_SIGNATURE_PROBE_LIMIT }
  );
  const close = signatures.find((entry) => entry.err === null);
  return close
    ? { signature: close.signature, slot: BigInt(close.slot) }
    : null;
}
