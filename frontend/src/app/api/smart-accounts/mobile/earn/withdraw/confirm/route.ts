import { NextResponse } from "next/server";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { PublicKey } from "@solana/web3.js";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  buildEarnWithdrawalConfirmRequestBody,
  parseEarnWithdrawalConfirmRequestBody,
} from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  EarnWithdrawConfirmError,
  recordConfirmedEarnWithdrawal,
} from "@/lib/yield-optimization/earn-withdraw-confirm.server";
import {
  hydratePreparedEarnUsdcWithdraw,
  type WireSmartAccountPreparedEarnUsdcWithdraw,
} from "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared";

// Mobile twin of `yield-optimization/withdrawals/confirm`. The device echoes
// back the serialized prepared withdraw it signed plus, for one step at a time,
// that step's signature + slot (and the optional autodeposit-close signature).
// This route rebuilds the canonical confirm payload server-side (the web client
// does this in-browser) and defers to the shared `recordConfirmedEarnWithdrawal`
// core so the security-critical canonicalization can't drift.
type MobileWithdrawConfirmFields = {
  preparedWithdraw: WireSmartAccountPreparedEarnUsdcWithdraw;
  stepIndex?: number;
  withdrawalSignature: string;
  confirmedSlot: string;
  autodepositCloseSignature?: string;
  autodepositCloseConfirmedSlot?: string;
};

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function getConfiguredSolanaEnv(): SolanaEnv {
  return resolveLoyalWebSolanaEnvFromEnv(process.env);
}

// The Earn deposit/withdraw smart-account vault lives at index 1; index 0 is the
// wallet's main account. The confirm canonical keys on this vault.
const EARN_DEPOSIT_VAULT_INDEX = 1;

// Re-derive the Earn vault address (index 1) from the settings PDA — the value
// the confirm canonical expects as `smartAccountAddress`. findReadyCurrentUser-
// SmartAccount returns the main account (index 0), which would fail the canonical
// check and miss the vault-keyed position.
function deriveEarnVaultAddress(settingsPda: string): string {
  return pda
    .getSmartAccountPda({
      settingsPda: new PublicKey(settingsPda),
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
    })[0]
    .toBase58();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseMobileWithdrawConfirmFields(
  body: unknown
): MobileWithdrawConfirmFields {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object.");
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.preparedWithdraw !== "object" ||
    record.preparedWithdraw === null
  ) {
    throw new Error("preparedWithdraw is required.");
  }
  if (
    typeof record.withdrawalSignature !== "string" ||
    !record.withdrawalSignature
  ) {
    throw new Error("withdrawalSignature is required.");
  }
  if (typeof record.confirmedSlot !== "string" || !record.confirmedSlot) {
    throw new Error("confirmedSlot is required.");
  }
  let stepIndex: number | undefined;
  if (record.stepIndex !== undefined && record.stepIndex !== null) {
    if (
      typeof record.stepIndex !== "number" ||
      !Number.isInteger(record.stepIndex) ||
      record.stepIndex < 0
    ) {
      throw new Error("stepIndex must be a non-negative integer.");
    }
    stepIndex = record.stepIndex;
  }
  return {
    preparedWithdraw:
      record.preparedWithdraw as WireSmartAccountPreparedEarnUsdcWithdraw,
    stepIndex,
    withdrawalSignature: record.withdrawalSignature,
    confirmedSlot: record.confirmedSlot,
    autodepositCloseSignature: optionalString(record.autodepositCloseSignature),
    autodepositCloseConfirmedSlot: optionalString(
      record.autodepositCloseConfirmedSlot
    ),
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
      // Accepts the flow's prepare signature too — the device signs one auth
      // message per flow (see authenticateMobileWalletRequest).
      purpose: ["earn-withdraw-confirm", "earn-withdraw-prepare"],
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let fields: MobileWithdrawConfirmFields;
  try {
    fields = parseMobileWithdrawConfirmFields(body);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  // Resolve the account (must already exist — prepare required it).
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
      walletAddress,
    });
    if (!existing) {
      return jsonError(
        409,
        "smart_account_not_ready",
        "No provisioned smart account for this wallet."
      );
    }
    settingsPda = existing.settingsPda;
    // Earn confirm keys on the vault (index 1), not the main account (index 0).
    smartAccountAddress = deriveEarnVaultAddress(settingsPda);
  } catch (error) {
    console.error("[mobile-earn-withdraw-confirm] resolve failed", {
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
    const prepared = hydratePreparedEarnUsdcWithdraw(fields.preparedWithdraw);
    let preparedStep:
      | NonNullable<typeof prepared.withdrawSteps>[number]
      | undefined;
    if (fields.stepIndex !== undefined) {
      const step = prepared.withdrawSteps?.[fields.stepIndex];
      if (!step) {
        return jsonError(
          400,
          "invalid_request",
          "stepIndex is out of range for this prepared withdrawal."
        );
      }
      preparedStep = step;
    }

    const confirmBody = buildEarnWithdrawalConfirmRequestBody({
      preparedWithdraw: prepared,
      preparedStep,
      signature: fields.withdrawalSignature,
      confirmedSlot: fields.confirmedSlot,
      smartAccountAddress,
      autodepositCloseSignature: fields.autodepositCloseSignature,
      autodepositCloseConfirmedSlot: fields.autodepositCloseConfirmedSlot,
    });
    const input = parseEarnWithdrawalConfirmRequestBody(confirmBody);

    const result = await recordConfirmedEarnWithdrawal({
      principal: { walletAddress, smartAccountAddress, settingsPda },
      input,
      solanaEnv: getConfiguredSolanaEnv(),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof EarnWithdrawConfirmError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error("[mobile-earn-withdraw-confirm] build/record failed", {
      withdrawalSignature: fields.withdrawalSignature,
      errorMessage:
        error instanceof Error ? error.message : "Unknown confirm error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      400,
      "confirm_failed",
      error instanceof Error
        ? error.message
        : "Failed to confirm Earn withdrawal."
    );
  }
}
