import {
  EARNINGS_RANGE_IDS,
  type EarnEarningsBar,
  type EarnEarningsResponse,
  type EarningsRangeId,
} from "./earnings.shared";

export { EARNINGS_RANGE_IDS };
export type { EarnEarningsBar, EarnEarningsResponse, EarningsRangeId };

export type YieldPositionEvent = {
  amountRaw: bigint;
  confirmedAt: Date;
  type: "deposit" | "withdrawal";
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

const USDC_DECIMALS_FACTOR = 1_000_000;
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
  return Number(raw) / USDC_DECIMALS_FACTOR;
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

function getPathStateAt(
  pathEvents: readonly YieldPositionPathEvent[],
  at: Date
): YieldPositionPathEvent | null {
  let current: YieldPositionPathEvent | null = null;
  const atMs = at.getTime();

  for (const event of pathEvents) {
    if (event.confirmedAt.getTime() > atMs) {
      break;
    }
    current = event;
  }

  return current;
}

function getApyAt(
  samples: readonly ReserveApySample[],
  reserve: string | null,
  at: Date
): number | null {
  let apy: number | null = null;
  const atMs = at.getTime();

  for (const sample of samples) {
    if (
      reserve &&
      sample.reserve !== undefined &&
      sample.reserve !== null &&
      sample.reserve !== reserve
    ) {
      continue;
    }
    if (sample.observedAt.getTime() > atMs) {
      break;
    }
    apy = sample.supplyApy;
  }

  return apy;
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

export function calculateEarnEarnings(args: {
  apySamples: readonly ReserveApySample[];
  events: readonly YieldPositionEvent[];
  now: Date;
  pathEvents?: readonly YieldPositionPathEvent[];
  range: EarningsRangeId;
  timezone: string;
}): EarnEarningsResponse {
  const events = [...args.events].sort(
    (a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime()
  );
  const pathEvents = [
    ...(args.pathEvents ?? legacyEventsToPathEvents(events)),
  ].sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime());
  const apySamples = [...args.apySamples].sort(
    (a, b) => a.observedAt.getTime() - b.observedAt.getTime()
  );
  const firstDepositAt =
    pathEvents.find((event) => event.type === "deposit")?.confirmedAt ?? null;
  const lastDepositAt =
    [...pathEvents].reverse().find((event) => event.type === "deposit")
      ?.confirmedAt ?? null;
  const buckets = createEarningsBuckets({
    firstDepositAt,
    now: args.now,
    range: args.range,
    timezone: args.timezone,
  });
  const bars = buckets.map((bucket) => {
    const result = calculateWindow({
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
  const lifetime = calculateWindow({
    apySamples,
    endAt: args.now,
    pathEvents,
    startAt: lifetimeStart,
  });
  const sinceLastDeposit = calculateWindow({
    apySamples,
    endAt: args.now,
    pathEvents,
    startAt: lastDepositAt ?? args.now,
  });
  const today = calculateWindow({
    apySamples,
    endAt: args.now,
    pathEvents,
    startAt: startOfLocalDay(args.now, args.timezone),
  });
  const currentPathState = getPathStateAt(pathEvents, args.now);
  const principalAmountRaw = currentPathState?.principalAmountRaw ?? BigInt(0);
  const currentApy = currentPathState
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
