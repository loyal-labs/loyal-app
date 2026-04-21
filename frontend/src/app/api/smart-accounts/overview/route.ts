import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { fetchCurrentSmartAccountOverview } from "@/features/smart-accounts/server/read-model";

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

  const overview = await fetchCurrentSmartAccountOverview({
    settingsPda: principal.settingsPda,
  });

  return NextResponse.json({ overview });
}
