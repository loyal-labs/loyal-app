import { NextResponse } from "next/server";
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
import { probeEarnAutodepositArtifacts } from "@/lib/yield-optimization/earn-autodeposit-artifacts.server";
import { readEarnAutodepositBootstrapWalletBalanceSnapshot } from "@/lib/yield-optimization/earn-autodeposit-bootstrap.server";
import {
  findCurrentEarnAutodepositState,
  findPendingEarnAutodepositScheduledSweeps,
  markAutodepositTargetActiveFromArtifacts,
  markAutodepositTargetPendingDelegation,
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

  if (args.state.status !== "pending" && (!policyReady || !delegationReady)) {
    const target = await markAutodepositTargetPendingDelegation({
      policyAccount: args.state.target.policyAccount,
      settings: args.settings,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: args.walletAddress,
    });
    return { ...args.state, status: "pending", target };
  }

  if (args.state.status === "pending" && policyReady && delegationReady) {
    const target = await markAutodepositTargetActiveFromArtifacts({
      policyAccount: args.state.target.policyAccount,
      settings: args.settings,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: args.walletAddress,
    });
    return { ...args.state, status: "active", target };
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

    const account = await findReadyCurrentUserSmartAccount({ userId: user.id });
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

    const scheduledSweeps = await findPendingEarnAutodepositScheduledSweeps(
      reconciledState.target
    );

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
        scheduledSweeps: scheduledSweeps.map(serializeScheduledSweep),
      },
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
