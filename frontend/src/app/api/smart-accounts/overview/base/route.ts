import { fetchCurrentSmartAccountOverviewBase } from "@/features/smart-accounts/server/read-model";

import { withSmartAccountOverviewResponse } from "../response";

export async function GET(request: Request) {
  return withSmartAccountOverviewResponse(request, {
    timingName: "smart-account-overview-base",
    load: (principal) =>
      fetchCurrentSmartAccountOverviewBase({
        settingsPda: principal.settingsPda,
      }),
  });
}
