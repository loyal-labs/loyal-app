import { NextResponse } from "next/server";

import {
  getCurrentSafeReserveApyStatuses,
  getKaminoTimescaleDb,
  getSafeReserveApyMonitorDataFromStatuses,
} from "@/lib/kamino/timescale-reserve-client.server";
import type { SafeReserveApyMonitorData } from "@/lib/kamino/timescale-reserve-monitor.shared";
import { requireAdminSession } from "@/lib/require-admin-session";
import {
  EARN_STABLECOIN_DESCRIPTORS,
  STABLECOIN_DECIMALS,
} from "@/lib/earn/stablecoin-monitor.shared";

import {
  getActiveReserveRoutes,
  getAutodepositTimeSeries,
  getEarnVaultRebalanceFrequency,
  getExecutedEarnRebalanceHistory,
  getLast30DaysRebalanceSeries,
  getRebalanceAuditActivePage,
  getRebalanceAuditPage,
  getRebalanceAuditSummary,
  getRebalanceActivity,
  getRecentRebalanceDecisions,
} from "../../../(admin)/earn/rebalance/rebalance-data";
import { computeRebalanceEligibilityFloorRaw } from "../../../(admin)/earn/rebalance/earn-vault-rebalance-eligibility";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function serializeApyData(data: SafeReserveApyMonitorData) {
  const bucketMs = 30 * 60 * 1_000;
  const windowStartedAtMs = Date.parse(data.window.startedAt);
  const buckets = new Map<number, Array<number[]>>();

  for (const point of data.chartPoints) {
    const bucketTime =
      windowStartedAtMs +
      Math.floor((point.observedAtMs - windowStartedAtMs) / bucketMs) *
        bucketMs;
    const bucket =
      buckets.get(bucketTime) ?? data.series.map(() => new Array<number>());

    for (const [seriesIndex, series] of data.series.entries()) {
      const value = point[series.key];
      if (typeof value === "number" && Number.isFinite(value)) {
        bucket[seriesIndex]?.push(value);
      }
    }
    buckets.set(bucketTime, bucket);
  }

  const orderedBuckets = [...buckets.entries()].sort(
    ([left], [right]) => left - right
  );
  const median = (values: number[]) => {
    if (values.length === 0) {
      return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.round((sorted.length - 1) * 0.5)] ?? null;
  };

  return {
    generatedAt: data.generatedAt,
    sampleIntervalMinutes: 30,
    series: data.series,
    statuses: data.statuses,
    values: data.series.map((_series, seriesIndex) =>
      orderedBuckets.map(([, bucket]) => {
        const value = median(bucket[seriesIndex] ?? []);
        return value === null
          ? null
          : Math.round(value * 1_000_000) / 1_000_000;
      })
    ),
    observedAtMs: orderedBuckets.map(([observedAtMs]) => observedAtMs),
    window: data.window,
  };
}

function serializeOverviewData(
  statuses: Awaited<ReturnType<typeof getCurrentSafeReserveApyStatuses>>,
  routes: Awaited<ReturnType<typeof getActiveReserveRoutes>>,
  decisions: Awaited<ReturnType<typeof getRecentRebalanceDecisions>>,
  eligibilityFloorRaw: bigint | null
) {
  return {
    decisions: decisions.map((decision) => ({
      ...decision,
      amountRaw: decision.amountRaw?.toString() ?? null,
      confirmedSlot: decision.confirmedSlot?.toString() ?? null,
    })),
    eligibilityFloorRaw: eligibilityFloorRaw?.toString() ?? null,
    routes: routes.map((route) => ({
      ...route,
      activeAumRaw: route.activeAumRaw.toString(),
    })),
    statuses,
  };
}

type CurrentSafeReserveStatuses = Awaited<
  ReturnType<typeof getCurrentSafeReserveApyStatuses>
>;

function getDefaultEligibilityFloorRaw(statuses: CurrentSafeReserveStatuses) {
  const defaultMint = EARN_STABLECOIN_DESCRIPTORS.find(
    (descriptor) => descriptor.symbol === "USDC"
  )?.mint;

  return computeRebalanceEligibilityFloorRaw(
    statuses.filter((status) => status.liquidityMint === defaultMint),
    STABLECOIN_DECIMALS
  );
}

async function loadRebalanceOverviewData(
  statusesPromise: Promise<
    Awaited<ReturnType<typeof getCurrentSafeReserveApyStatuses>>
  > = getCurrentSafeReserveApyStatuses(getKaminoTimescaleDb())
) {
  const [statuses, routes, decisions] = await Promise.all([
    statusesPromise,
    getActiveReserveRoutes(),
    getRecentRebalanceDecisions(),
  ]);

  return serializeOverviewData(
    statuses,
    routes,
    decisions,
    getDefaultEligibilityFloorRaw(statuses)
  );
}

