import { NextResponse } from "next/server";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { parseEarnWithdrawalConfirmRequestBody } from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  EarnWithdrawConfirmError,
  recordConfirmedEarnWithdrawal,
} from "@/lib/yield-optimization/earn-withdraw-confirm.server";
import type { ConfirmedYieldWithdrawalInput } from "@/lib/yield-optimization/yield-deposit-repository.server";

// Session (web) Earn withdrawal confirm. Auth comes from the wallet session;
// the validation + recording is the shared `recordConfirmedEarnWithdrawal`
// core, which the mobile twin (`mobile/earn/withdraw/confirm`) also uses so the
// security-critical canonicalization can't drift between the two.
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

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: ConfirmedYieldWithdrawalInput;
  try {
    input = parseEarnWithdrawalConfirmRequestBody(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  try {
    const position = await recordConfirmedEarnWithdrawal({
      principal: {
        walletAddress: principal.walletAddress,
        smartAccountAddress: principal.smartAccountAddress,
        settingsPda: principal.settingsPda,
      },
      input,
      solanaEnv: getConfiguredSolanaEnv(),
    });
    return NextResponse.json({ position });
  } catch (error) {
    if (error instanceof EarnWithdrawConfirmError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(
      500,
      "record_failed",
      error instanceof Error
        ? error.message
        : "Confirmed yield withdrawal could not be recorded."
    );
  }
}
