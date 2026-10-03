import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import type { EarnEarningsUnavailableResponse } from "@/lib/yield-optimization/earnings.shared";
import {
  createEarnEarningsReadDependencies,
  EarnEarningsUnavailableError,
  readEarnEarningsRangeSet,
} from "@/lib/yield-optimization/earnings-read-service.server";
import { isWorkersV2AppReadOnlyEarnGetsEnabled } from "@/lib/yield-optimization/workers-v2-app-contract.server";

const EARN_VAULT_INDEX = 1;

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
    // Workers-v2 read mode skips the earnings snapshot cache write
    // (docs/workers-v2/app-contract.md); legacy keeps read-repair caching.
    return NextResponse.json(
      await readEarnEarningsRangeSet(
        {
          cluster,
          settings: principal.settingsPda,
          timezone,
          vaultIndex: EARN_VAULT_INDEX,
          walletAddress: principal.walletAddress,
        },
        createEarnEarningsReadDependencies(
          isWorkersV2AppReadOnlyEarnGetsEnabled()
        )
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
