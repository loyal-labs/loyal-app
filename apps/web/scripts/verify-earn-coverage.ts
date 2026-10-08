#!/usr/bin/env -S bun --conditions=react-server

import { createHash } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import {
  calculateEarnEarnings,
  type YieldPortfolioSnapshot,
} from "@/lib/yield-optimization/earnings-calculator.server";
import {
  createEarnEarningsReadDependencies,
  EarnEarningsUnavailableError,
  getPortfolioEarningsCoverage,
  normalizeEarningsPortfolioSnapshots,
  readEarnEarningsRangeSet,
} from "@/lib/yield-optimization/earnings-read-service.server";
import {
  getYieldOptimizationClient,
  userYieldPositions,
} from "@/lib/yield-optimization/yield-neon-client.server";

function verify(name: string, condition: boolean) {
  if (!condition) {
    throw new Error(`FAIL ${name}`);
  }
  console.log(JSON.stringify({ name, status: "PASS" }));
}

function verifyFixtures() {
  const start = new Date("2026-09-14T15:30:00.276Z");
  const end = new Date("2026-09-15T15:30:00.276Z");
  const exposure = {
    amountRaw: BigInt(100_000_000),
    kind: "kamino" as const,
    liquidityMint: "USDC",
    reserve: "reserve-a",
    sourceId: "reserve:reserve-a",
  };
  const snapshot = (at: string): YieldPortfolioSnapshot => ({
    exposures: [exposure],
    observedAt: new Date(at),
    observedSlot: BigInt(1),
  });
  const raw = [snapshot("2026-09-14T15:28:33.308Z")];
  const samples = [
    {
      observedAt: new Date("2026-09-14T15:28:37.077Z"),
      reserve: "reserve-a",
      supplyApy: 0.1,
    },
    { observedAt: end, reserve: "reserve-a", supplyApy: 0.1 },
  ];
  verify(
    "production mismatch fails before normalization",
    getPortfolioEarningsCoverage({
      apySamples: samples,
      now: end,
      snapshots: raw,
    }).missingReserves.length === 1
  );
  const snapshots = normalizeEarningsPortfolioSnapshots({
    snapshots: raw,
    start,
    end,
  });
  const coverage = getPortfolioEarningsCoverage({
    apySamples: samples,
    now: end,
    snapshots,
  });
  verify(
    "existing APY seed covers the actual earning interval",
    coverage.missingReserves.length === 0 &&
      coverage.gappedReserves.length === 0 &&
      coverage.staleReserves.length === 0
  );
  const events = [
    {
      amountRaw: exposure.amountRaw,
      confirmedAt: start,
      liquidityMint: "USDC",
      type: "deposit" as const,
    },
  ];
  for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
    const result = calculateEarnEarnings({
      apySamples: samples,
      events,
      now: end,
      portfolioSnapshots: snapshots,
      range: "30D",
      timezone,
    });
    verify(
      `daily bars and lifetime exclude pre-deposit earnings (${timezone})`,
      Math.abs(
        result.bars.reduce((sum, bar) => sum + bar.earnedUsd, 0) -
          result.lifetimeEarnedUsd
      ) < 1e-10 &&
        Math.abs(result.lifetimeEarnedUsd - (100 * 0.1) / 365) < 1e-10
    );
  }
  verify(
    "no seed remains missing history",
    getPortfolioEarningsCoverage({
      apySamples: samples.slice(1),
      now: end,
      snapshots,
    }).missingReserves.length === 1
  );
  const laterEnd = new Date(end.getTime() + 48 * 60 * 60 * 1000);
  const gapped = getPortfolioEarningsCoverage({
    apySamples: samples,
    now: laterEnd,
    snapshots,
  });
  verify(
    "real gaps and stale current APY remain rejected",
    gapped.gappedReserves.length === 1 && gapped.staleReserves.length === 1
  );
  const concurrent = [
    {
      ...snapshots[0],
      exposures: [
        exposure,
        { ...exposure, reserve: "reserve-b", sourceId: "reserve:reserve-b" },
      ],
    },
  ];
  verify(
    "every positive reserve requires coverage",
    getPortfolioEarningsCoverage({
      apySamples: samples,
      now: end,
      snapshots: concurrent,
    }).missingReserves.includes("reserve-b")
  );
  const idle = [
    {
      ...snapshots[0],
      exposures: [{ ...exposure, kind: "idle" as const, reserve: null }],
    },
  ];
  verify(
    "idle balances need no reserve APY",
    getPortfolioEarningsCoverage({ apySamples: [], now: end, snapshots: idle })
      .reserveCount === 0
  );
  const normalized = normalizeEarningsPortfolioSnapshots({
    snapshots: [
      ...raw,
      snapshot(start.toISOString()),
      snapshot("2026-09-15T12:00:00Z"),
      snapshot("2026-09-16T00:00:00Z"),
    ],
    start,
    end,
  });
  verify(
    "same-time seed and later transitions are retained, future snapshots excluded",
    normalized.length === 2 &&
      normalized[0].observedAt.getTime() === start.getTime()
  );
  verify(
    "a later first snapshot is not backdated",
    normalizeEarningsPortfolioSnapshots({
      snapshots: [snapshot("2026-09-15T12:00:00Z")],
      start,
      end,
    })[0].observedAt > start
  );
}

