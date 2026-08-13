import "server-only";

import { getStablecoinRolloutConfiguration } from "@/lib/earn/stablecoin-rollout.server";
import {
  deriveStablecoinHealthWarnings,
  rolloutStateFor,
  type CycleHealth,
  type ReconciliationHealth,
  type RolloutState,
  type StablecoinHealthWarning,
} from "@/lib/earn/stablecoin-monitor.shared";
import { getCurrentVerifiedReserveEligibilityByMint } from "@/lib/kamino/timescale-reserve-client.server";

import { getEarnData, type EarnData } from "./earn-data";

export type EarnStablecoinHealthRow = EarnData["stablecoins"][number] & {
  appRollout: RolloutState;
  appRolloutSource: "app-api" | "unavailable";
  bestSupplyApyPercent: number | null;
  cycleHealth: CycleHealth;
  eligibleReserveCount: number;
  reconciliationHealth: ReconciliationHealth;
  warnings: StablecoinHealthWarning[];
};

export async function getEarnStablecoinMonitoring(): Promise<{
  data: EarnData;
  rows: EarnStablecoinHealthRow[];
}> {
  const [data, reserveEligibility, rollout] = await Promise.all([
    getEarnData(),
    getCurrentVerifiedReserveEligibilityByMint(),
    getStablecoinRolloutConfiguration(),
  ]);

  const rows = data.stablecoins.map((stablecoin) => {
    const eligibility = reserveEligibility.find(
      (reserve) => reserve.liquidityMint === stablecoin.liquidityMint
    );
    const eligibleReserveCount = eligibility?.eligibleReserveCount ?? 0;
    const appRollout = rolloutStateFor(rollout.appEnabled, stablecoin.symbol);
    // Yield Neon does not currently persist per-mint planner/reconciler
    // heartbeats or invisible-deposit adoption events. Keep these unknown
    // instead of treating missing telemetry as healthy.
    const cycleHealth: CycleHealth = "unknown";
    const reconciliationHealth: ReconciliationHealth = "unknown";

    return {
      ...stablecoin,
      appRollout,
      appRolloutSource: rollout.appSource,
      bestSupplyApyPercent: eligibility?.bestSupplyApyPercent ?? null,
      cycleHealth,
      eligibleReserveCount,
      reconciliationHealth,
      warnings: deriveStablecoinHealthWarnings({
        appRollout,
        cycleHealth,
        eligibleReserveCount,
        projectionDeltaRaw: stablecoin.currentPointerDeltaRaw,
        reconciliationHealth,
        symbol: stablecoin.symbol,
      }),
    };
  });

  return { data, rows };
}
