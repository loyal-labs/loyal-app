import { NextResponse } from "next/server";

import { findCurrentUser } from "@/features/chat/server/app-user";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { findCurrentEarnAutodepositState } from "@/lib/yield-optimization/earn-autodeposit-repository.server";

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
