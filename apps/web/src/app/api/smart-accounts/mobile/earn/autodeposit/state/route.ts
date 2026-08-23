import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import { findCurrentUser } from "@/features/chat/server/app-user";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import { getDisplayableEarnAutodepositScheduledSweeps } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import {
  findCurrentEarnAutodepositState,
  findPendingEarnAutodepositScheduledSweeps,
  type PendingEarnAutodepositScheduledSweepRecord,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";

// Read-only mobile autodeposit state, keyed by wallet address (no signature, no
// provisioning) — mirrors `mobile/earn/state`. Drives the native Autodeposit
// control: whether it's set up, the threshold (walletBalanceFloorRaw), the
// on/off state, and the policy/delegation the floor/toggle/close calls need.
const EARN_VAULT_INDEX = 1 as const;

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
    executeNowAvailableAt: sweep.executeNowAvailableAt?.toISOString() ?? null,
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
    console.warn(
      "[mobile-earn-autodeposit-state] prepare context unavailable",
      {
        errorMessage:
          error instanceof Error ? error.message : "Unknown context error.",
      }
    );
    return null;
  }
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
    if (state.target.lifecycleStatus === "closed") {
      return NextResponse.json({
        autodeposit: null,
        prepareContext: buildPrepareContext(),
        settingsPda: account.settingsPda,
        smartAccountAddress: account.smartAccountAddress,
      });
    }
    const scheduledSweeps =
      state.status === "active"
        ? await findPendingEarnAutodepositScheduledSweeps(state.target)
        : [];
    return NextResponse.json({
      autodeposit: {
        active: state.target.active,
        status: state.status,
        policyAccount: state.target.policyAccount,
        recurringDelegation: state.target.recurringDelegation,
        walletBalanceFloorRaw:
          state.target.walletBalanceFloorRaw?.toString() ?? null,
        lifecycleStatus: state.target.lifecycleStatus,
        vaultIndex: EARN_VAULT_INDEX,
        // Resume metadata for the device-side prepare: a half-finished setup
        // (pending_policy/pending_delegation) must reuse the recorded seed,
        // nonce and window so the SDK returns the missing stage for the SAME
        // policy/delegation pair — mirrors the `setup/prepare` resume logic.
        policySeed: state.target.policySeed.toString(),
        recurringDelegationNonce:
          state.target.recurringDelegationNonce?.toString() ?? null,
        periodLengthSeconds:
          state.target.periodLengthSeconds?.toString() ?? null,
        startTimestamp: state.target.startTimestamp?.toString() ?? null,
        recurringDelegationExpiryTimestamp:
          state.target.recurringDelegationExpiryTimestamp?.toString() ?? null,
        scheduledSweeps: getDisplayableEarnAutodepositScheduledSweeps(
          state.status,
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
