import {
  EARNINGS_RANGE_IDS,
  type EarnEarningsBar,
  type EarnEarningsResponse,
  type EarningsRangeId,
} from "./earnings.shared";

export type { EarnEarningsBar, EarnEarningsResponse, EarningsRangeId };
export { EARNINGS_RANGE_IDS };

export type YieldPositionEvent = {
  amountRaw: bigint;
  confirmedAt: Date;
  confirmedSlot?: bigint;
  holdingEventId?: bigint;
  positionId?: bigint;
  initializesPosition?: boolean;
  liquidityMint?: string;
  type: "deposit" | "withdrawal";
};

export class EarningsPrincipalHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EarningsPrincipalHistoryError";
  }
}

// Timestamps define chart boundaries; slots and the shared holding ledger order
// accounting transitions inside a boundary. Separate deposit/withdrawal IDs are
// not comparable. Missing ordering evidence must not choose a money path.
export function sortEarningsEvents(events: readonly YieldPositionEvent[]) {
  return [...events].sort((left, right) => {
    const timeDelta = left.confirmedAt.getTime() - right.confirmedAt.getTime();
    if (timeDelta !== 0) return timeDelta;
    if (
      left.confirmedSlot !== undefined &&
      right.confirmedSlot !== undefined &&
      left.confirmedSlot !== right.confirmedSlot
    ) {
      return left.confirmedSlot < right.confirmedSlot ? -1 : 1;
    }
    if (
      left.holdingEventId !== undefined &&
      right.holdingEventId !== undefined &&
      left.holdingEventId !== right.holdingEventId
    ) {
      return left.holdingEventId < right.holdingEventId ? -1 : 1;
    }
    // Plain deposits commute, as do withdrawals with no lifecycle reset.
    if (
      left.type === right.type &&
      !left.initializesPosition &&
      !right.initializesPosition
    )
      return 0;
    throw new EarningsPrincipalHistoryError(
      "principal_history_order_ambiguous"
    );
  });
}

export type YieldPortfolioExposure = {
  amountRaw: bigint;
  kind: "idle" | "kamino";
  liquidityMint: string;
  reserve: string | null;
  sourceId: string;
};

export type YieldPortfolioSnapshot = {
  exposures: readonly YieldPortfolioExposure[];
  observedAt: Date;
  observedSlot: bigint;
};

export type YieldPositionPathEvent = {
  amountRaw: bigint;
  confirmedAt: Date;
  liquidityMint: string;
  market: string | null;
  principalAmountRaw: bigint;
  reserve: string;
  type: "deposit" | "reconciliation" | "rebalance" | "withdrawal";
};

export type ReserveApySample = {
  observedAt: Date;
  reserve?: string | null;
  supplyApy: number;
};

type Bucket = {
  endAt: Date;
  isCurrent: boolean;
  label: string;
  startAt: Date;
};

type ZonedParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
};

const STABLECOIN_MICROS_FACTOR = 1_000_000;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export function isEarningsRangeId(value: string): value is EarningsRangeId {
  return EARNINGS_RANGE_IDS.includes(value as EarningsRangeId);
}

export function normalizeEarningsTimezone(timezone: string | null): string {
  if (!timezone) {
    return "UTC";
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "UTC";
  }
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.get("hour"));

  return {
    day: Number(values.get("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(values.get("minute")),
    month: Number(values.get("month")),
    second: Number(values.get("second")),
    year: Number(values.get("year")),
  };
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = getZonedParts(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
  timezone: string,
  parts: Pick<ZonedParts, "day" | "month" | "year"> &
    Partial<Pick<ZonedParts, "hour" | "minute" | "second">>
): Date {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0
  );
  let utcMs = localAsUtc - getTimezoneOffsetMs(new Date(localAsUtc), timezone);

  for (let i = 0; i < 2; i += 1) {
    utcMs = localAsUtc - getTimezoneOffsetMs(new Date(utcMs), timezone);
  }

  return new Date(utcMs);
}

function addLocalDays(
  parts: Pick<ZonedParts, "day" | "month" | "year">,
  days: number
) {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days)
  );
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

