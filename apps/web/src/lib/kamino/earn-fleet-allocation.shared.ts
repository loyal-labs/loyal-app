// Hourly Loyal Earn fleet allocation: redeemable liquidity per Kamino reserve
// plus zero-return idle capital, summed from each vault's latest complete
// snapshot. Recorded once an hour so realized APY can weight every past hour
// by the allocation held then, without rebuilding fleet history per request.

import type { EarnAllocationHistory } from "./earn-realized-apy.shared";

const HOUR_MS = 60 * 60 * 1000;
// A funded vault whose latest complete snapshot is older than this no longer
// describes where its capital is.
const MAX_SNAPSHOT_AGE_MS = 6 * HOUR_MS;
const RAW_AMOUNT_PATTERN = /^[0-9]+$/;
const REDEEMABLE_LIQUIDITY_SEMANTICS = "kamino_redeemable_liquidity";
const COLLATERAL_UNIT_SEMANTICS =
  "kamino_obligation_collateral_deposited_amount";

export const EARN_FLEET_ALLOCATION_CALC_VERSION = 1;

export type EarnFleetVaultPosition = {
  reserve: string;
  amountRaw: string;
  amountSemantics: string | null;
  // Recorded conversion of a collateral-unit amount into liquidity.
  redeemableLiquidityRaw: string | null;
};

export type EarnFleetVaultState = {
  vaultId: string;
  // Latest complete snapshot; null when the vault has never published one.
  snapshot: {
    observedAtMs: number;
    observedSlot: string;
    contextIdleRaw: string | null;
    positions: EarnFleetVaultPosition[];
  } | null;
  currentIdle: { amountRaw: string; observedSlot: string }[];
};

export type EarnFleetAllocationSample = {
  observedAt: Date;
  observedHour: Date;
  reserveAmounts: Record<string, string>;
  idleAmountRaw: string;
  vaultsTotal: number;
  vaultsIncluded: number;
  vaultsMissing: number;
  vaultsInvalid: number;
  vaultsStale: number;
  excludedAmountRaw: string;
  oldestSourceAt: Date | null;
  newestSourceAt: Date | null;
  calcVersion: number;
};

function parseRawAmount(value: string | null): bigint | null {
  return value !== null && RAW_AMOUNT_PATTERN.test(value)
    ? BigInt(value)
    : null;
}

// Only documented redeemable-liquidity amounts count. Collateral units need
// their recorded conversion; anything else has unknown units.
function redeemableLiquidityRaw(
  position: EarnFleetVaultPosition
): bigint | null {
  if (position.amountSemantics === REDEEMABLE_LIQUIDITY_SEMANTICS) {
    return parseRawAmount(position.amountRaw);
  }
  if (position.amountSemantics === COLLATERAL_UNIT_SEMANTICS) {
    return parseRawAmount(position.redeemableLiquidityRaw);
  }
  return null;
}

// Complete snapshots replace the vault's idle balances in the same
// transaction, so idle rows at the snapshot's slot are its idle capital. A
// later partial observation moves those rows to a newer slot; the snapshot's
// own context value is then the only idle amount consistent with it.
function idleRaw(
  snapshot: NonNullable<EarnFleetVaultState["snapshot"]>,
  currentIdle: EarnFleetVaultState["currentIdle"]
): bigint | null {
  const atSnapshot = currentIdle.filter(
    (balance) => balance.observedSlot === snapshot.observedSlot
  );
  if (atSnapshot.length > 0) {
    let total = BigInt(0);
    for (const balance of atSnapshot) {
      const amount = parseRawAmount(balance.amountRaw);
      if (amount === null) {
        return null;
      }
      total += amount;
    }
    return total;
  }
  return parseRawAmount(snapshot.contextIdleRaw);
}

export function aggregateEarnFleetAllocation(
  vaults: readonly EarnFleetVaultState[],
  now: Date
): EarnFleetAllocationSample {
  const nowMs = now.getTime();
  const reserveTotals = new Map<string, bigint>();
  let idleTotal = BigInt(0);
  let excludedTotal = BigInt(0);
  let included = 0;
  let missing = 0;
  let invalid = 0;
  let stale = 0;
  let oldestSourceMs: number | null = null;
  let newestSourceMs: number | null = null;

  for (const vault of vaults) {
    const { snapshot } = vault;
    if (!snapshot) {
      missing += 1;
      continue;
    }

    const reserves = new Map<string, bigint>();
    let knownTotal = BigInt(0);
    let unitsKnown = true;
    for (const position of snapshot.positions) {
      const amount = redeemableLiquidityRaw(position);
      if (amount === null) {
        unitsKnown = false;
        knownTotal += parseRawAmount(position.amountRaw) ?? BigInt(0);
        continue;
      }
      knownTotal += amount;
      reserves.set(
        position.reserve,
        (reserves.get(position.reserve) ?? BigInt(0)) + amount
      );
    }
    const idle = idleRaw(snapshot, vault.currentIdle);
    knownTotal += idle ?? BigInt(0);

    if (!unitsKnown || idle === null) {
      invalid += 1;
      excludedTotal += knownTotal;
      continue;
    }
    const funded = knownTotal > BigInt(0);
    if (funded && nowMs - snapshot.observedAtMs > MAX_SNAPSHOT_AGE_MS) {
      stale += 1;
      excludedTotal += knownTotal;
      continue;
    }

    included += 1;
    idleTotal += idle;
    for (const [reserve, amount] of reserves) {
      if (amount > BigInt(0)) {
        reserveTotals.set(
          reserve,
          (reserveTotals.get(reserve) ?? BigInt(0)) + amount
        );
      }
    }
    if (funded) {
      oldestSourceMs = Math.min(
        oldestSourceMs ?? snapshot.observedAtMs,
        snapshot.observedAtMs
      );
      newestSourceMs = Math.max(
        newestSourceMs ?? snapshot.observedAtMs,
        snapshot.observedAtMs
      );
    }
  }

  return {
    calcVersion: EARN_FLEET_ALLOCATION_CALC_VERSION,
    excludedAmountRaw: excludedTotal.toString(),
    idleAmountRaw: idleTotal.toString(),
    newestSourceAt: newestSourceMs === null ? null : new Date(newestSourceMs),
    observedAt: now,
    observedHour: new Date(Math.floor(nowMs / HOUR_MS) * HOUR_MS),
    oldestSourceAt: oldestSourceMs === null ? null : new Date(oldestSourceMs),
    reserveAmounts: Object.fromEntries(
      [...reserveTotals]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([reserve, amount]) => [reserve, amount.toString()])
    ),
    vaultsIncluded: included,
    vaultsInvalid: invalid,
    vaultsMissing: missing,
    vaultsStale: stale,
    vaultsTotal: vaults.length,
  };
}

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
