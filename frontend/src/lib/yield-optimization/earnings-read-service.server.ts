import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import {
  TimescaleReserveClient,
  getTimescaleReserveDatabaseUrl,
} from "@/lib/kamino/timescale-reserve-client.server";
import {
  EARNINGS_RANGE_IDS,
  calculateEarnEarnings,
  normalizeEarningsTimezone,
  type ReserveApySample,
  type YieldPositionEvent,
  type YieldPositionPathEvent,
} from "./earnings-calculator.server";
import type {
  EarnEarningsCoverage,
  EarnEarningsRangeSetResponse,
} from "./earnings.shared";
import {
  findActiveYieldPositionForVault,
  findYieldPositionEvents,
  findYieldPositionHistoryEventsForVault,
  type UserYieldPositionHistoryEventRecord,
  type UserYieldPositionRecord,
} from "./yield-deposit-repository.server";
import {
  earnEarningsSnapshots,
  getYieldOptimizationClient,
} from "./yield-neon-client.server";

export type EarnEarningsReadInput = {
  cluster: string;
  settings: string;
  timezone: string | null;
  vaultIndex: number;
  walletAddress: string;
};

type EarningsPosition = Pick<
  UserYieldPositionRecord,
  | "currentLiquidityMint"
  | "currentMarket"
  | "currentReserve"
  | "initialLiquidityMint"
  | "initialMarket"
  | "initialReserve"
  | "principalAmountRaw"
>;

export type EarnEarningsSnapshotRecord = {
  generatedAt: Date;
  payload: EarnEarningsRangeSetResponse;
};

export type EarnEarningsReadDependencies = {
  apyTimeoutMs: number;
  loadApySamples: (args: {
    end: Date;
    pathEvents: readonly YieldPositionPathEvent[];
    start: Date;
  }) => Promise<ReserveApySample[]>;
  loadHoldingEvents: (
    input: EarnEarningsReadInput
  ) => Promise<UserYieldPositionHistoryEventRecord[]>;
  loadLedgerEvents: (
    input: EarnEarningsReadInput
  ) => Promise<YieldPositionEvent[]>;
  loadPosition: (
    input: EarnEarningsReadInput
  ) => Promise<UserYieldPositionRecord | null>;
  loadSnapshot: (
    input: EarnEarningsReadInput,
    timezone: string
  ) => Promise<EarnEarningsSnapshotRecord | null>;
  now: () => Date;
  saveSnapshot: (args: {
    input: EarnEarningsReadInput;
    payload: EarnEarningsRangeSetResponse;
    principalAmountRaw: bigint;
    timezone: string;
  }) => Promise<void>;
};

class EarnEarningsApyTimeoutError extends Error {
  constructor() {
    super("earnings_timescale_timeout");
    this.name = "EarnEarningsApyTimeoutError";
  }
}

export class EarnEarningsUnavailableError extends Error {
  readonly code: "earnings_unavailable" | "history_incomplete";
  readonly detailCode:
    | "apy_coverage_incomplete"
    | "deposit_history_incomplete"
    | "earnings_unavailable"
    | "holding_history_mismatch"
    | "principal_history_mismatch";

  constructor(
    code: "earnings_unavailable" | "history_incomplete",
    message: string,
    detailCode: EarnEarningsUnavailableError["detailCode"] =
      "earnings_unavailable"
  ) {
    super(message);
    this.code = code;
    this.detailCode = detailCode;
    this.name = "EarnEarningsUnavailableError";
  }
}

function comparePathEvents(
  left: Pick<YieldPositionPathEvent, "confirmedAt" | "type">,
  right: Pick<YieldPositionPathEvent, "confirmedAt" | "type">
) {
  const timeDelta = left.confirmedAt.getTime() - right.confirmedAt.getTime();
  if (timeDelta !== 0) {
    return timeDelta;
  }

  const order = {
    deposit: 0,
    rebalance: 1,
    reconciliation: 2,
    withdrawal: 3,
  } as const;
  return order[left.type] - order[right.type];
}