function addLocalMonths(
  parts: Pick<ZonedParts, "month" | "year">,
  months: number
) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  return {
    day: 1,
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

function startOfLocalDay(date: Date, timezone: string): Date {
  const parts = getZonedParts(date, timezone);
  return zonedDateTimeToUtc(timezone, {
    day: parts.day,
    month: parts.month,
    year: parts.year,
  });
}

function startOfLocalMonth(date: Date, timezone: string): Date {
  const parts = getZonedParts(date, timezone);
  return zonedDateTimeToUtc(timezone, {
    day: 1,
    month: parts.month,
    year: parts.year,
  });
}

function formatBucketLabel(
  startAt: Date,
  range: EarningsRangeId,
  timezone: string
): string {
  if (range === "1Y" || range === "ALL") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone: timezone,
      year: "numeric",
    }).format(startAt);
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(startAt);
}

export function createEarningsBuckets(args: {
  firstDepositAt: Date | null;
  now: Date;
  range: EarningsRangeId;
  timezone: string;
}): Bucket[] {
  const { firstDepositAt, now, range, timezone } = args;
  const todayStart = startOfLocalDay(now, timezone);
  const currentMonthStart = startOfLocalMonth(now, timezone);
  const todayParts = getZonedParts(todayStart, timezone);
  const currentMonthParts = getZonedParts(currentMonthStart, timezone);

  const starts: Date[] = [];
  if (range === "7D" || range === "30D") {
    const count = range === "7D" ? 7 : 30;
    for (let i = count - 1; i >= 0; i -= 1) {
      starts.push(zonedDateTimeToUtc(timezone, addLocalDays(todayParts, -i)));
    }
  } else {
    const firstMonthStart = firstDepositAt
      ? startOfLocalMonth(firstDepositAt, timezone)
      : currentMonthStart;
    const monthCount =
      range === "1Y"
        ? 12
        : Math.max(
            1,
            (currentMonthParts.year -
              getZonedParts(firstMonthStart, timezone).year) *
              12 +
              currentMonthParts.month -
              getZonedParts(firstMonthStart, timezone).month +
              1
          );
    const firstOffset = range === "1Y" ? -(monthCount - 1) : 0;
    const baseParts =
      range === "1Y"
        ? currentMonthParts
        : getZonedParts(firstMonthStart, timezone);

    for (let i = 0; i < monthCount; i += 1) {
      starts.push(
        zonedDateTimeToUtc(timezone, addLocalMonths(baseParts, firstOffset + i))
      );
    }
  }

  return starts.map((startAt) => {
    const nextStart =
      range === "7D" || range === "30D"
        ? zonedDateTimeToUtc(
            timezone,
            addLocalDays(getZonedParts(startAt, timezone), 1)
          )
        : zonedDateTimeToUtc(
            timezone,
            addLocalMonths(getZonedParts(startAt, timezone), 1)
          );
    const endAt = new Date(Math.min(nextStart.getTime(), now.getTime()));

    return {
      endAt,
      isCurrent:
        startAt.getTime() <= now.getTime() &&
        now.getTime() < nextStart.getTime(),
      label: formatBucketLabel(startAt, range, timezone),
      startAt,
    };
  });
}

function rawToUsd(raw: bigint): number {
  return Number(raw) / STABLECOIN_MICROS_FACTOR;
}

function legacyEventsToPathEvents(
  events: readonly YieldPositionEvent[]
): YieldPositionPathEvent[] {
  let principal = BigInt(0);

  return events.map((event) => {
    principal += event.type === "deposit" ? event.amountRaw : -event.amountRaw;
    if (principal < BigInt(0)) {
      principal = BigInt(0);
    }

    return {
      amountRaw: principal,
      confirmedAt: event.confirmedAt,
      liquidityMint: "",
      market: null,
      principalAmountRaw: principal,
      reserve: "",
      type: event.type,
    };
  });
}

const pathTimesCache = new WeakMap<
  readonly YieldPositionPathEvent[],
  number[]
>();

function getPathStateAt(
  pathEvents: readonly YieldPositionPathEvent[],
  at: Date
): YieldPositionPathEvent | null {
  let times = pathTimesCache.get(pathEvents);
  if (!times) {
    times = pathEvents.map((event) => event.confirmedAt.getTime());
    pathTimesCache.set(pathEvents, times);
  }
  const found = lastIndexAtOrBefore(times, at.getTime());
  return found === -1 ? null : pathEvents[found];
}

