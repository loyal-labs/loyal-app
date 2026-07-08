import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { findCurrentUser } from "@/features/chat/server/app-user";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  healPendingEarnAutodepositArtifactProofs,
  probeEarnAutodepositArtifacts,
} from "@/lib/yield-optimization/earn-autodeposit-artifacts.server";
import { readEarnAutodepositBootstrapWalletBalanceSnapshot } from "@/lib/yield-optimization/earn-autodeposit-bootstrap.server";
import { getDisplayableEarnAutodepositScheduledSweeps } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import {
  findCurrentEarnAutodepositState,
  findPendingEarnAutodepositScheduledSweeps,
  markAutodepositTargetActiveFromArtifacts,
  markAutodepositTargetClosedFromChain,
  markAutodepositTargetPendingDelegation,
  reconcileStaleEarnAutodepositScheduledSweeps,
  scheduleBootstrapEarnAutodepositSweep,
  type CurrentEarnAutodepositState,
  type PendingEarnAutodepositScheduledSweepRecord,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";

// Read-only mobile autodeposit state, keyed by wallet address (no signature, no
// provisioning) — mirrors `mobile/earn/state`. Drives the native Autodeposit
// control: whether it's set up, the threshold (walletBalanceFloorRaw), the
// on/off state, and the policy/delegation the floor/toggle/close calls need.
const EARN_VAULT_INDEX = 1 as const;
const RECONCILE_BOOTSTRAP_BALANCE_SOURCE =
  "mobile_autodeposit_artifact_reconcile";
const RECONCILE_BOOTSTRAP_BALANCE_SOURCE_COMMITMENT = "confirmed";
const connectionCache = new Map<SolanaEnv, Connection>();

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

// Mirror the web `serializeScheduledSweep` shape (bigint -> string, Date -> ISO)
// so the native Scheduled row reads the same fields the web pane does.
function serializeScheduledSweep(
  sweep: PendingEarnAutodepositScheduledSweepRecord
) {
  return {
    classification: sweep.classification,
    confidence: sweep.confidence,
    eligibleAfter: sweep.eligibleAfter.toISOString(),
    executeNowAvailableAt:
      sweep.executeNowAvailableAt?.toISOString() ?? null,
    id: sweep.id.toString(),
    lotCount: sweep.lotCount,
    originalAmountRaw: sweep.originalAmountRaw.toString(),
    reason: sweep.reason,
    remainingAmountRaw: sweep.remainingAmountRaw.toString(),
    slotId: sweep.slotId.toString(),
    status: sweep.status,
  };
}

function getConfiguredSolanaEnv(): SolanaEnv {
  return resolveLoyalWebSolanaEnvFromEnv(process.env);
}

// Everything the device needs to run the SDK's autodeposit prepare locally
// (client-side instruction building) instead of calling `setup/prepare`.
// Null when the deployment isn't configured for it (missing signer env or an
// unsupported cluster) — the read-only state above must still be served.
function buildPrepareContext(): {
  cluster: string;
  policySigner: string;
  programId: string;
} | null {
  try {
    return {
      cluster: resolveLoyalClusterForSolanaEnv(getConfiguredSolanaEnv()),
      policySigner: getDeploymentPolicySignerPublicKey().toBase58(),
      programId: getServerEnv().loyalSmartAccounts.programId,
    };
  } catch (error) {
    console.warn("[mobile-earn-autodeposit-state] prepare context unavailable", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown context error.",
    });
    return null;
  }
}

function getConnection(cluster: SolanaEnv): Connection {
  const cached = connectionCache.get(cluster);
  if (cached) {
    return cached;
  }

  const { rpcEndpoint, websocketEndpoint } = getServerSolanaEndpoints(cluster);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(cluster, connection);
  return connection;
}