function findHoldingAt(
  events: readonly UserYieldPositionHistoryEventRecord[],
  at: Date
) {
  const atMs = at.getTime();
  let current: UserYieldPositionHistoryEventRecord | null = null;
  for (const event of events) {
    if (event.confirmedAt.getTime() > atMs) {
      break;
    }
    current = event;
  }
  return current;
}

export function buildCanonicalEarningsPath(args: {
  holdingEvents: readonly UserYieldPositionHistoryEventRecord[];
  ledgerEvents: readonly YieldPositionEvent[];
  position: EarningsPosition;
}): YieldPositionPathEvent[] {
  const holdingEvents = [...args.holdingEvents].sort((left, right) =>
    comparePathEvents(left, right)
  );
  const ledgerEvents = [...args.ledgerEvents].sort(
    (left, right) => left.confirmedAt.getTime() - right.confirmedAt.getTime()
  );
  let principalAmountRaw = BigInt(0);
  let reserve = args.position.initialReserve;
  let market = args.position.initialMarket;
  let liquidityMint = args.position.initialLiquidityMint;

  const principalEvents: YieldPositionPathEvent[] = ledgerEvents.map(
    (event) => {
      const matchingHolding = holdingEvents.find(
        (holding) =>
          holding.type === event.type &&
          Math.abs(
            holding.confirmedAt.getTime() - event.confirmedAt.getTime()
          ) < 1_000
      );
      const holding =
        matchingHolding ?? findHoldingAt(holdingEvents, event.confirmedAt);
      if (holding) {
        reserve = holding.reserve;
        market = holding.market;
        liquidityMint = holding.liquidityMint;
      }

      if (event.type === "deposit") {
        principalAmountRaw += event.amountRaw;
      } else {
        const principalReductionRaw =
          matchingHolding?.eventType === "withdrawal_full"
            ? principalAmountRaw
            : matchingHolding?.principalDeltaRaw &&
              matchingHolding.principalDeltaRaw < BigInt(0)
            ? -matchingHolding.principalDeltaRaw
            : event.amountRaw;
        principalAmountRaw =
          principalAmountRaw > principalReductionRaw
            ? principalAmountRaw - principalReductionRaw
            : BigInt(0);
      }

      return {
        amountRaw: principalAmountRaw,
        confirmedAt: event.confirmedAt,
        liquidityMint,
        market,
        principalAmountRaw,
        reserve,
        type: event.type,
      };
    }
  );

  const transitions = holdingEvents
    .filter(
      (event) => event.type === "rebalance" || event.type === "reconciliation"
    )
    .map((event) => {
      let principalAtEvent = BigInt(0);
      for (const principalEvent of principalEvents) {
        if (
          principalEvent.confirmedAt.getTime() > event.confirmedAt.getTime()
        ) {
          break;
        }
        principalAtEvent = principalEvent.principalAmountRaw;
      }
      return {
        amountRaw: event.amountRaw,
        confirmedAt: event.confirmedAt,
        liquidityMint: event.liquidityMint,
        market: event.market,
        principalAmountRaw: principalAtEvent,
        reserve: event.reserve,
        type: event.type,
      } satisfies YieldPositionPathEvent;
    });

  const combined = [...principalEvents, ...transitions].sort(comparePathEvents);
  const material: YieldPositionPathEvent[] = [];
  for (const event of combined) {
    const previous = material.at(-1);
    const isRoutineReconciliation =
      event.type === "reconciliation" &&
      previous !== undefined &&
      previous.reserve === event.reserve &&
      previous.market === event.market &&
      previous.liquidityMint === event.liquidityMint &&
      previous.principalAmountRaw === event.principalAmountRaw;
    if (!isRoutineReconciliation) {
      material.push(event);
    }
  }

  return material;
}

