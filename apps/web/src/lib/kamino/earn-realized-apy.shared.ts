// Realized Earn APY from Kamino reserve share prices (liquidity per
// collateral token). Signed share-price growth measures realized reserve
// returns; the headline annualizes the observed fleet allocation's return.
// No rate samples or routing simulation are involved.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const YEAR_MS = 365 * DAY_MS;

export const REALIZED_WINDOW_MS = 7 * DAY_MS;
export const SERIES_WINDOW_MS = 30 * DAY_MS;
const LIVE_WINDOW_MS = DAY_MS;
const LIVE_MIN_WINDOW_MS = 6 * HOUR_MS;
const MAX_INTERPOLATION_GAP_MS = 6 * HOUR_MS;
const MAX_STALENESS_MS = 3 * HOUR_MS;
const MAX_ALLOCATION_GAP_MS = 6 * HOUR_MS;
// Reserves lacking history may be ignored only while the rest still
// represents this share of Earn AUM.
const MIN_COVERED_WEIGHT_SHARE = 0.9;
const IDLE_RESERVE = "__idle__";

export type SharePricePoint = {
  observedAtMs: number;
  sharePrice: number;
};

export type EarnAllocationHistory = {
  currentIdleMismatch: boolean;
  vaults: { id: string; firstSeenAtMs: number }[];
  snapshots: {
    vaultId: string;
    observedAtMs: number;
    weights: ReadonlyMap<string, number>;
    idleAmountRaw: number;
    unsupported: boolean;
  }[];
};

export type RealizedApySource = "realized_7d" | "live";

export type RealizedApySample = {
  observedAt: string;
  apyBps: number;
};

export type RealizedApyResult = {
  realized7dBps: number | null;
  liveBps: number | null;
  headlineBps: number;
  source: RealizedApySource;
  loyalSeries: RealizedApySample[];
  mainUsdcReserveSeries: RealizedApySample[];
  measuredAtMs: number;
};

export type RealizedApyInput = {
  // Ascending by observedAtMs.
  histories: ReadonlyMap<string, readonly SharePricePoint[]>;
  allocations: EarnAllocationHistory;
  benchmarkReserve: string;
  nowMs: number;
};

