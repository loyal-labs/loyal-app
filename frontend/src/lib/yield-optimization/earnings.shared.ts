export const EARNINGS_RANGE_IDS = ["7D", "30D", "1Y", "ALL"] as const;

export type EarningsRangeId = (typeof EARNINGS_RANGE_IDS)[number];

export type EarnEarningsBar = {
  apyBps: number | null;
  avgPrincipalUsd: number;
  earnedUsd: number;
  endAt: string;
  isCurrent: boolean;
  label: string;
  principalAmountRaw: string;
  principalUsd: number;
  startAt: string;
};

export type EarnEarningsResponse = {
  bars: EarnEarningsBar[];
  currentApyBps: number | null;
  lastDepositAt: string | null;
  lifetimeEarnedUsd: number;
  principalAmountRaw: string;
  principalUsd: number;
  rangeEarnedUsd: number;
  sinceLastDepositEarnedUsd: number;
  todayEarnedUsd: number;
};

export type EarnEarningsCoverage = {
  currentReserveSampleAgeMs: number | null;
  eventCount: number;
  gappedReserves: string[];
  maxSampleGapMs: number | null;
  missingReserves: string[];
  reserveCount: number;
  sampleCount: number;
  sampledReserveCount: number;
  staleReserves: string[];
};

export type EarnEarningsFreshness = "fresh" | "stale";
export type EarnEarningsOutcome = "empty" | "ready";

export type EarnEarningsRangeSetResponse = {
  coverage: EarnEarningsCoverage;
  freshness: EarnEarningsFreshness;
  generatedAt: string;
  historyRevision: string;
  outcome: EarnEarningsOutcome;
  principalMatchesHistory: boolean;
  ranges: Record<EarningsRangeId, EarnEarningsResponse>;
  snapshotAgeMs: number | null;
  sourcePrincipalAmountRaw: string;
  staleReason: string | null;
};

export type EarnEarningsUnavailableResponse = {
  error: {
    code: "earnings_unavailable" | "history_incomplete";
    // Which verification actually failed. `code` alone says only "we won't draw
    // this", which is the same answer for a missing APY feed, a drifted
    // principal and a drifted holding — three unrelated defects that need three
    // unrelated fixes. Without this, triaging one report means reconstructing
    // the wallet's whole history from the yield DB by hand.
    detailCode?: string;
    message: string;
  };
  freshness: "unavailable";
  outcome: "unavailable";
};

export function isEarnEarningsCacheRevisionCurrent(
  cachedRevision: string | null | undefined,
  currentRevision: string | null | undefined
) {
  return (cachedRevision ?? null) === (currentRevision ?? null);
}

export function isServerVerifiedEarnEarningsPayload(
  value: unknown
): value is EarnEarningsRangeSetResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<EarnEarningsRangeSetResponse>;
  const ranges = payload.ranges;
  return (
    (payload.outcome === "empty" || payload.outcome === "ready") &&
    (payload.freshness === "fresh" || payload.freshness === "stale") &&
    payload.principalMatchesHistory === true &&
    typeof payload.sourcePrincipalAmountRaw === "string" &&
    typeof ranges === "object" &&
    ranges !== null &&
    EARNINGS_RANGE_IDS.every((rangeId) => {
      const range = (ranges as Partial<EarnEarningsRangeSetResponse["ranges"]>)[
        rangeId
      ];
      return (
        Boolean(range) &&
        Array.isArray(range?.bars) &&
        typeof range?.lifetimeEarnedUsd === "number" &&
        typeof range?.principalAmountRaw === "string"
      );
    })
  );
}