// ---- Sorted-array lookup indexes (ASK-2209) ----
// Long-history wallets produce tens of thousands of APY samples, and each
// window segment used to rescan every array from the start (O(S²) overall —
// enough to blow Vercel's 300s limit). The lookups below binary-search
// WeakMap-cached indexes instead; callers pass time-sorted arrays (see
// calculateEarnEarnings) and reuse the same array instances, so each index is
// built once per request.

/** Last index with times[i] <= atMs, or -1. `times` must be ascending. */
function lastIndexAtOrBefore(times: readonly number[], atMs: number): number {
  let low = 0;
  let high = times.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= atMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

type ApySeries = { apys: number[]; positions: number[]; times: number[] };

type ApyIndex = {
  all: ApySeries;
  byReserve: Map<string, ApySeries>;
  unscoped: ApySeries;
};

const apyIndexCache = new WeakMap<readonly ReserveApySample[], ApyIndex>();

function getApyIndex(samples: readonly ReserveApySample[]): ApyIndex {
  const cached = apyIndexCache.get(samples);
  if (cached) {
    return cached;
  }
  const makeSeries = (): ApySeries => ({ apys: [], positions: [], times: [] });
  const index: ApyIndex = {
    all: makeSeries(),
    byReserve: new Map(),
    unscoped: makeSeries(),
  };
  samples.forEach((sample, position) => {
    const time = sample.observedAt.getTime();
    const push = (series: ApySeries) => {
      series.apys.push(sample.supplyApy);
      series.positions.push(position);
      series.times.push(time);
    };
    push(index.all);
    if (sample.reserve === undefined || sample.reserve === null) {
      push(index.unscoped);
    } else {
      let series = index.byReserve.get(sample.reserve);
      if (!series) {
        series = makeSeries();
        index.byReserve.set(sample.reserve, series);
      }
      push(series);
    }
  });
  apyIndexCache.set(samples, index);
  return index;
}

function getApyAt(
  samples: readonly ReserveApySample[],
  reserve: string | null,
  at: Date
): number | null {
  const index = getApyIndex(samples);
  const atMs = at.getTime();
  if (!reserve) {
    const found = lastIndexAtOrBefore(index.all.times, atMs);
    return found === -1 ? null : index.all.apys[found];
  }
  // Reserve-scoped lookups also match unscoped samples; on ties the later
  // array position wins, matching the old overwrite-in-order scan.
  const scoped = index.byReserve.get(reserve);
  const scopedFound = scoped ? lastIndexAtOrBefore(scoped.times, atMs) : -1;
  const unscopedFound = lastIndexAtOrBefore(index.unscoped.times, atMs);
  const scopedPosition =
    scoped && scopedFound !== -1 ? scoped.positions[scopedFound] : -1;
  const unscopedPosition =
    unscopedFound === -1 ? -1 : index.unscoped.positions[unscopedFound];
  if (scopedPosition === -1 && unscopedPosition === -1) {
    return null;
  }
  return scoped && scopedPosition > unscopedPosition
    ? scoped.apys[scopedFound]
    : index.unscoped.apys[unscopedFound];
}

function calculateWindow(args: {
  apySamples: readonly ReserveApySample[];
  endAt: Date;
  pathEvents: readonly YieldPositionPathEvent[];
  startAt: Date;
}) {
  const { apySamples, endAt, pathEvents, startAt } = args;
  const startMs = startAt.getTime();
  const endMs = endAt.getTime();

  if (endMs <= startMs) {
    return {
      avgPrincipalUsd: 0,
      earnedUsd: 0,
      principalAmountRaw:
        getPathStateAt(pathEvents, endAt)?.principalAmountRaw ?? BigInt(0),
    };
  }

  const changeTimes = new Set<number>([startMs, endMs]);
  for (const event of pathEvents) {
    const time = event.confirmedAt.getTime();
    if (time > startMs && time < endMs) {
      changeTimes.add(time);
    }
  }
  for (const sample of apySamples) {
    const time = sample.observedAt.getTime();
    if (time > startMs && time < endMs) {
      changeTimes.add(time);
    }
  }

  const sortedTimes = [...changeTimes].sort((a, b) => a - b);
  let earnedUsd = 0;
  let principalSeconds = 0;

  for (let index = 0; index < sortedTimes.length - 1; index += 1) {
    const segmentStart = new Date(sortedTimes[index]);
    const segmentEnd = new Date(sortedTimes[index + 1]);
    const segmentSeconds =
      (segmentEnd.getTime() - segmentStart.getTime()) / 1000;
    const pathState = getPathStateAt(pathEvents, segmentStart);
    const principalUsd = pathState ? rawToUsd(pathState.principalAmountRaw) : 0;
    const apy = getApyAt(apySamples, pathState?.reserve ?? null, segmentStart);

    principalSeconds += principalUsd * segmentSeconds;
    if (apy !== null && principalUsd > 0 && segmentSeconds > 0) {
      earnedUsd += (principalUsd * apy * segmentSeconds) / SECONDS_PER_YEAR;
    }
  }

  const bucketSeconds = (endMs - startMs) / 1000;

  return {
    avgPrincipalUsd: bucketSeconds > 0 ? principalSeconds / bucketSeconds : 0,
    earnedUsd,
    principalAmountRaw:
      getPathStateAt(pathEvents, endAt)?.principalAmountRaw ?? BigInt(0),
  };
}

function deriveApyBps(args: {
  avgPrincipalUsd: number;
  bucketSeconds: number;
  earnedUsd: number;
}): number | null {
  if (args.avgPrincipalUsd <= 0 || args.bucketSeconds <= 0) {
    return null;
  }

  return Math.round(
    (args.earnedUsd / args.avgPrincipalUsd) *
      (SECONDS_PER_YEAR / args.bucketSeconds) *
      10_000
  );
}

// Withdrawals include earned yield, so they can take out more of a mint than
// was deposited in it; how that is clamped at zero depends on how the store
// recorded the principal:
// - "total": top-ups in any mint added to one aggregate position, so the
//   store keeps one running total clamped at zero.
// - "per-mint": a top-up in a new mint opened its own position, so each mint
//   is clamped at zero separately.
// The ledger does not record which position an event hit, so the read service
// picks whichever clamp reproduces the stored principal.
export const PRINCIPAL_CLAMPS = ["total", "per-mint"] as const;
export type PrincipalClamp = (typeof PRINCIPAL_CLAMPS)[number] | "position";

type PrincipalIndex = {
  totals: bigint[];
  times: number[];
};

const principalIndexCaches: Record<
  PrincipalClamp,
  WeakMap<readonly YieldPositionEvent[], PrincipalIndex>
> = {
  "per-mint": new WeakMap(),
  total: new WeakMap(),
  position: new WeakMap(),
};

function clampedSubtract(current: bigint, amount: bigint): bigint {
  return current > amount ? current - amount : BigInt(0);
}

function getPrincipalIndex(
  events: readonly YieldPositionEvent[],
  clamp: PrincipalClamp
): PrincipalIndex {
  const cache = principalIndexCaches[clamp];
  const cached = cache.get(events);
  if (cached) {
    return cached;
  }
  const index: PrincipalIndex = { times: [], totals: [] };
  const byMint = new Map<string, bigint>();
  let total = BigInt(0);
  for (const event of sortEarningsEvents(events)) {
    if (clamp === "total") {
      total =
        event.type === "deposit"
          ? total + event.amountRaw
          : clampedSubtract(total, event.amountRaw);
    } else {
      const mint =
        clamp === "position"
          ? String(event.positionId)
          : event.liquidityMint ?? "";
      if (
        clamp === "position" &&
        (event.positionId === undefined ||
          event.initializesPosition === undefined)
      ) {
        throw new EarningsPrincipalHistoryError(
          "principal_history_position_incomplete"
        );
      }
      if (
        clamp === "position" &&
        !byMint.has(mint) &&
        (event.type !== "deposit" || !event.initializesPosition)
      ) {
        throw new EarningsPrincipalHistoryError(
          "principal_history_position_incomplete"
        );
      }
      const current = byMint.get(mint) ?? BigInt(0);
      const next =
        event.type === "deposit"
          ? (clamp === "position" && event.initializesPosition
              ? BigInt(0)
              : current) + event.amountRaw
          : clampedSubtract(current, event.amountRaw);
      byMint.set(mint, next);
      total += next - current;
    }
    index.totals.push(total);
    index.times.push(event.confirmedAt.getTime());
  }
  cache.set(events, index);
  return index;
}

export function principalAt(
  events: readonly YieldPositionEvent[],
  at: Date,
  clamp: PrincipalClamp = "total"
): bigint {
  const index = getPrincipalIndex(events, clamp);
  const found = lastIndexAtOrBefore(index.times, at.getTime());
  return found === -1 ? BigInt(0) : index.totals[found];
}

const snapshotTimesCache = new WeakMap<
  readonly YieldPortfolioSnapshot[],
  number[]
>();

function getPortfolioSnapshotAt(
  snapshots: readonly YieldPortfolioSnapshot[],
  at: Date
): YieldPortfolioSnapshot | null {
  let times = snapshotTimesCache.get(snapshots);
  if (!times) {
    times = snapshots.map((snapshot) => snapshot.observedAt.getTime());
    snapshotTimesCache.set(snapshots, times);
  }
  const found = lastIndexAtOrBefore(times, at.getTime());
  return found === -1 ? null : snapshots[found];
}

function portfolioApyAt(args: {
  apySamples: readonly ReserveApySample[];
  at: Date;
  snapshot: YieldPortfolioSnapshot | null;
}): number | null {
  if (!args.snapshot) {
    return null;
  }
  let weighted = 0;
  let totalRaw = BigInt(0);
  for (const exposure of args.snapshot.exposures) {
    if (exposure.amountRaw <= BigInt(0)) {
      continue;
    }
    totalRaw += exposure.amountRaw;
    if (exposure.kind === "idle") {
      continue;
    }
    const apy = getApyAt(args.apySamples, exposure.reserve, args.at);
    if (apy === null) {
      return null;
    }
    weighted += Number(exposure.amountRaw) * apy;
  }
  return totalRaw > BigInt(0) ? weighted / Number(totalRaw) : null;
}

function calculatePortfolioWindow(args: {
  apySamples: readonly ReserveApySample[];
  endAt: Date;
  events: readonly YieldPositionEvent[];
  principalClamp: PrincipalClamp;
  snapshots: readonly YieldPortfolioSnapshot[];
  startAt: Date;
}) {
  const startMs = args.startAt.getTime();
  const endMs = args.endAt.getTime();
  if (endMs <= startMs) {
    const principalAmountRaw = principalAt(
      args.events,
      args.endAt,
      args.principalClamp
    );
    return { avgPrincipalUsd: 0, earnedUsd: 0, principalAmountRaw };
  }
  const changeTimes = new Set<number>([startMs, endMs]);
  for (const event of args.events) {
    const time = event.confirmedAt.getTime();
    if (time > startMs && time < endMs) {
      changeTimes.add(time);
    }
  }
  for (const snapshot of args.snapshots) {
    const time = snapshot.observedAt.getTime();
    if (time > startMs && time < endMs) {
      changeTimes.add(time);
    }
  }
  for (const sample of args.apySamples) {
    const time = sample.observedAt.getTime();
    if (time > startMs && time < endMs) {
      changeTimes.add(time);
    }
  }

  const sortedTimes = [...changeTimes].sort((left, right) => left - right);
  let earnedUsd = 0;
  let principalSeconds = 0;
  for (let index = 0; index < sortedTimes.length - 1; index += 1) {
    const segmentStart = new Date(sortedTimes[index]);
    const segmentSeconds = (sortedTimes[index + 1] - sortedTimes[index]) / 1000;
    const principalRaw = principalAt(
      args.events,
      segmentStart,
      args.principalClamp
    );
    principalSeconds += rawToUsd(principalRaw) * segmentSeconds;
    const snapshot = getPortfolioSnapshotAt(args.snapshots, segmentStart);
    for (const exposure of snapshot?.exposures ?? []) {
      if (
        exposure.kind !== "kamino" ||
        exposure.amountRaw <= BigInt(0) ||
        !exposure.reserve
      ) {
        continue;
      }
      const apy = getApyAt(args.apySamples, exposure.reserve, segmentStart);
      if (apy !== null) {
        earnedUsd +=
          (rawToUsd(exposure.amountRaw) * apy * segmentSeconds) /
          SECONDS_PER_YEAR;
      }
    }
  }
  const bucketSeconds = (endMs - startMs) / 1000;
  return {
    avgPrincipalUsd: bucketSeconds > 0 ? principalSeconds / bucketSeconds : 0,
    earnedUsd,
    principalAmountRaw: principalAt(
      args.events,
      args.endAt,
      args.principalClamp
    ),
  };
}

export function calculateEarnEarnings(args: {
  apySamples: readonly ReserveApySample[];
  events: readonly YieldPositionEvent[];
  now: Date;
  pathEvents?: readonly YieldPositionPathEvent[];
  portfolioSnapshots?: readonly YieldPortfolioSnapshot[];
  principalClamp?: PrincipalClamp;
  range: EarningsRangeId;
  timezone: string;
}): EarnEarningsResponse {
  const principalClamp = args.principalClamp ?? "total";
  const events = sortEarningsEvents(args.events);
  const pathEvents = [
    ...(args.pathEvents ?? legacyEventsToPathEvents(events)),
  ].sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime());
  const apySamples = [...args.apySamples].sort(
    (a, b) => a.observedAt.getTime() - b.observedAt.getTime()
  );
  const portfolioSnapshots = [...(args.portfolioSnapshots ?? [])].sort(
    (a, b) => a.observedAt.getTime() - b.observedAt.getTime()
  );
  const firstDepositAt =
    events.find((event) => event.type === "deposit")?.confirmedAt ??
    pathEvents.find((event) => event.type === "deposit")?.confirmedAt ??
    null;
  const lastDepositAt =
    [...events].reverse().find((event) => event.type === "deposit")
      ?.confirmedAt ??
    [...pathEvents].reverse().find((event) => event.type === "deposit")
      ?.confirmedAt ??
    null;
  const usePortfolio = portfolioSnapshots.length > 0;
  const buckets = createEarningsBuckets({
    firstDepositAt,
    now: args.now,
    range: args.range,
    timezone: args.timezone,
  });
  const bars = buckets.map((bucket) => {
    const result = usePortfolio
      ? calculatePortfolioWindow({
          principalClamp,
          apySamples,
          endAt: bucket.endAt,
          events,
          snapshots: portfolioSnapshots,
          startAt: bucket.startAt,
        })
      : calculateWindow({
          apySamples,
          endAt: bucket.endAt,
          pathEvents,
          startAt: bucket.startAt,
        });
    const bucketSeconds =
      (bucket.endAt.getTime() - bucket.startAt.getTime()) / 1000;

    return {
      apyBps: deriveApyBps({
        avgPrincipalUsd: result.avgPrincipalUsd,
        bucketSeconds,
        earnedUsd: result.earnedUsd,
      }),
      avgPrincipalUsd: result.avgPrincipalUsd,
      earnedUsd: result.earnedUsd,
      endAt: bucket.endAt.toISOString(),
      isCurrent: bucket.isCurrent,
      label: bucket.label,
      principalAmountRaw: result.principalAmountRaw.toString(),
      principalUsd: rawToUsd(result.principalAmountRaw),
      startAt: bucket.startAt.toISOString(),
    };
  });
  const lifetimeStart = firstDepositAt ?? args.now;
  const calculateRange = (startAt: Date) =>
    usePortfolio
      ? calculatePortfolioWindow({
          principalClamp,
          apySamples,
          endAt: args.now,
          events,
          snapshots: portfolioSnapshots,
          startAt,
        })
      : calculateWindow({
          apySamples,
          endAt: args.now,
          pathEvents,
          startAt,
        });
  const lifetime = calculateRange(lifetimeStart);
  const sinceLastDeposit = calculateRange(lastDepositAt ?? args.now);
  const today = calculateRange(startOfLocalDay(args.now, args.timezone));
  const currentPathState = getPathStateAt(pathEvents, args.now);
  const principalAmountRaw = usePortfolio
    ? principalAt(events, args.now, principalClamp)
    : currentPathState?.principalAmountRaw ?? BigInt(0);
  const currentApy = usePortfolio
    ? portfolioApyAt({
        apySamples,
        at: args.now,
        snapshot: getPortfolioSnapshotAt(portfolioSnapshots, args.now),
      })
    : currentPathState
    ? getApyAt(apySamples, currentPathState.reserve, args.now)
    : null;

  return {
    bars,
    currentApyBps: currentApy === null ? null : Math.round(currentApy * 10_000),
    lastDepositAt: lastDepositAt?.toISOString() ?? null,
    lifetimeEarnedUsd: lifetime.earnedUsd,
    principalAmountRaw: principalAmountRaw.toString(),
    principalUsd: rawToUsd(principalAmountRaw),
    rangeEarnedUsd: bars.reduce((sum, bar) => sum + bar.earnedUsd, 0),
    sinceLastDepositEarnedUsd: sinceLastDeposit.earnedUsd,
    todayEarnedUsd: today.earnedUsd,
  };
}
