#!/usr/bin/env -S bun --conditions=react-server

import { and, desc, eq } from "drizzle-orm";

import { calculateEarnEarnings } from "@/lib/yield-optimization/earnings-calculator.server";
import { deriveEarnEarningsDisplayAmounts } from "@/lib/yield-optimization/earnings-display.shared";
import {
  buildCanonicalEarningsPath,
  getEarningsCoverage,
  getMaterialEarningsHistoryRevision,
  readEarnEarningsRangeSet,
  type EarnEarningsReadDependencies,
  type EarnEarningsSnapshotRecord,
} from "@/lib/yield-optimization/earnings-read-service.server";
import type {
  UserYieldPositionHistoryEventRecord,
  UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";
import {
  isEarnEarningsCacheRevisionCurrent,
  isServerVerifiedEarnEarningsPayload,
} from "@/lib/yield-optimization/earnings.shared";
import {
  getYieldOptimizationClient,
  userYieldPositions,
} from "@/lib/yield-optimization/yield-neon-client.server";

const EXACT_WALLET = "8q1BobkAbCF9ghAhFke4PffqZhgdNbfeCY7SQiw6FUG2";
const EXACT_PRINCIPAL_RAW = "6446565733";
const NOW = new Date("2026-07-14T04:00:00.000Z");
const DEPOSIT_AT = new Date("2026-06-28T12:00:00.000Z");
const fixtureInput = {
  cluster: "mainnet-beta",
  settings: "fixture-settings",
  timezone: "America/Los_Angeles",
  vaultIndex: 1,
  walletAddress: "fixture-wallet",
};
const results: { evidence?: unknown; name: string; status: "PASS" }[] = [];

function rawUsdc(amount: number) {
  return BigInt(Math.round(amount * 1_000_000));
}

function verify(name: string, condition: boolean, evidence?: unknown) {
  if (!condition) {
    throw new Error(`FAIL ${name}: ${JSON.stringify(evidence)}`);
  }
  results.push({ evidence, name, status: "PASS" });
}

function fixturePosition(principalAmountRaw = rawUsdc(100)) {
  return {
    currentLiquidityMint: "USDC",
    currentMarket: "market-a",
    currentReserve: "reserve-a",
    initialLiquidityMint: "USDC",
    initialMarket: "market-a",
    initialReserve: "reserve-a",
    principalAmountRaw,
  } as UserYieldPositionRecord;
}

function fixtureHolding(args: {
  at: Date;
  reserve?: string;
  type: UserYieldPositionHistoryEventRecord["type"];
}) {
  const reserve = args.reserve ?? "reserve-a";
  return {
    amountRaw: rawUsdc(100),
    confirmedAt: args.at,
    liquidityMint: "USDC",
    market: reserve === "reserve-a" ? "market-a" : "market-b",
    principalAmountRaw: rawUsdc(100),
    reserve,
    type: args.type,
  } as UserYieldPositionHistoryEventRecord;
}

function fixtureDependencies(args?: {
  failApy?: boolean;
  hangApy?: boolean;
  holdingEvents?: UserYieldPositionHistoryEventRecord[];
  principalAmountRaw?: bigint;
  samples?: { observedAt: Date; reserve: string; supplyApy: number }[];
  snapshot?: EarnEarningsSnapshotRecord | null;
}) {
  let saved: EarnEarningsSnapshotRecord | null = null;
  const dependencies: EarnEarningsReadDependencies = {
    apyTimeoutMs: 10,
    loadApySamples: async () => {
      if (args?.hangApy) {
        return new Promise(() => undefined);
      }
      if (args?.failApy) {
        throw new Error("forced_timescale_failure");
      }
      return (
        args?.samples ??
        Array.from({ length: 17 }, (_, index) => ({
          observedAt: new Date(
            new Date("2026-06-28T00:00:00.000Z").getTime() +
              index * 24 * 60 * 60 * 1000
          ),
          reserve: "reserve-a",
          supplyApy: 0.1,
        }))
      );
    },
    loadHoldingEvents: async () =>
      args?.holdingEvents ?? [
        fixtureHolding({ at: DEPOSIT_AT, type: "deposit" }),
        fixtureHolding({
          at: new Date("2026-07-13T03:00:00.000Z"),
          type: "reconciliation",
        }),
      ],
    loadLedgerEvents: async () => [
      { amountRaw: rawUsdc(100), confirmedAt: DEPOSIT_AT, type: "deposit" },
    ],
    loadPosition: async () =>
      fixturePosition(args?.principalAmountRaw ?? rawUsdc(100)),
    loadSnapshot: async () => args?.snapshot ?? null,
    now: () => NOW,
    saveSnapshot: async ({ payload }) => {
      saved = { generatedAt: new Date(payload.generatedAt), payload };
    },
  };
  return { dependencies, getSaved: () => saved };
}

async function verifyFixtures() {
  const ledgerEvents = [
    {
      amountRaw: rawUsdc(100),
      confirmedAt: DEPOSIT_AT,
      type: "deposit" as const,
    },
  ];
  const basePath = buildCanonicalEarningsPath({
    holdingEvents: [fixtureHolding({ at: DEPOSIT_AT, type: "deposit" })],
    ledgerEvents,
    position: fixturePosition(),
  });
  const reconciledPath = buildCanonicalEarningsPath({
    holdingEvents: [
      fixtureHolding({ at: DEPOSIT_AT, type: "deposit" }),
      fixtureHolding({
        at: new Date("2026-07-13T03:00:00.000Z"),
        type: "reconciliation",
      }),
    ],
    ledgerEvents,
    position: fixturePosition(),
  });
  verify(
    "routine reconciliation keeps material revision",
    getMaterialEarningsHistoryRevision(basePath) ===
      getMaterialEarningsHistoryRevision(reconciledPath)
  );

  const legacyPath = buildCanonicalEarningsPath({
    holdingEvents: [
      fixtureHolding({
        at: new Date("2026-07-01T00:00:00.000Z"),
        type: "reconciliation",
      }),
    ],
    ledgerEvents,
    position: fixturePosition(),
  });
  verify(
    "legacy reconciliation-only history uses durable deposit ledger",
    legacyPath.at(-1)?.principalAmountRaw === rawUsdc(100)
  );

  const lifecyclePath = buildCanonicalEarningsPath({
    holdingEvents: [
      fixtureHolding({ at: DEPOSIT_AT, type: "deposit" }),
    ],
    ledgerEvents: [
      ...ledgerEvents,
      {
        amountRaw: rawUsdc(50),
        confirmedAt: new Date("2026-07-01T00:00:00.000Z"),
        type: "deposit",
      },
      {
        amountRaw: rawUsdc(25),
        confirmedAt: new Date("2026-07-02T00:00:00.000Z"),
        type: "withdrawal",
      },
      {
        amountRaw: rawUsdc(125),
        confirmedAt: new Date("2026-07-03T00:00:00.000Z"),
        type: "withdrawal",
      },
      {
        amountRaw: rawUsdc(40),
        confirmedAt: new Date("2026-07-04T00:00:00.000Z"),
        type: "deposit",
      },
    ],
    position: fixturePosition(rawUsdc(40)),
  });
  verify(
    "top-up, partial/full withdrawal, exit, and redeposit project principal",
    lifecyclePath.at(-1)?.principalAmountRaw === rawUsdc(40)
  );

  const idleWithdrawalPath = buildCanonicalEarningsPath({
    holdingEvents: [
      fixtureHolding({ at: DEPOSIT_AT, type: "deposit" }),
      {
        ...fixtureHolding({
          at: new Date("2026-07-01T00:00:00.000Z"),
          type: "withdrawal",
        }),
        eventType: "withdrawal_full",
        principalDeltaRaw: BigInt(0),
      },
    ],
    ledgerEvents: [
      ...ledgerEvents,
      {
        amountRaw: rawUsdc(10),
        confirmedAt: new Date("2026-07-01T00:00:00.000Z"),
        type: "withdrawal",
      },
    ],
    position: fixturePosition(),
  });
  verify(
    "idle withdrawal zero principal delta leaves invested principal unchanged",
    idleWithdrawalPath.at(-1)?.principalAmountRaw === rawUsdc(100)
  );

  const zeroPrincipalReserveCoverage = getEarningsCoverage({
    apySamples: [
      {
        observedAt: new Date("2026-06-28T00:00:00.000Z"),
        reserve: "reserve-a",
        supplyApy: 0.1,
      },
      {
        observedAt: new Date("2026-06-28T00:00:00.000Z"),
        reserve: "reserve-b",
        supplyApy: 0.1,
      },
    ],
    now: new Date("2026-06-29T00:00:00.000Z"),
    pathEvents: [
      {
        amountRaw: rawUsdc(100),
        confirmedAt: DEPOSIT_AT,
        liquidityMint: "USDC",
        market: "market-a",
        principalAmountRaw: rawUsdc(100),
        reserve: "reserve-a",
        type: "deposit",
      },
      {
        amountRaw: BigInt(0),
        confirmedAt: new Date("2026-06-29T00:00:00.000Z"),
        liquidityMint: "USDC",
        market: "market-b",
        principalAmountRaw: BigInt(0),
        reserve: "reserve-b",
        type: "reconciliation",
      },
    ],
  });
  verify(
    "zero-principal reserve samples do not inflate required coverage",
    zeroPrincipalReserveCoverage.reserveCount === 1 &&
      zeroPrincipalReserveCoverage.sampledReserveCount === 1 &&
      zeroPrincipalReserveCoverage.missingReserves.length === 0 &&
      zeroPrincipalReserveCoverage.gappedReserves.length === 0 &&
      zeroPrincipalReserveCoverage.staleReserves.length === 0,
    zeroPrincipalReserveCoverage
  );

  verify(
    "Autodeposit revision changes bypass the fresh in-memory cache",
    isEarnEarningsCacheRevisionCurrent("principal-100", "principal-100") &&
      !isEarnEarningsCacheRevisionCurrent("principal-100", "principal-125")
  );
  verify(
    "prior Autodeposit revisions are excluded from stale-response comparisons",
    !isEarnEarningsCacheRevisionCurrent("principal-100", "principal-125")
  );

  const freshFixture = fixtureDependencies();
  const fresh = await readEarnEarningsRangeSet(
    fixtureInput,
    freshFixture.dependencies
  );
  verify(
    "complete positive history is ready/fresh",
    fresh.outcome === "ready" &&
      fresh.freshness === "fresh" &&
      fresh.principalMatchesHistory &&
      fresh.coverage.missingReserves.length === 0 &&
      fresh.ranges.ALL.lifetimeEarnedUsd > 0
  );
  verify(
    "client accepts server-verified earnings when the live holding includes yield",
    isServerVerifiedEarnEarningsPayload(fresh) &&
      rawUsdc(100.25) > BigInt(fresh.sourcePrincipalAmountRaw),
    {
      liveHoldingAmountRaw: rawUsdc(100.25).toString(),
      sourcePrincipalAmountRaw: fresh.sourcePrincipalAmountRaw,
    }
  );
  verify(
    "fresh result persists a verified snapshot",
    Boolean(freshFixture.getSaved())
  );

  const staleFixture = fixtureDependencies({
    failApy: true,
    snapshot: { generatedAt: new Date(fresh.generatedAt), payload: fresh },
  });
  const stale = await readEarnEarningsRangeSet(
    fixtureInput,
    staleFixture.dependencies
  );
  verify(
    "dependency failure retains last-known-good values as stale",
    stale.freshness === "stale" &&
      stale.ranges.ALL.lifetimeEarnedUsd === fresh.ranges.ALL.lifetimeEarnedUsd
  );

  const timedOut = await readEarnEarningsRangeSet(
    fixtureInput,
    fixtureDependencies({
      hangApy: true,
      snapshot: { generatedAt: new Date(fresh.generatedAt), payload: fresh },
    }).dependencies
  );
  verify(
    "Timescale timeout retains last-known-good values as stale",
    timedOut.freshness === "stale" &&
      timedOut.ranges.ALL.lifetimeEarnedUsd ===
        fresh.ranges.ALL.lifetimeEarnedUsd
  );

  let timeoutWithoutSnapshotCode: string | null = null;
  try {
    await readEarnEarningsRangeSet(
      fixtureInput,
      fixtureDependencies({ hangApy: true }).dependencies
    );
  } catch (error) {
    timeoutWithoutSnapshotCode =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : null;
  }
  verify(
    "Timescale timeout without a snapshot is unavailable, never zero",
    timeoutWithoutSnapshotCode === "earnings_unavailable"
  );

  const lagged = await readEarnEarningsRangeSet(
    fixtureInput,
    fixtureDependencies({
      principalAmountRaw: rawUsdc(101),
      snapshot: { generatedAt: new Date(fresh.generatedAt), payload: fresh },
    }).dependencies
  );
  verify(
    "principal/history lag retains verified snapshot as updating",
    lagged.freshness === "stale" &&
      lagged.staleReason === "history_incomplete" &&
      lagged.ranges.ALL.lifetimeEarnedUsd ===
        fresh.ranges.ALL.lifetimeEarnedUsd
  );

  const materialRevision = await readEarnEarningsRangeSet(
    fixtureInput,
    fixtureDependencies({
      failApy: true,
      holdingEvents: [
        fixtureHolding({ at: DEPOSIT_AT, type: "deposit" }),
        fixtureHolding({
          at: new Date("2026-07-10T00:00:00.000Z"),
          reserve: "reserve-b",
          type: "reconciliation",
        }),
      ],
      snapshot: { generatedAt: new Date(fresh.generatedAt), payload: fresh },
    }).dependencies
  );
  verify(
    "material reconciliation during outage retains verified snapshot",
    materialRevision.freshness === "stale" &&
      materialRevision.ranges.ALL.lifetimeEarnedUsd ===
        fresh.ranges.ALL.lifetimeEarnedUsd
  );

  let missingCoverageCode: string | null = null;
  try {
    await readEarnEarningsRangeSet(
      fixtureInput,
      fixtureDependencies({ samples: [] }).dependencies
    );
  } catch (error) {
    missingCoverageCode =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : null;
  }
  verify(
    "missing APY coverage is history_incomplete, never zero",
    missingCoverageCode === "history_incomplete"
  );

  const emptyDependencies = fixtureDependencies().dependencies;
  emptyDependencies.loadPosition = async () => null;
  emptyDependencies.loadLedgerEvents = async () => [];
  emptyDependencies.loadHoldingEvents = async () => [];
  const empty = await readEarnEarningsRangeSet(fixtureInput, emptyDependencies);
  verify(
    "verified empty is distinct from unavailable",
    empty.outcome === "empty" &&
      empty.freshness === "fresh" &&
      empty.ranges.ALL.lifetimeEarnedUsd === 0
  );

  const display = deriveEarnEarningsDisplayAmounts({
    apyBps: 1_000,
    canLiveEstimate: false,
    dailyData: fresh.ranges["30D"],
    generatedAt: fresh.generatedAt,
    lifetimeData: fresh.ranges.ALL,
    nowMs: NOW.getTime() + 60_000,
    principalAmount: 100,
  });
  verify(
    "stale display is not extrapolated and keeps lifetime/range/today distinct",
    display.lifetimeEarnedUsd ===
      Number(fresh.ranges.ALL.lifetimeEarnedUsd.toFixed(6)) &&
      display.rangeEarnedUsd ===
        Number(fresh.ranges["30D"].rangeEarnedUsd.toFixed(6)) &&
      display.todayEarnedUsd ===
        Number(fresh.ranges["30D"].todayEarnedUsd.toFixed(6))
  );

  const localDay = calculateEarnEarnings({
    apySamples: [
      {
        observedAt: new Date("2026-07-13T00:00:00.000Z"),
        reserve: "reserve-a",
        supplyApy: 0.365,
      },
    ],
    events: [],
    now: NOW,
    pathEvents: [
      {
        amountRaw: rawUsdc(100),
        confirmedAt: new Date("2026-07-13T00:00:00.000Z"),
        liquidityMint: "USDC",
        market: "market-a",
        principalAmountRaw: rawUsdc(100),
        reserve: "reserve-a",
        type: "deposit",
      },
    ],
    range: "30D",
    timezone: "America/Los_Angeles",
  });
  verify(
    "today starts at local midnight",
    Math.abs(localDay.todayEarnedUsd - (100 * 0.365 * 21) / (365 * 24)) < 1e-9,
    { todayEarnedUsd: localDay.todayEarnedUsd }
  );
}

async function verifyLiveWallet() {
  const client = getYieldOptimizationClient();
  const position = await client.db.query.userYieldPositions.findFirst({
    orderBy: [desc(userYieldPositions.updatedAt), desc(userYieldPositions.id)],
    where: and(
      eq(userYieldPositions.walletAddress, EXACT_WALLET),
      eq(userYieldPositions.vaultIndex, 1),
      eq(userYieldPositions.status, "active")
    ),
  });
  verify("live wallet has an active Earn position", Boolean(position));
  if (!position) {
    return;
  }
  const payload = await readEarnEarningsRangeSet({
    cluster:
      process.env.NEXT_PUBLIC_SOLANA_ENV === "devnet"
        ? "devnet"
        : "mainnet-beta",
    settings: position.settings,
    timezone: "America/Los_Angeles",
    vaultIndex: 1,
    walletAddress: EXACT_WALLET,
  });
  const daily = payload.ranges["30D"];
  verify(
    "live wallet principal matches exact regression fixture",
    daily.principalAmountRaw === EXACT_PRINCIPAL_RAW,
    { principalAmountRaw: daily.principalAmountRaw }
  );
  verify(
    "live wallet has complete nonzero earned history",
    (payload.freshness === "fresh" || payload.freshness === "stale") &&
      payload.outcome === "ready" &&
      payload.principalMatchesHistory &&
      payload.coverage.missingReserves.length === 0 &&
      payload.ranges.ALL.lifetimeEarnedUsd > 13 &&
      payload.ranges.ALL.sinceLastDepositEarnedUsd > 5 &&
      daily.currentApyBps !== null &&
      daily.bars.some(
        (bar) => bar.startAt.startsWith("2026-06-28") && bar.earnedUsd > 0
      ),
    {
      currentApyBps: daily.currentApyBps,
      eventCount: payload.coverage.eventCount,
      freshness: payload.freshness,
      lifetimeEarnedUsd: payload.ranges.ALL.lifetimeEarnedUsd,
      reserveCount: payload.coverage.reserveCount,
      sampleCount: payload.coverage.sampleCount,
      sinceLastDepositEarnedUsd: payload.ranges.ALL.sinceLastDepositEarnedUsd,
    }
  );

  const timescaleDatabaseUrl = process.env.TIMESCALEDB_URL;
  process.env.TIMESCALEDB_URL =
    "postgres://unavailable:unavailable@127.0.0.1:1/unavailable";
  try {
    const persistedFallback = await readEarnEarningsRangeSet({
      cluster:
        process.env.NEXT_PUBLIC_SOLANA_ENV === "devnet"
          ? "devnet"
          : "mainnet-beta",
      settings: position.settings,
      timezone: "America/Los_Angeles",
      vaultIndex: 1,
      walletAddress: EXACT_WALLET,
    });
    verify(
      "live persisted snapshot survives controlled Timescale failure",
      persistedFallback.freshness === "stale" &&
        persistedFallback.staleReason === "dependency_unavailable" &&
        persistedFallback.ranges.ALL.lifetimeEarnedUsd ===
          payload.ranges.ALL.lifetimeEarnedUsd,
      {
        freshness: persistedFallback.freshness,
        snapshotAgeMs: persistedFallback.snapshotAgeMs,
        staleReason: persistedFallback.staleReason,
      }
    );
  } finally {
    process.env.TIMESCALEDB_URL = timescaleDatabaseUrl;
  }
}

await verifyFixtures();
if (process.argv.includes("--live")) {
  await verifyLiveWallet();
}

console.log(JSON.stringify({ overall: "PASS", results }, null, 2));
