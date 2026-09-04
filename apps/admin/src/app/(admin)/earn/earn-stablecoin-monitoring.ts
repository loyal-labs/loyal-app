import "server-only";

import {
  deriveStablecoinHealthWarnings,
  type StablecoinHealthWarning,
} from "@/lib/earn/stablecoin-monitor.shared";
import { getCurrentVerifiedReserveEligibilityByMint } from "@/lib/kamino/timescale-reserve-client.server";
import type { SafeReserveApyStatus } from "@/lib/kamino/timescale-reserve-monitor.shared";

import { getEarnData, type EarnData } from "./earn-data";

export type EarnStablecoinHealthRow = EarnData["stablecoins"][number] & {
  bestSupplyApyPercent: number | null;
  eligibleReserveCount: number;
  eligibilityReason: string;
  eligibilityStatus: SafeReserveApyStatus;
  warnings: StablecoinHealthWarning[];
};

export async function getEarnStablecoinMonitoring(): Promise<{
  data: EarnData;
  rows: EarnStablecoinHealthRow[];
}> {
  const [data, reserveEligibility] = await Promise.all([
    getEarnData(),
    getCurrentVerifiedReserveEligibilityByMint(),
  ]);

  const rows = data.stablecoins.map((stablecoin) => {
    const eligibility = reserveEligibility.find(
      (reserve) => reserve.liquidityMint === stablecoin.liquidityMint
    );
    const eligibleReserveCount = eligibility?.eligibleReserveCount ?? 0;
    const eligibilityReason =
      eligibility?.reason ?? "No supported Safe reserve";

    return {
      ...stablecoin,
      bestSupplyApyPercent: eligibility?.bestSupplyApyPercent ?? null,
      eligibleReserveCount,
      eligibilityReason,
      eligibilityStatus:
        eligibility?.status ?? ("no-supported-reserve" as const),
      warnings: deriveStablecoinHealthWarnings({
        eligibleReserveCount,
        eligibilityReason,
        symbol: stablecoin.symbol,
      }),
    };
  });

  return { data, rows };
}