function sharePriceAt(
  points: readonly SharePricePoint[],
  atMs: number
): number | null {
  let low = 0;
  let high = points.length - 1;
  let index = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (points[middle].observedAtMs <= atMs) {
      index = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (index < 0) {
    return null;
  }

  const before = points[index];
  if (before.observedAtMs === atMs) {
    return before.sharePrice;
  }
  const after = points[index + 1];
  if (!after) {
    return null;
  }
  const gapMs = after.observedAtMs - before.observedAtMs;
  if (gapMs > MAX_INTERPOLATION_GAP_MS) {
    return null;
  }
  // Log-linear: interest compounds, so price is geometric in time.
  const fraction = (atMs - before.observedAtMs) / gapMs;
  return before.sharePrice * (after.sharePrice / before.sharePrice) ** fraction;
}

// Signed, unrounded bps. Callers clamp (floor at 0 — a loss must not push
// the headline negative) and round exactly once, after any weighting, so a
// reserve with negative growth (loss socialization) still pulls the
// weighted headline down instead of being floored to 0 per-reserve first.
function annualizedGrowth(
  points: readonly SharePricePoint[],
  endMs: number,
  windowMs: number,
  minWindowMs: number
): number | null {
  if (points.length === 0) {
    return null;
  }
  const endPrice = sharePriceAt(points, endMs);
  const startMs = Math.max(endMs - windowMs, points[0].observedAtMs);
  const spanMs = endMs - startMs;
  if (endPrice === null || spanMs <= 0 || spanMs < minWindowMs) {
    return null;
  }
  const startPrice = sharePriceAt(points, startMs);
  if (startPrice === null || startPrice <= 0) {
    return null;
  }
  const apy = (endPrice / startPrice) ** (YEAR_MS / spanMs) - 1;
  return apy * 10_000;
}

function clampAndRoundBps(bps: number): number {
  return Math.max(0, Math.round(bps));
}

type AllocationPoint = {
  atMs: number;
  incomplete: boolean;
  weights: ReadonlyMap<string, number>;
};

function allocationTimeline(
  allocations: EarnAllocationHistory
): AllocationPoint[] {
  type Snapshot = EarnAllocationHistory["snapshots"][number];
  type Change =
    | { atMs: number; kind: "start"; vaultId: string }
    | { atMs: number; kind: "snapshot" | "expiry"; snapshot: Snapshot };
  const changes: Change[] = allocations.vaults.map((vault) => ({
    atMs: vault.firstSeenAtMs,
    kind: "start",
    vaultId: vault.id,
  }));
  for (const snapshot of allocations.snapshots) {
    changes.push({ atMs: snapshot.observedAtMs, kind: "snapshot", snapshot });
    if (
      snapshot.idleAmountRaw > 0 ||
      [...snapshot.weights.values()].some((weight) => weight > 0)
    ) {
      changes.push({
        atMs: snapshot.observedAtMs + MAX_ALLOCATION_GAP_MS,
        kind: "expiry",
        snapshot,
      });
    }
  }
  changes.sort(
    (a, b) =>
      a.atMs - b.atMs ||
      { start: 0, snapshot: 1, expiry: 2 }[a.kind] -
        { start: 0, snapshot: 1, expiry: 2 }[b.kind]
  );

  const currentByVault = new Map<string, Snapshot>();
  const invalidVaults = new Set<string>();
  const weights = new Map<string, number>();
  const timeline: AllocationPoint[] = [];
  const addWeights = (snapshot: Snapshot, direction: number) => {
    for (const [reserve, amount] of snapshot.weights) {
      weights.set(reserve, (weights.get(reserve) ?? 0) + direction * amount);
    }
    weights.set(
      IDLE_RESERVE,
      (weights.get(IDLE_RESERVE) ?? 0) + direction * snapshot.idleAmountRaw
    );
  };
  for (const change of changes) {
    if (change.kind === "start") {
      if (!currentByVault.has(change.vaultId)) {
        invalidVaults.add(change.vaultId);
      }
    } else if (change.kind === "snapshot") {
      const previous = currentByVault.get(change.snapshot.vaultId);
      if (previous) {
        addWeights(previous, -1);
      }
      currentByVault.set(change.snapshot.vaultId, change.snapshot);
      addWeights(change.snapshot, 1);
      if (change.snapshot.unsupported) {
        invalidVaults.add(change.snapshot.vaultId);
      } else {
        invalidVaults.delete(change.snapshot.vaultId);
      }
    } else if (
      currentByVault.get(change.snapshot.vaultId) === change.snapshot
    ) {
      invalidVaults.add(change.snapshot.vaultId);
    }
    const point = {
      atMs: change.atMs,
      incomplete: invalidVaults.size > 0,
      weights: new Map(weights),
    };
    if (timeline.at(-1)?.atMs === point.atMs) {
      timeline[timeline.length - 1] = point;
    } else {
      timeline.push(point);
    }
  }
  return timeline;
}

function allocationIndexAt(
  timeline: readonly AllocationPoint[],
  atMs: number
): number {
  let low = 0;
  let high = timeline.length - 1;
  let index = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (timeline[middle].atMs <= atMs) {
      index = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return index;
}

function coveredSegmentGrowth(
  histories: RealizedApyInput["histories"],
  weights: ReadonlyMap<string, number>,
  startMs: number,
  endMs: number
): number | null {
  let totalWeight = 0;
  let coveredWeight = 0;
  let weightedSum = 0;
  for (const [reserve, weight] of weights) {
    if (weight <= 0) {
      continue;
    }
    totalWeight += weight;
    if (reserve === IDLE_RESERVE) {
      coveredWeight += weight;
      weightedSum += weight;
      continue;
    }
    const points = histories.get(reserve) ?? [];
    const startPrice = sharePriceAt(points, startMs);
    const endPrice = sharePriceAt(points, endMs);
    if (startPrice !== null && startPrice > 0 && endPrice !== null) {
      coveredWeight += weight;
      weightedSum += weight * (endPrice / startPrice);
    }
  }
  if (
    totalWeight <= 0 ||
    coveredWeight / totalWeight < MIN_COVERED_WEIGHT_SHARE
  ) {
    return null;
  }
  return weightedSum / coveredWeight;
}

// Deposits and withdrawals change size; reserve moves change only subsequent
// returns. Full vault snapshots supply the allocation at each segment boundary.
function portfolioAnnualizedGrowth(
  input: RealizedApyInput,
  timeline: readonly AllocationPoint[],
  endMs: number,
  windowMs: number,
  minWindowMs: number
): number | null {
  const firstSnapshot = input.allocations.snapshots[0]?.observedAtMs;
  if (firstSnapshot === undefined) {
    return null;
  }
  const startMs = Math.max(endMs - windowMs, firstSnapshot);
  const spanMs = endMs - startMs;
  if (spanMs < minWindowMs) {
    return null;
  }

  let atMs = startMs;
  let growth = 1;
  while (atMs < endMs) {
    const index = allocationIndexAt(timeline, atMs);
    const state = timeline[index];
    if (!state || state.incomplete) {
      return null;
    }
    const nextSnapshot = timeline[index + 1]?.atMs;
    const nextHour = (Math.floor(atMs / HOUR_MS) + 1) * HOUR_MS;
    const nextMs = Math.min(endMs, nextHour, nextSnapshot ?? endMs);
    const segment = coveredSegmentGrowth(
      input.histories,
      state.weights,
      atMs,
      nextMs
    );
    if (segment === null || segment <= 0) {
      return null;
    }
    growth *= segment;
    atMs = nextMs;
  }
  return (growth ** (YEAR_MS / spanMs) - 1) * 10_000;
}

export function computeRealizedApy(
  input: RealizedApyInput
): RealizedApyResult | null {
  if (input.allocations.currentIdleMismatch) {
    return null;
  }
  // Never let a future-dated recorder row set the measurement time or supply
  // the interpolation point for a return that has not yet happened.
  const boundedInput: RealizedApyInput = {
    ...input,
    histories: new Map(
      [...input.histories].map(([reserve, points]) => [
        reserve,
        points.filter((point) => point.observedAtMs <= input.nowMs),
      ])
    ),
  };
  const timeline = allocationTimeline(input.allocations);
  let measurementEndMs = Math.max(
    ...[...boundedInput.histories.values()].flatMap((points) =>
      points.length ? [points[points.length - 1].observedAtMs] : []
    )
  );
  if (!Number.isFinite(measurementEndMs)) {
    return null;
  }
  // A price may lag a later fleet sweep. Resolve the allocation as of the
  // shared price timestamp, stepping back if active reserves differ there.
  let aligned = false;
  for (let attempt = 0; attempt <= timeline.length; attempt++) {
    const state = timeline[allocationIndexAt(timeline, measurementEndMs)];
    if (!state || state.incomplete) {
      return null;
    }
    let coveredWeight = 0;
    let totalWeight = 0;
    const latestTimes: number[] = [];
    for (const [reserve, weight] of state.weights) {
      totalWeight += weight;
      if (reserve === IDLE_RESERVE) {
        coveredWeight += weight;
        continue;
      }
      const points = boundedInput.histories.get(reserve) ?? [];
      const latest = points[points.length - 1];
      if (latest && input.nowMs - latest.observedAtMs <= MAX_STALENESS_MS) {
        coveredWeight += weight;
        latestTimes.push(latest.observedAtMs);
      }
    }
    if (
      totalWeight <= 0 ||
      coveredWeight / totalWeight < MIN_COVERED_WEIGHT_SHARE ||
      latestTimes.length === 0
    ) {
      return null;
    }
    const nextEndMs = Math.min(measurementEndMs, ...latestTimes);
    if (nextEndMs === measurementEndMs) {
      aligned = true;
      break;
    }
    measurementEndMs = nextEndMs;
  }
  if (!aligned) {
    return null;
  }
  const realizedGrowth = portfolioAnnualizedGrowth(
    boundedInput,
    timeline,
    measurementEndMs,
    REALIZED_WINDOW_MS,
    REALIZED_WINDOW_MS
  );
  const liveGrowth = portfolioAnnualizedGrowth(
    boundedInput,
    timeline,
    measurementEndMs,
    LIVE_WINDOW_MS,
    LIVE_MIN_WINDOW_MS
  );
  const realized7dBps =
    realizedGrowth === null ? null : clampAndRoundBps(realizedGrowth);
  const liveBps = liveGrowth === null ? null : clampAndRoundBps(liveGrowth);
  if (realized7dBps === null && liveBps === null) {
    return null;
  }

  // Prefer the 7-day figure. The 24h rate is noisy and taking the max of the
  // two would surface every short spike; live is only a stand-in until a full
  // 7-day window exists.
  const useRealized = realized7dBps !== null;

  return {
    headlineBps: useRealized ? realized7dBps : (liveBps as number),
    liveBps,
    loyalSeries: buildLoyalSeries(boundedInput, timeline),
    mainUsdcReserveSeries: buildReserveSeries(
      boundedInput.histories.get(input.benchmarkReserve) ?? [],
      input.nowMs
    ),
    measuredAtMs: measurementEndMs,
    realized7dBps,
    source: useRealized ? "realized_7d" : "live",
  };
}

function seriesHours(nowMs: number): number[] {
  const hours: number[] = [];
  const lastHour = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  for (
    let hour = lastHour - SERIES_WINDOW_MS + HOUR_MS;
    hour <= lastHour;
    hour += HOUR_MS
  ) {
    hours.push(hour);
  }
  return hours;
}

function buildLoyalSeries(
  input: RealizedApyInput,
  timeline: readonly AllocationPoint[]
): RealizedApySample[] {
  const samples: RealizedApySample[] = [];
  for (const hour of seriesHours(input.nowMs)) {
    const growth = portfolioAnnualizedGrowth(
      input,
      timeline,
      hour,
      REALIZED_WINDOW_MS,
      REALIZED_WINDOW_MS
    );
    if (growth !== null) {
      samples.push({
        apyBps: clampAndRoundBps(growth),
        observedAt: new Date(hour).toISOString(),
      });
    }
  }
  return samples;
}

function buildReserveSeries(
  points: readonly SharePricePoint[],
  nowMs: number
): RealizedApySample[] {
  const samples: RealizedApySample[] = [];
  for (const hour of seriesHours(nowMs)) {
    const growth = annualizedGrowth(
      points,
      hour,
      REALIZED_WINDOW_MS,
      REALIZED_WINDOW_MS
    );
    if (growth !== null) {
      samples.push({
        apyBps: clampAndRoundBps(growth),
        observedAt: new Date(hour).toISOString(),
      });
    }
  }
  return samples;
}