export function getMaterialEarningsHistoryRevision(
  events: readonly YieldPositionPathEvent[]
) {
  const material = events.map((event) => [
    event.type,
    event.confirmedAt.toISOString(),
    event.reserve,
    event.market,
    event.liquidityMint,
    event.principalAmountRaw.toString(),
  ]);
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

export function getEarningsCoverage(args: {
  apySamples: readonly ReserveApySample[];
  now: Date;
  pathEvents: readonly YieldPositionPathEvent[];
}): EarnEarningsCoverage {
  const required = new Map<string, Date>();
  for (const event of args.pathEvents) {
    if (event.principalAmountRaw <= BigInt(0) || !event.reserve) {
      continue;
    }
    const current = required.get(event.reserve);
    if (!current || event.confirmedAt.getTime() < current.getTime()) {
      required.set(event.reserve, event.confirmedAt);
    }
  }
  const sampledReserves = new Set(
    args.apySamples.flatMap((sample) =>
      sample.reserve ? [sample.reserve] : []
    )
  );
  const missingReserves = [...required]
    .filter(
      ([reserve, requiredAt]) =>
        !args.apySamples.some(
          (sample) =>
            sample.reserve === reserve &&
            sample.observedAt.getTime() <= requiredAt.getTime()
        )
    )
    .map(([reserve]) => reserve)
    .sort();
  const gappedReserves = new Set<string>();
  let maxSampleGapMs: number | null = null;
  for (let index = 0; index < args.pathEvents.length; index += 1) {
    const event = args.pathEvents[index];
    if (event.principalAmountRaw <= BigInt(0) || !event.reserve) {
      continue;
    }
    const intervalEnd = args.pathEvents[index + 1]?.confirmedAt ?? args.now;
    const samples = args.apySamples
      .filter(
        (sample) =>
          sample.reserve === event.reserve &&
          sample.observedAt.getTime() <= intervalEnd.getTime()
      )
      .sort(
        (left, right) =>
          left.observedAt.getTime() - right.observedAt.getTime()
      );
    const seed = [...samples]
      .reverse()
      .find(
        (sample) =>
          sample.observedAt.getTime() <= event.confirmedAt.getTime()
      );
    if (!seed) {
      gappedReserves.add(event.reserve);
      continue;
    }
    let cursorMs = event.confirmedAt.getTime();
    for (const sample of samples) {
      const sampleMs = sample.observedAt.getTime();
      if (sampleMs <= cursorMs) {
        continue;
      }
      const gapMs = sampleMs - cursorMs;
      maxSampleGapMs = Math.max(maxSampleGapMs ?? 0, gapMs);
      if (gapMs > 36 * 60 * 60 * 1000) {
        gappedReserves.add(event.reserve);
      }
      cursorMs = sampleMs;
    }
    const trailingGapMs = intervalEnd.getTime() - cursorMs;
    maxSampleGapMs = Math.max(maxSampleGapMs ?? 0, trailingGapMs);
    if (trailingGapMs > 36 * 60 * 60 * 1000) {
      gappedReserves.add(event.reserve);
    }
  }
  const currentReserve = [...args.pathEvents]
    .reverse()
    .find((event) => event.principalAmountRaw > BigInt(0))?.reserve;
  const currentReserveLatestSample = currentReserve
    ? [...args.apySamples]
        .reverse()
        .find((sample) => sample.reserve === currentReserve) ?? null
    : null;
  const currentReserveSampleAgeMs = currentReserveLatestSample
    ? Math.max(
        0,
        args.now.getTime() - currentReserveLatestSample.observedAt.getTime()
      )
    : null;
  const staleReserves =
    currentReserve &&
    currentReserveSampleAgeMs !== null &&
    currentReserveSampleAgeMs > 36 * 60 * 60 * 1000
      ? [currentReserve]
      : [];

  return {
    currentReserveSampleAgeMs,
    eventCount: args.pathEvents.length,
    gappedReserves: [...gappedReserves].sort(),
    maxSampleGapMs,
    missingReserves,
    reserveCount: required.size,
    sampleCount: args.apySamples.length,
    sampledReserveCount: sampledReserves.size,
    staleReserves,
  };
}

async function loadSnapshot(
  input: EarnEarningsReadInput,
  timezone: string
): Promise<EarnEarningsSnapshotRecord | null> {
  const client = getYieldOptimizationClient();
  const row = await client.db.query.earnEarningsSnapshots.findFirst({
    where: and(
      eq(earnEarningsSnapshots.cluster, input.cluster),
      eq(earnEarningsSnapshots.walletAddress, input.walletAddress),
      eq(earnEarningsSnapshots.settings, input.settings),
      eq(earnEarningsSnapshots.vaultIndex, input.vaultIndex),
      eq(earnEarningsSnapshots.timezone, timezone)
    ),
  });
  return row ? { generatedAt: row.generatedAt, payload: row.payload } : null;
}

async function saveSnapshot(args: {
  input: EarnEarningsReadInput;
  payload: EarnEarningsRangeSetResponse;
  principalAmountRaw: bigint;
  timezone: string;
}) {
  const client = getYieldOptimizationClient();
  const generatedAt = new Date(args.payload.generatedAt);
  const values = {
    cluster: args.input.cluster,
    generatedAt,
    historyRevision: args.payload.historyRevision,
    payload: args.payload,
    principalAmountRaw: args.principalAmountRaw,
    settings: args.input.settings,
    timezone: args.timezone,
    updatedAt: generatedAt,
    vaultIndex: args.input.vaultIndex,
    walletAddress: args.input.walletAddress,
  };
  await client.db
    .insert(earnEarningsSnapshots)
    .values(values)
    .onConflictDoUpdate({
      set: values,
      target: [
        earnEarningsSnapshots.cluster,
        earnEarningsSnapshots.walletAddress,
        earnEarningsSnapshots.settings,
        earnEarningsSnapshots.vaultIndex,
        earnEarningsSnapshots.timezone,
      ],
    });
}

async function loadApySamples(args: {
  end: Date;
  pathEvents: readonly YieldPositionPathEvent[];
  start: Date;
}) {
  const reserves = [...new Set(args.pathEvents.map((event) => event.reserve))]
    .filter(Boolean)
    .sort();
  if (reserves.length === 0) {
    return [];
  }
  const databaseUrl = getTimescaleReserveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("missing_timescale_database_url");
  }
  const client = new TimescaleReserveClient({ databaseUrl, maxConnections: 1 });
  try {
    return await client.getReserveApyHistorySamplesForReserves({
      end: args.end,
      reserves,
      start: args.start,
    });
  } finally {
    await client.close();
  }
}

