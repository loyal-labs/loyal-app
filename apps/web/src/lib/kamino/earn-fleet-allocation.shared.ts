// Hourly Loyal Earn fleet allocation samples, recorded by the Go observer in
// loyal_yield.earn_fleet_allocations_hourly, mapped into the allocation
// history realized APY weights every past hour by.

import type { EarnAllocationHistory } from "./earn-realized-apy.shared";

const HOUR_MS = 60 * 60 * 1000;
const RAW_AMOUNT_PATTERN = /^[0-9]+$/;

export type EarnFleetAllocationHistorySample = {
  observedAtMs: number;
  reserveAmounts: Record<string, string>;
  idleAmountRaw: string;
  excludedAmountRaw: string;
};

// A sample still measures its hours while the last-known capital of the
// vaults it left out stays within this share of the capital it covers.
const MAX_EXCLUDED_CAPITAL_SHARE = 0.01;

// Weights are compared as JS numbers; raw six-decimal stablecoin totals stay
// exact far beyond any realistic fleet size.
function safeWeight(value: unknown): number | null {
  if (typeof value !== "string" || !RAW_AMOUNT_PATTERN.test(value)) {
    return null;
  }
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

// The recorded samples become one synthetic "fleet" vault for the realized
// APY calculation. A sample that holds an unreadable amount, or left out more
// capital than MAX_EXCLUDED_CAPITAL_SHARE allows, is unsupported: where the
// fleet's capital sat is unknown, so the hours it covers cannot be measured.
// Vaults without a complete snapshot have no known capital and do not count
// against a sample.
export function earnAllocationHistoryFromSamples(
  samples: readonly EarnFleetAllocationHistorySample[],
  sinceMs: number
): EarnAllocationHistory {
  return {
    currentIdleMismatch: false,
    snapshots: samples.map((sample) => {
      const weights = new Map<string, number>();
      const idleAmountRaw = safeWeight(sample.idleAmountRaw);
      const excludedAmountRaw = safeWeight(sample.excludedAmountRaw);
      let unsupported = idleAmountRaw === null || excludedAmountRaw === null;
      let coveredAmountRaw = idleAmountRaw ?? 0;
      for (const [reserve, amountRaw] of Object.entries(
        sample.reserveAmounts
      )) {
        const amount = safeWeight(amountRaw);
        if (amount === null) {
          unsupported = true;
        } else if (amount > 0) {
          weights.set(reserve, amount);
          coveredAmountRaw += amount;
        }
      }
      if (
        (excludedAmountRaw ?? 0) >
        coveredAmountRaw * MAX_EXCLUDED_CAPITAL_SHARE
      ) {
        unsupported = true;
      }
      return {
        idleAmountRaw: idleAmountRaw ?? 0,
        observedAtMs: sample.observedAtMs,
        unsupported,
        vaultId: "fleet",
        weights,
      };
    }),
    vaults: [
      {
        firstSeenAtMs: Math.floor(sinceMs / HOUR_MS) * HOUR_MS,
        id: "fleet",
      },
    ],
  };
}
