import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  findCurrentEarnAutodepositState,
  requestImmediateEarnAutodepositScheduledSweep,
  type BalanceSweepTargetRecord,
  type ImmediateEarnAutodepositScheduledSweepRequestResult,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";

const EARN_AUTODEPOSIT_VAULT_INDEX = 1;

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
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  try {
    const autodeposit = await findCurrentEarnAutodepositState({
      settings: principal.settingsPda,
      vaultIndex: EARN_AUTODEPOSIT_VAULT_INDEX,
      walletAddress: principal.walletAddress,
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

    const requestResult = await requestImmediateEarnAutodepositScheduledSweep(
      autodeposit
    );

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
    console.error("[earn-autodeposit-sweeps-execute] request failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown request error.",
      errorName: error instanceof Error ? error.name : typeof error,
      settings: principal.settingsPda,
      walletAddress: principal.walletAddress,
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
