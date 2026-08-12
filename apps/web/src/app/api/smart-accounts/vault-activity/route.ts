import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  fetchCurrentSmartAccountVaultActivity,
  isSmartAccountOverviewRateLimitError,
} from "@/features/smart-accounts/server/read-model";

const ACTIVITY_LIMIT = 10;

export async function GET(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return NextResponse.json(
      {
        error: {
          code: "unauthenticated",
          message: "No active auth session.",
        },
      },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const accountIndexParam = url.searchParams.get("accountIndex");
  const accountIndex =
    accountIndexParam == null ? Number.NaN : Number(accountIndexParam);

  if (
    !Number.isInteger(accountIndex) ||
    accountIndex < 0 ||
    accountIndex > 255
  ) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_account_index",
          message: "A valid vault account index is required.",
        },
      },
      { status: 400 }
    );
  }

  const forceRefresh = url.searchParams.get("forceRefresh") === "1";

  try {
    const activity = await fetchCurrentSmartAccountVaultActivity({
      accountIndex,
      activityLimit: ACTIVITY_LIMIT,
      settingsPda: principal.settingsPda,
      forceRefresh,
    });

    return NextResponse.json({ accountIndex, activity });
  } catch (error) {
    if (isSmartAccountOverviewRateLimitError(error)) {
      return NextResponse.json(
        {
          error: {
            code: "rpc_rate_limited",
            message:
              "Vault activity is temporarily rate limited. Please wait a moment and try again.",
          },
        },
        {
          headers: {
            "Retry-After": error.retryAfterSeconds.toString(),
          },
          status: 429,
        }
      );
    }

    throw error;
  }
}
