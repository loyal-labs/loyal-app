import { NextResponse } from "next/server";

import { findCurrentUser } from "@/features/chat/server/app-user";
import { issueEarnRealtimeToken } from "@/features/earn-realtime/server/token.server";
import { authenticateMobileEarnRequest } from "@/features/identity/server/mobile-earn-session";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { headers: { "Cache-Control": "no-store" }, status }
  );
}

export async function POST(request: Request) {
  let walletAddress: string;
  try {
    ({ walletAddress } = await authenticateMobileEarnRequest({
      body: {},
      purpose: "earn-autodeposit-toggle-confirm",
      request,
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile Earn auth failed.");
  }

  const user = await findCurrentUser({
    authMethod: "wallet",
    provider: "solana",
    subjectAddress: walletAddress,
    walletAddress,
  });
  if (!user) {
    return jsonError(409, "smart_account_not_ready", "No smart account exists.");
  }
  const account = await findReadyCurrentUserSmartAccount({
    userId: user.id,
    walletAddress,
  });
  if (!account) {
    return jsonError(409, "smart_account_not_ready", "No smart account exists.");
  }

  try {
    const serverEnv = getServerEnv();
    if (!serverEnv.earnRealtime.authSecret) {
      return jsonError(503, "realtime_unavailable", "Earn realtime is unavailable.");
    }
    const issued = issueEarnRealtimeToken({
      authSecret: serverEnv.earnRealtime.authSecret,
      clientKind: "mobile",
      principal: {
        authMethod: "wallet",
        provider: "solana",
        settingsPda: account.settingsPda,
        smartAccountAddress: account.smartAccountAddress,
        subjectAddress: walletAddress,
        walletAddress,
      },
      programId: serverEnv.loyalSmartAccounts.programId,
      solanaEnv: serverEnv.solanaEnv,
    });
    return NextResponse.json(
      {
        accessToken: issued.accessToken,
        eventsUrl: serverEnv.earnRealtime.eventsUrl,
        expiresAt: issued.expiresAt,
        schemaVersion: 1,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[mobile-earn-realtime-token] issuance failed", {
      errorMessage: error instanceof Error ? error.message : "Unknown error.",
      walletAddress,
    });
    return jsonError(503, "realtime_unavailable", "Earn realtime is unavailable.");
  }
}