const POSITION_ID_PATTERN = /^\d+$/;

function flag(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function auditScope(
  input: Parameters<typeof readEarnEarningsRangeSet>[0],
  dependencies: ReturnType<typeof createEarnEarningsReadDependencies>
) {
  const observedAt = dependencies.now();
  const scopedDependencies = { ...dependencies, now: () => observedAt };
  try {
    const payload = await readEarnEarningsRangeSet(input, scopedDependencies);
    return {
      status: payload.freshness === "fresh" ? "fresh" : "stale",
      observedAt: observedAt.toISOString(),
      evidence: {
        coverage: payload.coverage,
        outcome: payload.outcome,
        historyRevision: payload.historyRevision,
      },
    };
  } catch (error) {
    if (error instanceof EarnEarningsUnavailableError) {
      return {
        observedAt: observedAt.toISOString(),
        status:
          error.detailCode === "earnings_unavailable"
            ? "dependency_failure"
            : error.detailCode,
        evidence: error.coverage,
      };
    }
    return {
      status: "dependency_failure",
      observedAt: observedAt.toISOString(),
      evidence: null,
    };
  }
}

async function verifyFleet() {
  const cluster = flag("--cluster");
  if (cluster !== "mainnet-beta" && cluster !== "devnet") {
    throw new Error(
      "Live verification requires --cluster mainnet-beta|devnet."
    );
  }
  let wallet = flag("--wallet");
  const client = getYieldOptimizationClient();
  const positionId = flag("--position-id");
  if (positionId) {
    if (!POSITION_ID_PATTERN.test(positionId)) {
      throw new Error("--position-id must be a positive integer.");
    }
    const position = await client.db.query.userYieldPositions.findFirst({
      where: eq(userYieldPositions.id, BigInt(positionId)),
    });
    if (!position) {
      throw new Error("Position not found.");
    }
    wallet = position.walletAddress;
  }
  const results = new Map<string, Awaited<ReturnType<typeof auditScope>>>();
  const startedAt = new Date();
  const dependencies = createEarnEarningsReadDependencies(true);
  const scopeId = (scope: {
    walletAddress: string;
    settings: string;
    vaultIndex: number;
  }) =>
    createHash("sha256")
      .update(
        `${cluster}:${scope.walletAddress}:${scope.settings}:${scope.vaultIndex}`
      )
      .digest("hex");
  const discoverScopes = () =>
    client.db
      .selectDistinct({
        walletAddress: userYieldPositions.walletAddress,
        settings: userYieldPositions.settings,
        vaultIndex: userYieldPositions.vaultIndex,
      })
      .from(userYieldPositions)
      .where(
        and(
          eq(userYieldPositions.status, "active"),
          eq(userYieldPositions.vaultIndex, 1),
          wallet ? eq(userYieldPositions.walletAddress, wallet) : undefined
        )
      )
      .orderBy(
        asc(userYieldPositions.walletAddress),
        asc(userYieldPositions.settings),
        asc(userYieldPositions.vaultIndex)
      );
  let scopes = await discoverScopes();
  if (scopes.length === 0) {
    throw new Error("No active Earn scopes matched the audit.");
  }
  const initialActiveScopeCount = scopes.length;
  while (true) {
    const pending = scopes.filter((scope) => !results.has(scopeId(scope)));
    if (pending.length === 0) {
      break;
    }
    for (let index = 0; index < pending.length; index += 2) {
      await Promise.all(
        pending.slice(index, index + 2).map(async (scope) => {
          const key = scopeId(scope);
          const input = { ...scope, cluster, timezone: "UTC" };
          const result = await auditScope(input, dependencies);
          results.set(key, result);
          console.log(
            JSON.stringify({
              scopeId: key,
              walletScope: `${scope.walletAddress.slice(0, 4)}…${scope.walletAddress.slice(-4)}`,
              ...result,
              completed: results.size,
            })
          );
        })
      );
    }
    // Refresh membership after each complete pass so an offset shift or a
    // newly activated scope cannot silently disappear from the final audit.
    scopes = await discoverScopes();
  }
  const counts: Record<string, number> = {};
  for (const scope of scopes) {
    const result = results.get(scopeId(scope));
    if (!result) {
      throw new Error("Active scope is missing a verification result.");
    }
    counts[result.status] = (counts[result.status] ?? 0) + 1;
  }
  const passed = (counts.fresh ?? 0) === scopes.length;
  console.log(
    JSON.stringify({
      overall: passed ? "PASS" : "FAIL",
      readOnly: true,
      cluster,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      initialActiveScopeCount,
      activeScopeCount: scopes.length,
      checked: results.size,
      activeScopesChecked: scopes.length,
      uncoveredActiveScopes: 0,
      activeScopeSetHash: createHash("sha256")
        .update(scopes.map(scopeId).sort().join("\n"))
        .digest("hex"),
      counts,
    })
  );
  if (!passed) {
    process.exitCode = 1;
  }
}

verifyFixtures();
if (
  process.argv.includes("--fleet") ||
  process.argv.includes("--wallet") ||
  process.argv.includes("--position-id")
) {
  await verifyFleet();
}