function staleSnapshot(
  snapshot: EarnEarningsSnapshotRecord,
  now: Date,
  staleReason: string
): EarnEarningsRangeSetResponse {
  return {
    ...snapshot.payload,
    freshness: "stale",
    snapshotAgeMs: Math.max(0, now.getTime() - snapshot.generatedAt.getTime()),
    staleReason,
  };
}

function normalizedError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : "";
  return {
    errorCode:
      error instanceof EarnEarningsUnavailableError
        ? error.code
        : error instanceof EarnEarningsApyTimeoutError
        ? "timescale_timeout"
        : rawMessage.includes("earn_earnings_snapshots")
        ? "snapshot_store_unavailable"
        : rawMessage.includes("timescale")
        ? "timescale_unavailable"
        : "dependency_unavailable",
    errorName: error instanceof Error ? error.name : typeof error,
    errorDetailCode:
      error instanceof EarnEarningsUnavailableError
        ? error.detailCode
        : null,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new EarnEarningsApyTimeoutError()),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function createEmptyEarnEarningsRangeSet(args: {
  now: Date;
  timezone: string | null;
}): EarnEarningsRangeSetResponse {
  const timezone = normalizeEarningsTimezone(args.timezone);
  const ranges = Object.fromEntries(
    EARNINGS_RANGE_IDS.map((range) => [
      range,
      calculateEarnEarnings({
        apySamples: [],
        events: [],
        now: args.now,
        pathEvents: [],
        range,
        timezone,
      }),
    ])
  ) as EarnEarningsRangeSetResponse["ranges"];
  return {
    coverage: {
      currentReserveSampleAgeMs: null,
      eventCount: 0,
      gappedReserves: [],
      maxSampleGapMs: null,
      missingReserves: [],
      reserveCount: 0,
      sampleCount: 0,
      sampledReserveCount: 0,
      staleReserves: [],
    },
    freshness: "fresh",
    generatedAt: args.now.toISOString(),
    historyRevision: getMaterialEarningsHistoryRevision([]),
    outcome: "empty",
    principalMatchesHistory: true,
    ranges,
    snapshotAgeMs: null,
    sourcePrincipalAmountRaw: "0",
    staleReason: null,
  };
}