async function loadRebalanceApyHistoryData(
  statuses: Awaited<ReturnType<typeof getCurrentSafeReserveApyStatuses>>
) {
  return {
    apyData: serializeApyData(
      await getSafeReserveApyMonitorDataFromStatuses(statuses)
    ),
  };
}

async function loadRebalanceOperationsData() {
  const [activity, last30DaysRebalances, autodeposit] = await Promise.all([
    getRebalanceActivity(),
    getLast30DaysRebalanceSeries(),
    getAutodepositTimeSeries(),
  ]);

  return {
    activity: activity.map((point) => ({
      ...point,
      maxSwapFeeLamports: point.maxSwapFeeLamports.toString(),
      swapFeeLamports: point.swapFeeLamports.toString(),
    })),
    autodeposit: autodeposit.map((range) => ({
      bucketHours: range.bucketHours,
      key: range.key,
      points: range.points.map((point) => ({
        accountNotFound: point.accountNotFound,
        bucketStartedAt: point.bucketStartedAt,
        confirmationOrTimeout: point.confirmationOrTimeout,
        insufficientRent: point.insufficientRent,
        missingTokenDelegate: point.missingTokenDelegate,
        noLinkedError: point.noLinkedError,
        otherPrePull: point.otherPrePull,
        postPullKaminoTopUp: point.postPullKaminoTopUp,
      })),
    })),
    last30DaysRebalances,
  };
}

async function loadExecutedRebalances() {
  try {
    const history = await getExecutedEarnRebalanceHistory({
      includeDetails: false,
    });
    const strings: string[] = [];
    const stringIndexes = new Map<string, number>();
    const stringIndex = (value: string | null) => {
      if (value === null) {
        return null;
      }
      const existing = stringIndexes.get(value);
      if (existing !== undefined) {
        return existing;
      }
      const index = strings.length;
      strings.push(value);
      stringIndexes.set(value, index);
      return index;
    };
    const serialize = (execution: (typeof history.chartPoints)[number]) =>
      [
        execution.amountRaw.toString(),
        stringIndex(execution.authority)!,
        execution.confirmedSlot.toString(),
        execution.currentDepositRaw.toString(),
        execution.executedAt,
        execution.id,
        stringIndex(execution.liquidityMint),
        execution.routeMode,
        stringIndex(execution.sourceReserve)!,
        stringIndex(execution.sourceLiquidityMint),
        execution.swapFeeLamports.toString(),
        stringIndex(execution.targetReserve)!,
        stringIndex(execution.targetLiquidityMint),
        execution.userRank,
      ] as const;

    return {
      ...history,
      status: "available" as const,
      chartPoints: history.chartPoints.map(serialize),
      details: history.details.map(serialize),
      strings,
      summaries: history.summaries.map((summary) => ({
        ...summary,
        swapFeeLamports: summary.swapFeeLamports.toString(),
      })),
    };
  } catch (error) {
    console.error("Executed Earn rebalance history query failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown database error",
      errorName: error instanceof Error ? error.name : "Error",
    });

    return {
      chartPoints: [],
      details: [],
      generatedAt: new Date().toISOString(),
      status: "unavailable" as const,
      strings: [],
      summaries: [],
    };
  }
}

async function loadRebalanceExecutionsData() {
  return {
    executedRebalances: await loadExecutedRebalances(),
  };
}

async function loadVaultRebalanceFrequency(eligibilityFloorRaw: bigint | null) {
  try {
    const frequency = await getEarnVaultRebalanceFrequency({
      eligibilityFloorRaw,
      includeDetails: false,
    });

    return {
      ...frequency,
      status: "available" as const,
      chartPoints: frequency.chartPoints.map(serializeVaultFrequency),
      details: frequency.details.map(serializeVaultFrequency),
    };
  } catch (error) {
    console.error("Earn vault rebalance frequency query failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown database error",
      errorName: error instanceof Error ? error.name : "Error",
    });

    return {
      generatedAt: new Date().toISOString(),
      status: "unavailable" as const,
      chartPoints: [],
      details: [],
      summaries: [],
      vaultCount: 0,
    };
  }
}

async function loadRebalanceFrequencyData(
  statusesPromise?: Promise<CurrentSafeReserveStatuses>,
  suppliedEligibilityFloorRaw?: bigint | null
) {
  const eligibilityFloorRaw =
    suppliedEligibilityFloorRaw === undefined
      ? getDefaultEligibilityFloorRaw(
          await (statusesPromise ??
            getCurrentSafeReserveApyStatuses(getKaminoTimescaleDb()))
        )
      : suppliedEligibilityFloorRaw;

  return {
    vaultRebalanceFrequency: await loadVaultRebalanceFrequency(
      eligibilityFloorRaw
    ),
  };
}