async function reconcileAutodepositArtifacts(args: {
  connection: Connection;
  settings: string;
  smartAccountsProgramId: PublicKey;
  state: CurrentEarnAutodepositState;
  walletAddress: string;
}): Promise<CurrentEarnAutodepositState> {
  const recurringDelegation = args.state.target.recurringDelegation;
  if (!recurringDelegation) {
    return args.state;
  }

  const probe = await probeEarnAutodepositArtifacts({
    connection: args.connection,
    policyAccount: args.state.target.policyAccount,
    recurringDelegation,
    smartAccountsProgramId: args.smartAccountsProgramId,
  });
  const policyReady = probe.policy.exists && !probe.policy.invalidOwner;
  const delegationReady =
    probe.recurringDelegation.exists && !probe.recurringDelegation.invalidOwner;
  const hasRecordedPolicy =
    args.state.target.policySignature !== null &&
    args.state.target.policyConfirmedSlot !== null;
  const hasRecordedDelegation =
    args.state.target.recurringDelegationSignature !== null &&
    args.state.target.recurringDelegationConfirmedSlot !== null;

  // Both stage transactions were recorded and both accounts are gone from
  // chain: the autodeposit was closed on-chain but the close confirm never
  // reached the DB (or lost a write race against this reconciler). Record the
  // close — demoting to pending would strand the row as a live autodeposit
  // the close flow can no longer tear down.
  if (
    hasRecordedPolicy &&
    hasRecordedDelegation &&
    !policyReady &&
    !delegationReady
  ) {
    const target = await markAutodepositTargetClosedFromChain({
      policyAccount: args.state.target.policyAccount,
      settings: args.settings,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: args.walletAddress,
    });
    return { ...args.state, target };
  }

  if (args.state.status !== "pending" && (!policyReady || !delegationReady)) {
    const target = await markAutodepositTargetPendingDelegation({
      lifecycleStatus: policyReady
        ? "pending_delegation"
        : delegationReady
        ? "pending_policy"
        : "pending_delegation",
      policyAccount: args.state.target.policyAccount,
      settings: args.settings,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: args.walletAddress,
    });
    return { ...args.state, status: "pending", target };
  }

  if (args.state.status === "pending" && policyReady && delegationReady) {
    let target = args.state.target;
    if (!hasRecordedPolicy || !hasRecordedDelegation) {
      // A stage transaction can land while its confirm never reaches the DB;
      // retry flows skip already-existing stages, so the missing proof would
      // strand the row in pending forever. Backfill it from chain history
      // once the artifacts verify as canonical.
      const healed = await healPendingEarnAutodepositArtifactProofs({
        connection: args.connection,
        smartAccountsProgramId: args.smartAccountsProgramId,
        target,
      });
      const proofsComplete =
        healed != null &&
        healed.policySignature != null &&
        healed.policyConfirmedSlot != null &&
        healed.recurringDelegationSignature != null &&
        healed.recurringDelegationConfirmedSlot != null;
      if (!proofsComplete) {
        return healed ? { ...args.state, target: healed } : args.state;
      }
      target = healed;
    }
    const activeTarget = await markAutodepositTargetActiveFromArtifacts({
      policyAccount: target.policyAccount,
      settings: args.settings,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: args.walletAddress,
    });
    return { ...args.state, status: "active", target: activeTarget };
  }

  return args.state;
}

