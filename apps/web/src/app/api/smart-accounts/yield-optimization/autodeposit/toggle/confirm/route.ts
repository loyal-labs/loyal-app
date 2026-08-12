import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  parseEarnAutodepositToggleConfirmRequestBody,
  type EarnAutodepositToggleConfirmResponse,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  updateAutodepositTargetActive,
  type BalanceSweepTargetRecord,
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
): EarnAutodepositToggleConfirmResponse["target"] {
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

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: ReturnType<typeof parseEarnAutodepositToggleConfirmRequestBody>;
  try {
    input = parseEarnAutodepositToggleConfirmRequestBody(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  try {
    const target = await updateAutodepositTargetActive({
      active: input.active,
      policyAccount: input.policyAccount,
      recurringDelegation: input.recurringDelegation,
      settings: principal.settingsPda,
      vaultIndex: input.vaultIndex,
      walletAddress: principal.walletAddress,
    });

    return NextResponse.json({ target: serializeTarget(target) });
  } catch (error) {
    return jsonError(
      400,
      "toggle_failed",
      error instanceof Error
        ? error.message
        : "Failed to update Autodeposit active state."
    );
  }
}
