import { NextResponse } from "next/server";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import {
  findCurrentEarnAutodepositState,
  requestImmediateEarnAutodepositScheduledSweep,
  type BalanceSweepTargetRecord,
  type ImmediateEarnAutodepositScheduledSweepRequestResult,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";

// Mobile twin of `yield-optimization/autodeposit/sweeps/execute`. Lets the
// native app ask the worker to run the pending scheduled Autodeposit sweep now
// instead of waiting out its ~1h window. The web route trusts the session
// principal; mobile authenticates with a purpose-scoped wallet signature, then
// self-resolves the smart account before the shared repository call. Like the
// session route, the sweep is identified from the wallet's active policy (no
// body params) and execution is delegated to the worker by advancing
// `eligibleAfter`. Keep in sync with the session route.
const EARN_VAULT_INDEX = 1 as const;

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function serializeTarget(target: BalanceSweepTargetRecord) {
  return {
    active: target.active,
    balanceSweepPolicyId: target.balanceSweepPolicyId?.toString() ?? null,
    id: target.id.toString(),
    lifecycleStatus: target.lifecycleStatus,
    policyAccount: target.policyAccount,
    recurringDelegation: target.recurringDelegation,
    walletBalanceFloorRaw: target.walletBalanceFloorRaw?.toString() ?? null,
  };
}

function serializeRequestResult(
  result: ImmediateEarnAutodepositScheduledSweepRequestResult
) {
  return {
    acceleratedAmountRaw: result.acceleratedAmountRaw.toString(),
    acceleratedLotCount: result.acceleratedLotCount,
    eligibleAfter: result.eligibleAfter.toISOString(),
    targetId: result.targetId.toString(),
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_request", "Invalid request body.");
  }

  let walletAddress: string;
  try {
    ({ walletAddress } = await authenticateMobileWalletRequest({
      body,
      purpose: "earn-autodeposit-sweep-execute",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let settingsPda: string;
  try {
    const user = await getOrCreateCurrentUser({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const existing = await findReadyCurrentUserSmartAccount({
      userId: user.id,
    });
    if (!existing) {
      return jsonError(
        409,
        "smart_account_not_ready",
        "No provisioned smart account for this wallet."
      );
    }
    settingsPda = existing.settingsPda;
  } catch (error) {
    console.error("[mobile-earn-autodeposit-sweeps-execute] resolve failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown resolve error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "resolve_failed",
      "Failed to resolve the smart account for this wallet."
    );
  }

  try {
    const autodeposit = await findCurrentEarnAutodepositState({
      settings: settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress,
    });

    if (!autodeposit) {
      return jsonError(
        404,
        "autodeposit_not_found",
        "No Earn Autodeposit policy is available for this wallet."
      );
    }

    if (autodeposit.status !== "active") {
      return jsonError(
        409,
        "autodeposit_not_active",
        "Earn Autodeposit must be active before a scheduled sweep can be executed now."
      );
    }

    const requestResult =
      await requestImmediateEarnAutodepositScheduledSweep(autodeposit);

    if (!requestResult) {
      return jsonError(
        409,
        "no_scheduled_sweeps",
        "There are no pending scheduled Autodeposit sweeps to execute now."
      );
    }

    return NextResponse.json({
      status: "requested",
      sweepRequest: serializeRequestResult(requestResult),
      target: serializeTarget(autodeposit.target),
    });
  } catch (error) {
    console.error("[mobile-earn-autodeposit-sweeps-execute] request failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown request error.",
      errorName: error instanceof Error ? error.name : typeof error,
      settings: settingsPda,
      walletAddress,
    });

    return jsonError(
      500,
      "request_failed",
      error instanceof Error
        ? error.message
        : "Failed to request immediate Autodeposit sweep execution."
    );
  }
}
