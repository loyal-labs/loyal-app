import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  fetchCurrentSmartAccountOverview,
  isSmartAccountOverviewRateLimitError,
} from "@/features/smart-accounts/server/read-model";

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
  const invalidateAddresses = url.searchParams
    .get("invalidate")
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  try {
    const overview = await fetchCurrentSmartAccountOverview({
      settingsPda: principal.settingsPda,
      invalidateAddresses,
    });

    return NextResponse.json({ overview });
  } catch (error) {
    if (isSmartAccountOverviewRateLimitError(error)) {
      return NextResponse.json(
        {
          error: {
            code: "rpc_rate_limited",
            message:
              "Smart-account data is temporarily rate limited. Please wait a moment and try again.",
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
