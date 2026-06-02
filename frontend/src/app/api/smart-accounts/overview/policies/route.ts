import { fetchCurrentSmartAccountPolicyOverview } from "@/features/smart-accounts/server/read-model";

import { withSmartAccountOverviewResponse } from "../response";

export async function GET(request: Request) {
  return withSmartAccountOverviewResponse(request, {
    timingName: "smart-account-overview-policies",
    load: (principal) =>
      fetchCurrentSmartAccountPolicyOverview({
        settingsPda: principal.settingsPda,
      }),
  });
}