function serializeVaultFrequency(
  vault: Awaited<
    ReturnType<typeof getEarnVaultRebalanceFrequency>
  >["chartPoints"][number]
) {
  return [
    vault.allCount,
    vault.currentDepositRaw.toString(),
    vault.currentReserve,
    vault.depositRank,
    vault.last12hCount,
    vault.last2hCount,
    vault.last7dCount,
    vault.liquidityMint,
    vault.positionCount,
    vault.routeMode,
    vault.vaultId,
    vault.vaultPubkey,
  ] as const;
}

async function loadInitialAudit() {
  const [summary, page, activePage] = await Promise.all([
    getRebalanceAuditSummary("24h", "same_mint"),
    getRebalanceAuditPage({
      errorFilter: "all",
      range: "24h",
      routeMode: "same_mint",
      view: "completed_rebalances",
    }),
    getRebalanceAuditActivePage({
      range: "24h",
      routeMode: "same_mint",
    }),
  ]);
  const serializePage = (auditPage: typeof page) => ({
    ...auditPage,
    rows: auditPage.rows.map((row) => ({
      ...row,
      amountRaw: row.amountRaw?.toString() ?? null,
      confirmedSlot: row.confirmedSlot?.toString() ?? null,
      submittedSlot: row.submittedSlot?.toString() ?? null,
    })),
  });

  return {
    activePage: serializePage(activePage),
    generatedAt: new Date().toISOString(),
    page: serializePage(page),
    summary,
  };
}

async function loadRebalancePageData() {
  const currentStatusesPromise = getCurrentSafeReserveApyStatuses(
    getKaminoTimescaleDb()
  );
  const overviewPromise = loadRebalanceOverviewData(currentStatusesPromise);
  const apyHistoryPromise = currentStatusesPromise.then(
    loadRebalanceApyHistoryData
  );
  const operationsPromise = loadRebalanceOperationsData();
  const executedRebalancesPromise = loadRebalanceExecutionsData();
  const initialAuditPromise = loadInitialAudit();
  const frequencyPromise = loadRebalanceFrequencyData(currentStatusesPromise);
  const [
    overview,
    apyHistory,
    operations,
    executions,
    frequency,
    initialAudit,
  ] = await Promise.all([
    overviewPromise,
    apyHistoryPromise,
    operationsPromise,
    executedRebalancesPromise,
    frequencyPromise,
    initialAuditPromise,
  ]);

  return {
    ...overview,
    ...apyHistory,
    ...operations,
    executedRebalances: executions.executedRebalances,
    initialAudit,
    vaultRebalanceFrequency: frequency.vaultRebalanceFrequency,
  };
}

export async function GET(request: Request) {
  await requireAdminSession();

  const section = new URL(request.url).searchParams.get("section");
  const headers = {
    "Cache-Control": "private, no-store",
  };

  if (section === "overview") {
    return NextResponse.json(await loadRebalanceOverviewData(), { headers });
  }

  if (section === "apy-history") {
    const rawStatuses = new URL(request.url).searchParams.get("statuses");
    if (!rawStatuses) {
      return NextResponse.json(
        { error: "statuses is required" },
        { headers, status: 400 }
      );
    }

    try {
      const statuses = JSON.parse(rawStatuses) as Awaited<
        ReturnType<typeof getCurrentSafeReserveApyStatuses>
      >;
      if (!Array.isArray(statuses)) {
        throw new Error("statuses must be an array");
      }
      return NextResponse.json(await loadRebalanceApyHistoryData(statuses), {
        headers,
      });
    } catch {
      return NextResponse.json(
        { error: "Invalid statuses payload" },
        { headers, status: 400 }
      );
    }
  }

  if (section === "operations") {
    return NextResponse.json(await loadRebalanceOperationsData(), { headers });
  }

  if (section === "executions") {
    return NextResponse.json(await loadRebalanceExecutionsData(), { headers });
  }

  if (section === "frequency") {
    const rawFloor = new URL(request.url).searchParams.get(
      "eligibilityFloorRaw"
    );
    if (rawFloor === null || (rawFloor !== "null" && !/^\d+$/.test(rawFloor))) {
      return NextResponse.json(
        { error: "eligibilityFloorRaw is required" },
        { headers, status: 400 }
      );
    }
    const eligibilityFloorRaw = rawFloor === "null" ? null : BigInt(rawFloor);
    return NextResponse.json(
      await loadRebalanceFrequencyData(undefined, eligibilityFloorRaw),
      { headers }
    );
  }

  if (section) {
    return NextResponse.json(
      { error: `Unknown rebalance section: ${section}` },
      { headers, status: 400 }
    );
  }

  return NextResponse.json(await loadRebalancePageData(), {
    headers,
  });
}
