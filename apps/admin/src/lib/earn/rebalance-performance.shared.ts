import { EARN_STABLECOIN_DESCRIPTORS } from "./stablecoin-monitor.shared";

export type RebalancePerformanceApyRow = {
  bucketStartedAt: string;
  reserve: string;
  supplyApyPercent: number | null;
};

export type RebalancePerformanceFleetAumRow = {
  aumRaw: bigint;
  bucketStartedAt: string;
  reserve: string;
};

export type ConfirmedRebalanceMarker = {
  confirmedAt: string;
  id: string;
};

export type RebalancePerformancePoint = {
  bestObservedApyPercent: number | null;
  bestReserve: string | null;
  bestReserveAumRaw: string | null;
  bucketDurationMs: number;
  bucketStartedAt: string;
  confirmedRebalanceCount: number;
  fleetShareInBestReservePercent: number | null;
  fleetWeightedApyPercent: number | null;
  knownFleetAumRaw: string;
};

export type RebalancePerformanceSummary = {
  aumTimeInBestReservePercent: number | null;
  coveragePercent: number | null;
  knownAumTimeRaw: string;
  totalAumTimeRaw: string;
};

export type RebalanceOpportunityOutcome = "confirmed" | "failed" | "pending";

export type RebalanceOpportunityRow = {
  opportunityId: string;
  outcome: RebalanceOpportunityOutcome;
};

export type RebalanceOpportunitySummary = {
  confirmed: number;
  failed: number;
  pending: number;
  qualified: number;
};

function isFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toBucketStartedAt(value: string, bucketDurationMs: number) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(
    Math.floor(timestamp / bucketDurationMs) * bucketDurationMs
  ).toISOString();
}

export function parseRebalancePerformanceMint(value: string | null) {
  return (
    EARN_STABLECOIN_DESCRIPTORS.find(({ mint }) => mint === value)?.mint ?? null
  );
}

export function buildRebalancePerformancePoints(args: {
  apyRows: readonly RebalancePerformanceApyRow[];
  bucketDurationMs: number;
  confirmedRebalances: readonly ConfirmedRebalanceMarker[];
  fleetAumRows: readonly RebalancePerformanceFleetAumRow[];
}): RebalancePerformancePoint[] {
  const bucketKeys = new Set<string>();
  const apyByBucket = new Map<string, Map<string, number>>();
  const aumByBucket = new Map<string, Map<string, bigint>>();
  const confirmedIdsByBucket = new Map<string, Set<string>>();

  for (const row of args.apyRows) {
    const bucketStartedAt = toBucketStartedAt(
      row.bucketStartedAt,
      args.bucketDurationMs
    );
    if (!bucketStartedAt || !isFiniteNumber(row.supplyApyPercent)) {
      if (bucketStartedAt) {
        bucketKeys.add(bucketStartedAt);
      }
      continue;
    }

    bucketKeys.add(bucketStartedAt);
    const bucket = apyByBucket.get(bucketStartedAt) ?? new Map();
    bucket.set(row.reserve, row.supplyApyPercent);
    apyByBucket.set(bucketStartedAt, bucket);
  }

  for (const row of args.fleetAumRows) {
    const bucketStartedAt = toBucketStartedAt(
      row.bucketStartedAt,
      args.bucketDurationMs
    );
    if (!bucketStartedAt || row.aumRaw < BigInt(0)) {
      continue;
    }

    bucketKeys.add(bucketStartedAt);
    const bucket = aumByBucket.get(bucketStartedAt) ?? new Map();
    bucket.set(
      row.reserve,
      (bucket.get(row.reserve) ?? BigInt(0)) + row.aumRaw
    );
    aumByBucket.set(bucketStartedAt, bucket);
  }

  for (const marker of args.confirmedRebalances) {
    const bucketStartedAt = toBucketStartedAt(
      marker.confirmedAt,
      args.bucketDurationMs
    );
    if (!bucketStartedAt) {
      continue;
    }

    const bucket = confirmedIdsByBucket.get(bucketStartedAt) ?? new Set();
    bucket.add(marker.id);
    confirmedIdsByBucket.set(bucketStartedAt, bucket);
  }

  return [...bucketKeys]
    .sort((left, right) => left.localeCompare(right))
    .map((bucketStartedAt) => {
      const apyByReserve = apyByBucket.get(bucketStartedAt) ?? new Map();
      const aumByReserve = aumByBucket.get(bucketStartedAt) ?? new Map();
      const knownFleetAumRaw = [...aumByReserve.values()].reduce(
        (sum, value) => sum + value,
        BigInt(0)
      );
      const bestEntry = [...apyByReserve.entries()].sort(
        ([leftReserve, leftApy], [rightReserve, rightApy]) =>
          rightApy - leftApy || leftReserve.localeCompare(rightReserve)
      )[0];
      const hasCompleteApyCoverage = [...aumByReserve.entries()].every(
        ([reserve, aumRaw]) => aumRaw === BigInt(0) || apyByReserve.has(reserve)
      );
      const bestReserve = bestEntry?.[0] ?? null;
      const bestReserveAumRaw = bestReserve
        ? aumByReserve.get(bestReserve) ?? BigInt(0)
        : null;

      let fleetWeightedApyPercent: number | null = null;
      if (knownFleetAumRaw > BigInt(0) && bestEntry && hasCompleteApyCoverage) {
        const weightedTotal = [...aumByReserve.entries()].reduce(
          (sum, [reserve, aumRaw]) =>
            sum + Number(aumRaw) * (apyByReserve.get(reserve) ?? 0),
          0
        );
        fleetWeightedApyPercent = weightedTotal / Number(knownFleetAumRaw);
      }

      return {
        bestObservedApyPercent: bestEntry?.[1] ?? null,
        bestReserve,
        bestReserveAumRaw: bestReserveAumRaw?.toString() ?? null,
        bucketDurationMs: args.bucketDurationMs,
        bucketStartedAt,
        confirmedRebalanceCount:
          confirmedIdsByBucket.get(bucketStartedAt)?.size ?? 0,
        fleetShareInBestReservePercent:
          bestReserveAumRaw !== null &&
          knownFleetAumRaw > BigInt(0) &&
          hasCompleteApyCoverage
            ? (Number(bestReserveAumRaw) / Number(knownFleetAumRaw)) * 100
            : null,
        fleetWeightedApyPercent,
        knownFleetAumRaw: knownFleetAumRaw.toString(),
      };
    });
}

