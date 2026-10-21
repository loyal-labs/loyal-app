import "server-only";

import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { findCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileEarnRequest } from "@/features/identity/server/mobile-earn-session";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import {
  assertAuthenticatedWalletControlsSettings,
  findReadyCurrentUserSmartAccount,
  isSmartAccountProvisioningError,
} from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";

import { EARN_MAX_BACKEND } from "../constants";
import {
  readEarnMaxVoltrActivity,
  readEarnMaxVoltrSummary,
} from "../voltr/summary.server";

function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function failure(status: number, code: string, message: string) {
  return json({ error: { code, message } }, status);
}

/** Native auth resolves the canonical account server-side; callers cannot select it. */
export async function postMobileEarnMax(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !["summary", "activity", "context"].includes(body.action)) {
    return failure(400, "invalid_request", "Unknown Earn MAX action.");
  }
  try {
    const signed =
      request.headers.has("authorization") || body.signature != null;
    const principal = signed
      ? null
      : await resolveAuthenticatedPrincipalFromRequest(request);
    const walletAddress = signed
      ? (
          await authenticateMobileEarnRequest({
            request,
            body,
            purpose: "earn-max",
          })
        ).walletAddress
      : principal?.walletAddress;
    if (!walletAddress)
      return failure(401, "unauthenticated", "Sign in to access Earn MAX.");
    if (!signed && body.walletAddress !== walletAddress) {
      return failure(401, "wallet_mismatch", "Sign in with the active wallet.");
    }
    const config = getServerEnv();
    if (
      EARN_MAX_BACKEND !== "voltr" ||
      !["mainnet", "mainnet-beta"].includes(config.solanaEnv)
    ) {
      return failure(409, "unsupported_cluster", "Earn MAX requires mainnet.");
    }
    const user = await findCurrentUser({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const account = user
      ? await findReadyCurrentUserSmartAccount({
          userId: user.id,
          walletAddress,
        })
      : null;
    if (!account) {
      // Privy sign-in provisions this account; reads must never sponsor creation.
      return failure(
        409,
        "smart_account_required",
        "Sign in to set up your smart account."
      );
    }
    await assertAuthenticatedWalletControlsSettings({
      settingsPda: account.settingsPda,
      smartAccountAddress: account.smartAccountAddress,
      walletAddress,
    });
    if (body.action === "context") {
      return json({
        cluster: "mainnet",
        walletAddress,
        settingsPda: account.settingsPda,
        programId: config.loyalSmartAccounts.programId,
      });
    }
    if (body.action === "activity") {
      return json(await readEarnMaxVoltrActivity(account.settingsPda));
    }
    return json({
      config: {
        delegatedSigner: "",
        programId: config.loyalSmartAccounts.programId,
      },
      summary: await readEarnMaxVoltrSummary(account.settingsPda),
    });
  } catch (error) {
    if (
      error instanceof WalletAuthError ||
      isSmartAccountProvisioningError(error)
    ) {
      return failure(error.status, error.code, error.message);
    }
    // Never log the request body: it can contain an auth signature.
    console.error("[mobile-earn-max] request failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return failure(
      500,
      "earn_max_unavailable",
      "Earn MAX is temporarily unavailable."
    );
  }
}
