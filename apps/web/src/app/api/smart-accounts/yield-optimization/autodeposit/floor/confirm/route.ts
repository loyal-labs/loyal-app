import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  parseEarnAutodepositFloorUpdateConfirmRequestBody,
  type EarnAutodepositSetupConfirmResponse,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  updateAutodepositWalletBalanceFloor,
  type BalanceSweepTargetRecord,
  type PendingEarnAutodepositScheduledSweepRecord,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function serializeTarget(
  target: BalanceSweepTargetRecord
): EarnAutodepositSetupConfirmResponse["target"] {
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

function serializeScheduledSweep(
  sweep: PendingEarnAutodepositScheduledSweepRecord
): NonNullable<
  EarnAutodepositSetupConfirmResponse["rebaselineSweep"]
>["sweep"] {
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

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: ReturnType<
    typeof parseEarnAutodepositFloorUpdateConfirmRequestBody
  >;
  try {
    input = parseEarnAutodepositFloorUpdateConfirmRequestBody(
      await request.json()
    );
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  try {
    const result = await updateAutodepositWalletBalanceFloor({
      policyAccount: input.policyAccount,
      recurringDelegation: input.recurringDelegation,
      settings: principal.settingsPda,
      vaultIndex: input.vaultIndex,
      walletAddress: principal.walletAddress,
      walletBalanceFloorRaw: input.walletBalanceFloorRaw,
    });

    return NextResponse.json({
      rebaselineSweep:
        result.rebaselineSweep.status === "scheduled"
          ? {
              status: result.rebaselineSweep.status,
              sweep: serializeScheduledSweep(result.rebaselineSweep.sweep),
            }
          : result.rebaselineSweep,
      target: serializeTarget(result.target),
    });
  } catch (error) {
    return jsonError(
      400,
      "update_failed",
      error instanceof Error
        ? error.message
        : "Failed to update autodeposit wallet balance floor."
    );
  }
}
