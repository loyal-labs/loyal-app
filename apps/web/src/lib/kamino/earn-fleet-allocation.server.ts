import "server-only";

import { resolveEarnForecastCluster } from "./earn-forecast.server";
import {
  aggregateEarnFleetAllocation,
  type EarnFleetAllocationSample,
} from "./earn-fleet-allocation.shared";
import {
  loadEarnFleetVaultStates,
  upsertEarnFleetAllocation,
} from "./earn-fleet-allocation-repository.server";

export type EarnFleetAllocationRecordResult = Pick<
  EarnFleetAllocationSample,
  | "vaultsTotal"
  | "vaultsIncluded"
  | "vaultsMissing"
  | "vaultsInvalid"
  | "vaultsStale"
> & { reserves: string[] };

export async function recordEarnFleetAllocationNow(
  now = new Date()
): Promise<EarnFleetAllocationRecordResult> {
  const sample = aggregateEarnFleetAllocation(
    await loadEarnFleetVaultStates(now),
    now
  );
  await upsertEarnFleetAllocation(resolveEarnForecastCluster(), sample);

  return {
    reserves: Object.keys(sample.reserveAmounts),
    vaultsIncluded: sample.vaultsIncluded,
    vaultsInvalid: sample.vaultsInvalid,
    vaultsMissing: sample.vaultsMissing,
    vaultsStale: sample.vaultsStale,
    vaultsTotal: sample.vaultsTotal,
  };
}
