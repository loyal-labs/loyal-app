import "server-only";

import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { and, asc, eq, gte } from "drizzle-orm";

import { resolveLoyalSmartAccountsProgramIdFromEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

import { verifyEarnFullExitZeroBalances } from "./earn-full-exit-zero-proof.server";
import { serializeRoutePolicyState } from "./earn-state-serializers.server";
import {
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
async function findGhostCandidates(limit: number): Promise<GhostCandidate[]> {
  const client = getYieldOptimizationClient();
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
        eq(
          userYieldPositionWithdrawals.settings,
          userYieldPositions.settings
        ),
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
    .orderBy(asc(userYieldPositions.updatedAt))
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
  return close ? { signature: close.signature, slot: BigInt(close.slot) } : null;
}
