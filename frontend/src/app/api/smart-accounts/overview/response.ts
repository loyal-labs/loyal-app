import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { isSmartAccountOverviewRateLimitError } from "@/features/smart-accounts/server/read-model";

type TimedLoad<T> = {
  data: T;
  meta: {
    fetchedAt: number;
    timingsMs: Record<string, number>;
  };
};

export async function withSmartAccountOverviewResponse<T>(
  request: Request,
  args: {
    timingName: string;
    load: (principal: { settingsPda: string }) => Promise<T>;
  }
) {
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

  const startedAt = performance.now();

  try {
    const data = await args.load({ settingsPda: principal.settingsPda });
    const durationMs = performance.now() - startedAt;
    const payload: TimedLoad<T> = {
      data,
      meta: {
        fetchedAt: Date.now(),
        timingsMs: {
          total: Number(durationMs.toFixed(2)),
        },
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Server-Timing": `${args.timingName};dur=${durationMs.toFixed(2)}`,
      },
    });
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

    console.info(`[smart-account-overview] ${args.timingName}.failed`, {
      settingsPda: principal.settingsPda,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
