import { after, NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { EarnEarningsUnavailableError } from "@/lib/yield-optimization/earnings-read-service.server";
import { readCachedEarnEarningsRangeSet } from "@/lib/yield-optimization/earnings-cache.server";
import type { EarnEarningsUnavailableResponse } from "@/lib/yield-optimization/earnings.shared";

const EARN_VAULT_INDEX = 1;
export const maxDuration = 300;

export async function GET(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);
  if (!principal) {
    return NextResponse.json(
      {
        error: { code: "unauthenticated", message: "No active auth session." },
      },
      { status: 401 }
    );
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const timezone = new URL(request.url).searchParams.get("timezone");
  try {
    return NextResponse.json(
      await readCachedEarnEarningsRangeSet(
        {
          cluster,
          settings: principal.settingsPda,
          timezone,
          vaultIndex: EARN_VAULT_INDEX,
          walletAddress: principal.walletAddress,
        },
        after
      )
    );
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
