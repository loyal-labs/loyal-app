// Realized Earn APY from Kamino reserve share prices (liquidity per
// collateral token). Share prices only rise with accrued interest, so their
// growth is exactly what a depositor earned; no rate samples or routing
// simulation are involved.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const YEAR_MS = 365 * DAY_MS;

export const REALIZED_WINDOW_MS = 7 * DAY_MS;
export const SERIES_WINDOW_MS = 30 * DAY_MS;
const LIVE_WINDOW_MS = DAY_MS;
const LIVE_MIN_WINDOW_MS = 6 * HOUR_MS;
const MAX_INTERPOLATION_GAP_MS = 6 * HOUR_MS;
const MAX_STALENESS_MS = 3 * HOUR_MS;
// Reserves lacking history may be ignored only while the rest still
// represents this share of Earn AUM.
const MIN_COVERED_WEIGHT_SHARE = 0.9;

export type SharePricePoint = {
  observedAtMs: number;
  sharePrice: number;
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
};

export type RealizedApyInput = {
  // Ascending by observedAtMs.
  histories: ReadonlyMap<string, readonly SharePricePoint[]>;
  weights: ReadonlyMap<string, number>;
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

function annualizedGrowthBps(
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
  return Math.max(0, Math.round(apy * 10_000));
}

function weightedBps(
  valuesByReserve: ReadonlyMap<string, number | null>,
  weights: ReadonlyMap<string, number>
): number | null {
  let totalWeight = 0;
  let coveredWeight = 0;
  let weightedSum = 0;
  for (const [reserve, weight] of weights) {
    if (weight <= 0) {
      continue;
    }
    totalWeight += weight;
    const value = valuesByReserve.get(reserve);
    if (value !== null && value !== undefined) {
      coveredWeight += weight;
      weightedSum += weight * value;
    }
  }
  if (
    totalWeight <= 0 ||
    coveredWeight / totalWeight < MIN_COVERED_WEIGHT_SHARE
  ) {
    return null;
  }
  return Math.round(weightedSum / coveredWeight);
}

export function computeRealizedApy(
  input: RealizedApyInput
): RealizedApyResult | null {
  const realizedByReserve = new Map<string, number | null>();
  const liveByReserve = new Map<string, number | null>();

  for (const reserve of input.weights.keys()) {
    const points = input.histories.get(reserve) ?? [];
    const latest = points[points.length - 1];
    if (!latest || input.nowMs - latest.observedAtMs > MAX_STALENESS_MS) {
      realizedByReserve.set(reserve, null);
      liveByReserve.set(reserve, null);
      continue;
    }
    realizedByReserve.set(
      reserve,
      annualizedGrowthBps(
        points,
        latest.observedAtMs,
        REALIZED_WINDOW_MS,
        REALIZED_WINDOW_MS
      )
    );
    liveByReserve.set(
      reserve,
      annualizedGrowthBps(
        points,
        latest.observedAtMs,
        LIVE_WINDOW_MS,
        LIVE_MIN_WINDOW_MS
      )
    );
  }

  const realized7dBps = weightedBps(realizedByReserve, input.weights);
  const liveBps = weightedBps(liveByReserve, input.weights);
  if (realized7dBps === null && liveBps === null) {
    return null;
  }

  const useRealized =
    realized7dBps !== null && (liveBps === null || realized7dBps >= liveBps);

  return {
    headlineBps: useRealized ? realized7dBps : (liveBps as number),
    liveBps,
    loyalSeries: buildLoyalSeries(input),
    mainUsdcReserveSeries: buildReserveSeries(
      input.histories.get(input.benchmarkReserve) ?? [],
      input.nowMs
    ),
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

// Uses today's AUM weights for every past hour; per-hour historical weights
// are not stored.
function buildLoyalSeries(input: RealizedApyInput): RealizedApySample[] {
  const samples: RealizedApySample[] = [];
  for (const hour of seriesHours(input.nowMs)) {
    const values = new Map<string, number | null>();
    for (const reserve of input.weights.keys()) {
      values.set(
        reserve,
        annualizedGrowthBps(
          input.histories.get(reserve) ?? [],
          hour,
          REALIZED_WINDOW_MS,
          REALIZED_WINDOW_MS
        )
      );
    }
    const apyBps = weightedBps(values, input.weights);
    if (apyBps !== null) {
      samples.push({ apyBps, observedAt: new Date(hour).toISOString() });
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
    const apyBps = annualizedGrowthBps(
      points,
      hour,
      REALIZED_WINDOW_MS,
      REALIZED_WINDOW_MS
    );
    if (apyBps !== null) {
      samples.push({ apyBps, observedAt: new Date(hour).toISOString() });
    }
  }
  return samples;
}
