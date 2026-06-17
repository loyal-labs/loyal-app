import { NextResponse } from "next/server";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { parseEarnDepositConfirmRequestBody } from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  EarnDepositConfirmError,
  recordConfirmedEarnDeposit,
} from "@/lib/yield-optimization/earn-deposit-confirm.server";
import type { ConfirmedYieldDepositInput } from "@/lib/yield-optimization/yield-deposit-repository.server";

// Mobile twin of `yield-optimization/deposits/confirm`. Wallet-signed (no
// session), resolves the same canonical smart account, then defers to the
// shared `recordConfirmedEarnDeposit` so the on-chain verification + recording
// is byte-identical to the web flow.

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
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
      purpose: "earn-deposit-confirm",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let input: ConfirmedYieldDepositInput;
  try {
    input = parseEarnDepositConfirmRequestBody(body);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  // The account must already exist — `prepare` provisions it before the deposit
  // is ever signed. Resolve it read-only (no provisioning here).
  let smartAccountAddress: string;
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
    smartAccountAddress = existing.smartAccountAddress;
    settingsPda = existing.settingsPda;
  } catch (error) {
    console.error("[mobile-earn-deposit-confirm] resolve failed", {
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
    const position = await recordConfirmedEarnDeposit({
      principal: { walletAddress, smartAccountAddress, settingsPda },
      input,
    });
    return NextResponse.json({ position });
  } catch (error) {
    if (error instanceof EarnDepositConfirmError) {
      return jsonError(error.status, error.code, error.message);
    }
    throw error;
  }
}
