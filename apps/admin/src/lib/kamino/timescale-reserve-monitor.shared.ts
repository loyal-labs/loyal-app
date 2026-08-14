export type SafeReserveApyStatus =
  | "eligible"
  | "stale"
  | "below-liquidity"
  | "apy-out-of-range"
  | "no-current-row"
  | "no-supported-reserve";

export type SafeReserveApyStatusRow = {
  average24hApyPercent: number | null;
  average7dApyPercent: number | null;
  latestObservedAt: string | null;
  liquidityMint: string;
  market: string;
  marketName: string | null;
  reserve: string;
  status: SafeReserveApyStatus;
  supplyApyPercent: number | null;
  symbol: string | null;
  totalSupplyUsdEstimate: number | null;
};

export type SafeReserveMintEligibilitySummary = {
  bestSupplyApyPercent: number | null;
  eligibleReserveCount: number;
  liquidityMint: string;
  reason: string;
  status: SafeReserveApyStatus;
  symbol: string;
};

function describeIneligibleReserves(rows: readonly SafeReserveApyStatusRow[]) {
  if (rows.length === 0) {
    return {
      reason: "No supported Safe reserve",
      status: "no-supported-reserve" as const,
    };
  }

  const counts = rows.reduce(
    (result, row) => ({
      ...result,
      [row.status]: (result[row.status] ?? 0) + 1,
    }),
    {} as Partial<Record<SafeReserveApyStatus, number>>
  );
  const reasons = [
    counts["no-current-row"]
      ? `${counts["no-current-row"]} without a fresh verified row`
      : null,
    counts.stale ? `${counts.stale} stale` : null,
    counts["below-liquidity"]
      ? `${counts["below-liquidity"]} below the liquidity threshold`
      : null,
    counts["apy-out-of-range"]
      ? `${counts["apy-out-of-range"]} with APY outside bounds`
      : null,
  ].filter((reason): reason is string => reason !== null);
  const status: SafeReserveApyStatus = counts["no-current-row"]
    ? "no-current-row"
    : counts.stale
    ? "stale"
    : counts["below-liquidity"]
    ? "below-liquidity"
    : "apy-out-of-range";

  return {
    reason: reasons.join(", ") || "No eligible Safe reserve",
    status,
  };
}

export function summarizeSafeReserveEligibilityByMint(args: {
  stablecoins: readonly { mint: string; symbol: string }[];
  statuses: readonly SafeReserveApyStatusRow[];
}): SafeReserveMintEligibilitySummary[] {
  return args.stablecoins.map(({ mint, symbol }) => {
    const rows = args.statuses.filter((row) => row.liquidityMint === mint);
    const eligibleRows = rows.filter((row) => row.status === "eligible");
    const bestSupplyApyPercent = eligibleRows.reduce<number | null>(
      (best, row) =>
        row.supplyApyPercent !== null &&
        (best === null || row.supplyApyPercent > best)
          ? row.supplyApyPercent
          : best,
      null
    );

    if (eligibleRows.length > 0) {
      return {
        bestSupplyApyPercent,
        eligibleReserveCount: eligibleRows.length,
        liquidityMint: mint,
        reason: `${eligibleRows.length} eligible Safe ${
          eligibleRows.length === 1 ? "reserve" : "reserves"
        }`,
        status: "eligible",
        symbol,
      };
    }

    const ineligible = describeIneligibleReserves(rows);
    return {
      bestSupplyApyPercent: null,
      eligibleReserveCount: 0,
      liquidityMint: mint,
      reason: ineligible.reason,
      status: ineligible.status,
      symbol,
    };
  });
}

export type SafeReserveApySeries = {
  key: string;
  label: string;
  liquidityMint: string;
  marketName: string | null;
  reserve: string;
};

export type SafeReserveApyChartPoint = {
  observedAt: string;
  observedAtMs: number;
} & Record<string, string | number | null>;

export type SafeReserveRebalanceDecisionMarker = {
  createdAt: string;
  estimatedEdgeBps: number | null;
  id: string;
  liquidityMint: string | null;
  sourceApyBps: number | null;
  sourceReserve: string | null;
  status: string;
  targetApyBps: number | null;
  targetReserve: string | null;
};

export type SafeReserveApyMonitorData = {
  chartPoints: SafeReserveApyChartPoint[];
  generatedAt: string;
  sampleIntervalMinutes: number;
  series: SafeReserveApySeries[];
  statuses: SafeReserveApyStatusRow[];
  window: {
    endedAt: string;
    startedAt: string;
  };
};
