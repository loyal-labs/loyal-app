import { fetchCurrentSmartAccountVaultSnapshots } from "@/features/smart-accounts/server/read-model";

import { withSmartAccountOverviewResponse } from "../response";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const invalidateAddresses = url.searchParams
    .get("invalidate")
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const accountUtilizationValue = url.searchParams.get("accountUtilization");
  const accountUtilization =
    accountUtilizationValue === null
      ? undefined
      : Number.parseInt(accountUtilizationValue, 10);

  return withSmartAccountOverviewResponse(request, {
    timingName: "smart-account-overview-vaults",
    load: (principal) =>
      fetchCurrentSmartAccountVaultSnapshots({
        accountUtilization: Number.isFinite(accountUtilization)
          ? accountUtilization
          : undefined,
        invalidateAddresses,
        settingsPda: principal.settingsPda,
      }),
  });
}
