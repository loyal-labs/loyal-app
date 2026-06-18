import { NextResponse } from "next/server";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import {
  parseEarnAutodepositToggleConfirmRequestBody,
  type EarnAutodepositToggleConfirmResponse,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  updateAutodepositTargetActive,
  type BalanceSweepTargetRecord,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";

// Mobile twin of `yield-optimization/autodeposit/toggle/confirm`. Enable/disable
// is a DB-only flag flip (no on-chain signing); the recurring delegation stays
// in place and the sweep worker honors `active`. Keep in sync with the session
// route.
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
      purpose: "earn-autodeposit-toggle-confirm",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let input: ReturnType<typeof parseEarnAutodepositToggleConfirmRequestBody>;
  try {
    input = parseEarnAutodepositToggleConfirmRequestBody(body);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
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
    console.error("[mobile-earn-autodeposit-toggle-confirm] resolve failed", {
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
    const target = await updateAutodepositTargetActive({
      active: input.active,
      policyAccount: input.policyAccount,
      recurringDelegation: input.recurringDelegation,
      settings: settingsPda,
      vaultIndex: input.vaultIndex,
      walletAddress,
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
