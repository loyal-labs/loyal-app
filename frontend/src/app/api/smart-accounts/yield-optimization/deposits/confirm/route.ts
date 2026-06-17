import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { parseEarnDepositConfirmRequestBody } from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  EarnDepositConfirmError,
  recordConfirmedEarnDeposit,
} from "@/lib/yield-optimization/earn-deposit-confirm.server";
import type { ConfirmedYieldDepositInput } from "@/lib/yield-optimization/yield-deposit-repository.server";

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: ConfirmedYieldDepositInput;
  try {
    input = parseEarnDepositConfirmRequestBody(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  try {
    const position = await recordConfirmedEarnDeposit({
      principal: {
        walletAddress: principal.walletAddress,
        smartAccountAddress: principal.smartAccountAddress,
        settingsPda: principal.settingsPda,
      },
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
