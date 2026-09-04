import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";

import { findCurrentUser } from "@/features/chat/server/app-user";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  createEmptyEarnEarningsRangeSet,
  EarnEarningsUnavailableError,
  readEarnEarningsRangeSet,
} from "@/lib/yield-optimization/earnings-read-service.server";
import type { EarnEarningsUnavailableResponse } from "@/lib/yield-optimization/earnings.shared";

const EARN_VAULT_INDEX = 1;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const walletAddress = url.searchParams.get("walletAddress")?.trim() ?? "";
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

  const user = await findCurrentUser({
    authMethod: "wallet",
    provider: "solana",
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
    return NextResponse.json(
      createEmptyEarnEarningsRangeSet({
        now: new Date(),
        timezone: url.searchParams.get("timezone"),
      })
    );
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  try {
    const payload = await readEarnEarningsRangeSet({
      cluster,
      settings: account.settingsPda,
      timezone: url.searchParams.get("timezone"),
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const code =
      error instanceof EarnEarningsUnavailableError
        ? error.code
        : "earnings_unavailable";
    const payload: EarnEarningsUnavailableResponse = {
      error: {
        code,
        ...(error instanceof EarnEarningsUnavailableError
          ? { detailCode: error.detailCode }
          : {}),
        message:
          code === "history_incomplete"
            ? "Earn history is still updating."
            : "Earn earnings are unavailable.",
      },
      freshness: "unavailable",
      outcome: "unavailable",
    };
    return NextResponse.json(payload, { status: 503 });
  }
}
