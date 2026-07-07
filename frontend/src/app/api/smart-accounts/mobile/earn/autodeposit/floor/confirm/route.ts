import { NextResponse } from "next/server";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import {
  autodepositSweepScheduledPush,
  sendWalletPush,
} from "@/lib/push-notifications/wallet-push.server";
import {
  parseEarnAutodepositFloorUpdateConfirmRequestBody,
  type EarnAutodepositSetupConfirmResponse,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  updateAutodepositWalletBalanceFloor,
  type BalanceSweepTargetRecord,
  type PendingEarnAutodepositScheduledSweepRecord,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";

// Mobile twin of `yield-optimization/autodeposit/floor/confirm`. Changing the
// threshold (walletBalanceFloorRaw) is a DB-only update — no on-chain signing —
// so this is just wallet-sig auth + self-resolved smart account in front of the
// shared repository call. Keep in sync with the session route.
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
): NonNullable<EarnAutodepositSetupConfirmResponse["rebaselineSweep"]>["sweep"] {
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
      purpose: "earn-autodeposit-floor-confirm",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let input: ReturnType<typeof parseEarnAutodepositFloorUpdateConfirmRequestBody>;
  try {
    input = parseEarnAutodepositFloorUpdateConfirmRequestBody(body);
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
    console.error("[mobile-earn-autodeposit-floor-confirm] resolve failed", {
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
    const result = await updateAutodepositWalletBalanceFloor({
      policyAccount: input.policyAccount,
      recurringDelegation: input.recurringDelegation,
      settings: settingsPda,
      vaultIndex: input.vaultIndex,
      walletAddress,
      walletBalanceFloorRaw: input.walletBalanceFloorRaw,
    });

    if (result.rebaselineSweep.status === "scheduled") {
      // Transactional push (ASK-1651): lowering the floor freed up USDC and a
      // sweep got scheduled.
      await sendWalletPush(
        walletAddress,
        autodepositSweepScheduledPush(
          result.rebaselineSweep.sweep.remainingAmountRaw
        )
      );
    }

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