export async function GET(request: Request) {
  const walletAddress =
    new URL(request.url).searchParams.get("walletAddress")?.trim() ?? "";
  if (!walletAddress) {
    return jsonError(400, "invalid_request", "walletAddress is required.");
  }
  try {
    decodeWalletAddress(walletAddress);
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(400, "invalid_request", "walletAddress is invalid.");
  }

  const emptyState = {
    autodeposit: null,
    prepareContext: null,
    settingsPda: null,
    smartAccountAddress: null,
  };

  try {
    const user = await findCurrentUser({
      authMethod: "wallet",
      provider: "solana",
      subjectAddress: walletAddress,
      walletAddress,
    });
    if (!user) {
      return NextResponse.json(emptyState);
    }

    const account = await findReadyCurrentUserSmartAccount({
      userId: user.id,
      walletAddress,
    });
    if (!account) {
      return NextResponse.json(emptyState);
    }

    const state = await findCurrentEarnAutodepositState({
      settings: account.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress,
    });
    if (!state) {
      return NextResponse.json({
        autodeposit: null,
        prepareContext: buildPrepareContext(),
        settingsPda: account.settingsPda,
        smartAccountAddress: account.smartAccountAddress,
      });
    }
    const serverEnv = getServerEnv();
    const connection = getConnection(getConfiguredSolanaEnv());
    const reconciledState = await reconcileAutodepositArtifacts({
      connection,
      settings: account.settingsPda,
      smartAccountsProgramId: new PublicKey(
        serverEnv.loyalSmartAccounts.programId
      ),
      state,
      walletAddress,
    });
    // Reconcile (or a concurrent close confirm surfaced by its write guards)
    // concluded the autodeposit is closed — render it exactly like no row.
    if (reconciledState.target.lifecycleStatus === "closed") {
      return NextResponse.json({
        autodeposit: null,
        prepareContext: buildPrepareContext(),
        settingsPda: account.settingsPda,
        smartAccountAddress: account.smartAccountAddress,
      });
    }
    const activatedFromPending =
      state.status === "pending" && reconciledState.status === "active";
    if (activatedFromPending) {
      try {
        const snapshotResult =
          await readEarnAutodepositBootstrapWalletBalanceSnapshot({
            connection,
            source: RECONCILE_BOOTSTRAP_BALANCE_SOURCE,
            sourceCommitment: RECONCILE_BOOTSTRAP_BALANCE_SOURCE_COMMITMENT,
            target: reconciledState.target,
          });
        if (snapshotResult.status === "ok") {
          await scheduleBootstrapEarnAutodepositSweep({
            snapshot: snapshotResult.snapshot,
            target: reconciledState.target,
          });
        }
      } catch (error) {
        console.warn(
          "[mobile-earn-autodeposit-state] bootstrap reconcile failed",
          {
            errorMessage:
              error instanceof Error
                ? error.message
                : "Unknown bootstrap reconcile error.",
            policyAccount: reconciledState.target.policyAccount,
            walletAddress,
          }
        );
      }
    }

    let scheduledSweeps =
      reconciledState.status === "active"
        ? await findPendingEarnAutodepositScheduledSweeps(
            reconciledState.target
          )
        : [];
    // Clear stale scheduled sweeps the wallet can no longer back (surplus already
    // swept or spent) so the Activity row disappears instead of lingering as a
    // phantom "Execute now". Only runs when there's a sweep to evaluate.
    if (scheduledSweeps.length > 0) {
      try {
        const balanceSnapshot =
          await readEarnAutodepositBootstrapWalletBalanceSnapshot({
            connection,
            source: RECONCILE_BOOTSTRAP_BALANCE_SOURCE,
            sourceCommitment: RECONCILE_BOOTSTRAP_BALANCE_SOURCE_COMMITMENT,
            target: reconciledState.target,
          });
        if (balanceSnapshot.status === "ok") {
          const reconcile = await reconcileStaleEarnAutodepositScheduledSweeps({
            target: reconciledState.target,
            walletTokenBalanceRaw: balanceSnapshot.snapshot.amountRaw,
          });
          if (
            reconcile.canceledSlotCount > 0 ||
            reconcile.suppressedLotCount > 0
          ) {
            scheduledSweeps = await findPendingEarnAutodepositScheduledSweeps(
              reconciledState.target
            );
          }
        }
      } catch (error) {
        console.warn(
          "[mobile-earn-autodeposit-state] stale sweep reconcile failed",
          {
            errorMessage:
              error instanceof Error
                ? error.message
                : "Unknown reconcile error.",
            policyAccount: reconciledState.target.policyAccount,
            walletAddress,
          }
        );
      }
    }

    return NextResponse.json({
      autodeposit: {
        active: reconciledState.target.active,
        status: reconciledState.status,
        policyAccount: reconciledState.target.policyAccount,
        recurringDelegation: reconciledState.target.recurringDelegation,
        walletBalanceFloorRaw:
          reconciledState.target.walletBalanceFloorRaw?.toString() ?? null,
        lifecycleStatus: reconciledState.target.lifecycleStatus,
        vaultIndex: EARN_VAULT_INDEX,
        // Resume metadata for the device-side prepare: a half-finished setup
        // (pending_policy/pending_delegation) must reuse the recorded seed,
        // nonce and window so the SDK returns the missing stage for the SAME
        // policy/delegation pair — mirrors the `setup/prepare` resume logic.
        policySeed: reconciledState.target.policySeed.toString(),
        recurringDelegationNonce:
          reconciledState.target.recurringDelegationNonce?.toString() ?? null,
        periodLengthSeconds:
          reconciledState.target.periodLengthSeconds?.toString() ?? null,
        startTimestamp:
          reconciledState.target.startTimestamp?.toString() ?? null,
        recurringDelegationExpiryTimestamp:
          reconciledState.target.recurringDelegationExpiryTimestamp?.toString() ??
          null,
        scheduledSweeps: getDisplayableEarnAutodepositScheduledSweeps(
          reconciledState.status,
          scheduledSweeps
        ).map(serializeScheduledSweep),
      },
      prepareContext: buildPrepareContext(),
      settingsPda: account.settingsPda,
      smartAccountAddress: account.smartAccountAddress,
    });
  } catch (error) {
    console.error("[mobile-earn-autodeposit-state] read failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown read error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "autodeposit_state_failed",
      "Failed to load Autodeposit state."
    );
  }
}
