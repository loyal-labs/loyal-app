import "server-only";

import { resolveEarnForecastCluster } from "./earn-forecast.server";
import {
  aggregateEarnFleetAllocation,
  deriveEarnFleetSharePrices,
  type EarnFleetAllocationSample,
} from "./earn-fleet-allocation.shared";
import {
  loadEarnFleetVaultStates,
  upsertEarnFleetAllocation,
} from "./earn-fleet-allocation-repository.server";
import { upsertReserveSharePrices } from "./earn-reserve-share-price-repository.server";

const HOUR_MS = 60 * 60 * 1000;

export type EarnFleetAllocationRecordResult = Pick<
  EarnFleetAllocationSample,
  | "vaultsTotal"
  | "vaultsIncluded"
  | "vaultsMissing"
  | "vaultsInvalid"
  | "vaultsStale"
> & { reserves: string[]; snapshotPrices: number | null };

export async function recordEarnFleetAllocationNow(
  now = new Date()
): Promise<EarnFleetAllocationRecordResult> {
  const cluster = resolveEarnForecastCluster();
  const vaults = await loadEarnFleetVaultStates(now);
  const sample = aggregateEarnFleetAllocation(vaults, now);
  await upsertEarnFleetAllocation(cluster, sample);

  // The on-chain price probe skips a reserve whose account has not been
  // refreshed for hours, which would leave the capital held there unpriced.
  // A failure here must not cost the allocation sample already written.
  let snapshotPrices: number | null = null;
  try {
    const prices = deriveEarnFleetSharePrices(vaults, now);
    await upsertReserveSharePrices(
      cluster,
      prices.map((price) => ({
        liquidityMint: price.liquidityMint,
        market: price.market,
        observedAt: new Date(price.observedAtMs),
        observedHour: new Date(
          Math.floor(price.observedAtMs / HOUR_MS) * HOUR_MS
        ),
        reserve: price.reserve,
        sharePrice: price.sharePrice,
        slot: price.slot,
      }))
    );
    snapshotPrices = prices.length;
  } catch (error) {
    console.error("[earn-fleet-allocation] snapshot prices failed", error);
  }

  return {
    reserves: Object.keys(sample.reserveAmounts),
    snapshotPrices,
    vaultsIncluded: sample.vaultsIncluded,
    vaultsInvalid: sample.vaultsInvalid,
    vaultsMissing: sample.vaultsMissing,
    vaultsStale: sample.vaultsStale,
    vaultsTotal: sample.vaultsTotal,
  };
}