function walletScope(walletAddress: string) {
  return walletAddress.length <= 12
    ? "redacted"
    : `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`;
}

export async function readEarnEarningsRangeSet(
  input: EarnEarningsReadInput,
  dependencies: EarnEarningsReadDependencies = {
    apyTimeoutMs: 8_000,
    loadApySamples,
    loadHoldingEvents: findYieldPositionHistoryEventsForVault,
    loadLedgerEvents: findYieldPositionEvents,
    loadPosition: findActiveYieldPositionForVault,
    loadSnapshot,
    now: () => new Date(),
    saveSnapshot,
  }
): Promise<EarnEarningsRangeSetResponse> {
  const startedAt = Date.now();
  let apyMs: number | null = null;
  let historyMs: number | null = null;
  const now = dependencies.now();
  const timezone = normalizeEarningsTimezone(input.timezone);
  let snapshot: EarnEarningsSnapshotRecord | null = null;
  try {
    snapshot = await dependencies.loadSnapshot(input, timezone);
  } catch (error) {
    console.warn(
      "[earnings-read] snapshot read unavailable",
      normalizedError(error)
    );
  }

  try {
    const historyStartedAt = Date.now();
    const [position, ledgerEvents, holdingEvents] = await Promise.all([
      dependencies.loadPosition(input),
      dependencies.loadLedgerEvents(input),
      dependencies.loadHoldingEvents(input),
    ]);
    historyMs = Date.now() - historyStartedAt;

    if (!position) {
      return createEmptyEarnEarningsRangeSet({ now, timezone });
    }

    const pathEvents = buildCanonicalEarningsPath({
      holdingEvents,
      ledgerEvents,
      position,
    });
    const historyRevision = getMaterialEarningsHistoryRevision(pathEvents);
    const projectedPrincipal =
      pathEvents.at(-1)?.principalAmountRaw ?? BigInt(0);
    const projectedHolding = pathEvents.at(-1) ?? null;
    const principalMatchesHistory =
      projectedPrincipal === position.principalAmountRaw;
    const holdingMatchesHistory =
      projectedHolding?.reserve === position.currentReserve &&
      projectedHolding.liquidityMint === position.currentLiquidityMint;
    if (
      !principalMatchesHistory ||
      !holdingMatchesHistory ||
      ledgerEvents.length === 0
    ) {
      const detailCode = !principalMatchesHistory
        ? "principal_history_mismatch"
        : !holdingMatchesHistory
        ? "holding_history_mismatch"
        : "deposit_history_incomplete";
      throw new EarnEarningsUnavailableError(
        "history_incomplete",
        "Earn principal history is incomplete.",
        detailCode
      );
    }

    const firstDepositAt = pathEvents.find(
      (event) => event.type === "deposit"
    )?.confirmedAt;
    if (!firstDepositAt) {
      throw new EarnEarningsUnavailableError(
        "history_incomplete",
        "Earn deposit history is incomplete.",
        "deposit_history_incomplete"
      );
    }

    const apyStartedAt = Date.now();
    let apySamples: ReserveApySample[];
    try {
      apySamples = await withTimeout(
        dependencies.loadApySamples({
          end: now,
          pathEvents,
          start: firstDepositAt,
        }),
        dependencies.apyTimeoutMs
      );
    } finally {
      apyMs = Date.now() - apyStartedAt;
    }
    const coverage = getEarningsCoverage({ apySamples, now, pathEvents });
    if (
      coverage.missingReserves.length > 0 ||
      coverage.gappedReserves.length > 0 ||
      coverage.staleReserves.length > 0 ||
      coverage.sampledReserveCount !== coverage.reserveCount
    ) {
      throw new EarnEarningsUnavailableError(
        "history_incomplete",
        "Earn APY history coverage is incomplete.",
        "apy_coverage_incomplete"
      );
    }

    const ranges = Object.fromEntries(
      EARNINGS_RANGE_IDS.map((range) => [
        range,
        calculateEarnEarnings({
          apySamples,
          events: [],
          now,
          pathEvents,
          range,
          timezone,
        }),
      ])
    ) as EarnEarningsRangeSetResponse["ranges"];
    const payload: EarnEarningsRangeSetResponse = {
      coverage,
      freshness: "fresh",
      generatedAt: now.toISOString(),
      historyRevision,
      outcome: "ready",
      principalMatchesHistory,
      ranges,
      snapshotAgeMs: null,
      sourcePrincipalAmountRaw: position.principalAmountRaw.toString(),
      staleReason: null,
    };
    await dependencies
      .saveSnapshot({
        input,
        payload,
        principalAmountRaw: position.principalAmountRaw,
        timezone,
      })
      .catch((error) => {
        console.warn(
          "[earnings-read] snapshot write unavailable",
          normalizedError(error)
        );
      });
    console.info("[earnings-read] ready", {
      apyMs,
      currentReserveSampleAgeMs: coverage.currentReserveSampleAgeMs,
      eventCount: coverage.eventCount,
      gappedReserveCount: coverage.gappedReserves.length,
      historyMs,
      historyRevision,
      outcome: payload.outcome,
      principalMatchesHistory,
      reserveCount: coverage.reserveCount,
      sampleCount: coverage.sampleCount,
      totalMs: Date.now() - startedAt,
      walletScope: walletScope(input.walletAddress),
    });
    return payload;
  } catch (error) {
    const reason =
      error instanceof EarnEarningsUnavailableError
        ? error.code
        : "dependency_unavailable";
    if (snapshot) {
      const stale = staleSnapshot(snapshot, now, reason);
      console.warn("[earnings-read] stale", {
        alertKey:
          error instanceof EarnEarningsUnavailableError &&
          error.detailCode === "principal_history_mismatch"
            ? "earnings_principal_mismatch_stale"
            : "earnings_stale",
        apyMs,
        ...normalizedError(error),
        historyMs,
        historyRevision: stale.historyRevision,
        outcome: stale.outcome,
        snapshotAgeMs: stale.snapshotAgeMs,
        staleReason: reason,
        totalMs: Date.now() - startedAt,
        walletScope: walletScope(input.walletAddress),
      });
      return stale;
    }
    console.error("[earnings-read] unavailable", {
      alertKey:
        error instanceof EarnEarningsUnavailableError &&
        error.detailCode === "principal_history_mismatch"
          ? "earnings_principal_mismatch"
          : reason === "history_incomplete"
          ? "earnings_history_incomplete"
          : "earnings_unavailable",
      apyMs,
      ...normalizedError(error),
      historyMs,
      outcome: "unavailable",
      staleReason: reason,
      totalMs: Date.now() - startedAt,
      walletScope: walletScope(input.walletAddress),
    });
    if (error instanceof EarnEarningsUnavailableError) {
      throw error;
    }
    throw new EarnEarningsUnavailableError(
      "earnings_unavailable",
      "Earn earnings are unavailable."
    );
  }
}