export function summarizeRebalancePerformance(
  points: readonly RebalancePerformancePoint[]
): RebalancePerformanceSummary {
  let bestReserveAumTimeRaw = BigInt(0);
  let knownAumTimeRaw = BigInt(0);
  let totalAumTimeRaw = BigInt(0);

  for (const point of points) {
    const duration = BigInt(point.bucketDurationMs);
    const fleetAumRaw = BigInt(point.knownFleetAumRaw);
    totalAumTimeRaw += fleetAumRaw * duration;

    if (
      point.bestReserveAumRaw === null ||
      point.fleetWeightedApyPercent === null
    ) {
      continue;
    }

    knownAumTimeRaw += fleetAumRaw * duration;
    bestReserveAumTimeRaw += BigInt(point.bestReserveAumRaw) * duration;
  }

  return {
    aumTimeInBestReservePercent:
      knownAumTimeRaw > BigInt(0)
        ? (Number(bestReserveAumTimeRaw) / Number(knownAumTimeRaw)) * 100
        : null,
    coveragePercent:
      totalAumTimeRaw > BigInt(0)
        ? (Number(knownAumTimeRaw) / Number(totalAumTimeRaw)) * 100
        : null,
    knownAumTimeRaw: knownAumTimeRaw.toString(),
    totalAumTimeRaw: totalAumTimeRaw.toString(),
  };
}

export function summarizeRebalanceOpportunities(
  rows: readonly RebalanceOpportunityRow[]
): RebalanceOpportunitySummary {
  const outcomeById = new Map<string, RebalanceOpportunityOutcome>();
  const rank: Record<RebalanceOpportunityOutcome, number> = {
    confirmed: 2,
    failed: 1,
    pending: 0,
  };

  for (const row of rows) {
    const current = outcomeById.get(row.opportunityId);
    if (!current || rank[row.outcome] > rank[current]) {
      outcomeById.set(row.opportunityId, row.outcome);
    }
  }

  const summary: RebalanceOpportunitySummary = {
    confirmed: 0,
    failed: 0,
    pending: 0,
    qualified: outcomeById.size,
  };
  for (const outcome of outcomeById.values()) {
    summary[outcome] += 1;
  }

  return summary;
}
