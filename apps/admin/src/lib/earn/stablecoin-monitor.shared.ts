import { Stablecoin, STABLECOIN_MINTS } from "@loyal-labs/actions";

export const STABLECOIN_DECIMALS = 6;

export const EARN_STABLECOIN_DESCRIPTORS = Object.freeze(
  Object.values(Stablecoin).map((symbol) => ({
    decimals: STABLECOIN_DECIMALS,
    mint: STABLECOIN_MINTS[symbol].toBase58(),
    symbol,
  }))
);

export type EarnStablecoinSymbol = Stablecoin;
export type RolloutState = "disabled" | "enabled" | "unknown";
export type ReconciliationHealth =
  | "adoption"
  | "failed"
  | "healthy"
  | "unknown";
export type CycleHealth = "healthy" | "stale" | "unknown";

export type StablecoinHealthWarningCode =
  | "cycle_stale"
  | "no_eligible_reserve"
  | "projection_mismatch"
  | "reconciliation_adoption"
  | "reconciliation_failed"
  | "telemetry_unavailable";

export type StablecoinHealthWarning = {
  code: StablecoinHealthWarningCode;
  level: "info" | "warning" | "critical";
  message: string;
};

export type StablecoinHealthWarningInput = {
  appRollout: RolloutState;
  cycleHealth: CycleHealth;
  eligibleReserveCount: number;
  projectionDeltaRaw: bigint;
  reconciliationHealth: ReconciliationHealth;
  symbol: EarnStablecoinSymbol;
};

const DESCRIPTOR_BY_MINT = new Map(
  EARN_STABLECOIN_DESCRIPTORS.map((descriptor) => [descriptor.mint, descriptor])
);
const DESCRIPTOR_BY_SYMBOL = new Map(
  EARN_STABLECOIN_DESCRIPTORS.map((descriptor) => [
    descriptor.symbol,
    descriptor,
  ])
);

export function getEarnStablecoinByMint(mint: string) {
  return DESCRIPTOR_BY_MINT.get(mint) ?? null;
}

export function getEarnStablecoinBySymbol(symbol: string) {
  return DESCRIPTOR_BY_SYMBOL.get(symbol as EarnStablecoinSymbol) ?? null;
}

export function getEarnStablecoinSymbol(mint: string | null | undefined) {
  if (!mint) {
    return null;
  }

  return getEarnStablecoinByMint(mint)?.symbol ?? null;
}

export function parseStablecoinSymbols(
  values: readonly string[]
): ReadonlySet<EarnStablecoinSymbol> | null {
  const parsed = new Set<EarnStablecoinSymbol>();

  for (const value of values) {
    const descriptor = getEarnStablecoinBySymbol(value);
    if (!descriptor || parsed.has(descriptor.symbol)) {
      return null;
    }
    parsed.add(descriptor.symbol);
  }

  return parsed;
}

export function rolloutStateFor(
  configured: ReadonlySet<EarnStablecoinSymbol> | null,
  symbol: EarnStablecoinSymbol
): RolloutState {
  if (configured === null) {
    return "unknown";
  }

  return configured.has(symbol) ? "enabled" : "disabled";
}

export function deriveStablecoinHealthWarnings(
  input: StablecoinHealthWarningInput
): StablecoinHealthWarning[] {
  const warnings: StablecoinHealthWarning[] = [];

  if (input.appRollout === "enabled" && input.eligibleReserveCount === 0) {
    warnings.push({
      code: "no_eligible_reserve",
      level: "critical",
      message: `${input.symbol} is deposit-enabled with no eligible verified reserve.`,
    });
  }

  if (input.projectionDeltaRaw !== BigInt(0)) {
    warnings.push({
      code: "projection_mismatch",
      level: "warning",
      message: `${input.symbol} projected holdings differ from normalized holdings.`,
    });
  }

  if (input.reconciliationHealth === "failed") {
    warnings.push({
      code: "reconciliation_failed",
      level: "critical",
      message: `${input.symbol} has a confirmed persistence or reconciliation failure.`,
    });
  } else if (input.reconciliationHealth === "adoption") {
    warnings.push({
      code: "reconciliation_adoption",
      level: "warning",
      message: `${input.symbol} required reconciliation to adopt an invisible deposit.`,
    });
  }

  if (input.cycleHealth === "stale") {
    warnings.push({
      code: "cycle_stale",
      level: "critical",
      message: `${input.symbol} planner or reconciler telemetry is stale.`,
    });
  }

  if (
    input.appRollout === "unknown" ||
    input.reconciliationHealth === "unknown" ||
    input.cycleHealth === "unknown"
  ) {
    warnings.push({
      code: "telemetry_unavailable",
      level: "info",
      message: `${input.symbol} app rollout or runtime telemetry is unavailable; state is not inferred from balances.`,
    });
  }

  return warnings;
}
