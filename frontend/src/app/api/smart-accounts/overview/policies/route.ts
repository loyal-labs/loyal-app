import { fetchCurrentSmartAccountPolicyOverview } from "@/features/smart-accounts/server/read-model";

import { withSmartAccountOverviewResponse } from "../response";

export async function GET(request: Request) {
  const bypassCache =
    new URL(request.url).searchParams.get("forceRefresh") === "1";
  return withSmartAccountOverviewResponse(request, {
    timingName: "smart-account-overview-policies",
    load: (principal) =>
      fetchCurrentSmartAccountPolicyOverview({
        bypassCache,
        settingsPda: principal.settingsPda,
      }),
  });
}
