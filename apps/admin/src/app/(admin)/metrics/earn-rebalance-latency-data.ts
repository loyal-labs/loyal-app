import "server-only";

import { unstable_cache } from "next/cache";

import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";
import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

type SqlScalar = bigint | number | string | null;

export type EarnLatencyStageKey =
  | "observedToOpportunityMs"
  | "opportunityToReadyMs"
  | "readyToDecisionMs"
  | "decisionToSignedMs"
  | "signedToSubmittedMs"
  | "submittedToConfirmedMs";

export type EarnLatencyPoint = {
  confirmedAt: string;
  decisionAt: string;
  decisionId: string;
  decisionToSignedMs: number;
  monitorToSubmittedMs: number;
  observedToOpportunityMs: number;
  opportunityAt: string;
  opportunityToReadyMs: number | null;
  readyAt: string | null;
  readyToDecisionMs: number | null;
  signedAt: string;
  signedToSubmittedMs: number;
  sourceReserve: string;
  submittedAt: string;
  submittedToConfirmedMs: number;
  targetObservedAt: string;
  targetReserve: string;
};

export type EarnLatencyStageSummary = {
  key: EarnLatencyStageKey;
  label: string;
  measuredCount: number;
  p50Ms: number;
  p95Ms: number;
};

export type EarnRebalanceLatencyData = {
  fetchedAt: string;
  measuredCount: number;
  monitorToSubmittedP50Ms: number;
  monitorToSubmittedP95Ms: number;
  points: EarnLatencyPoint[];
  rangeEndedAt: string | null;
  rangeStartedAt: string | null;
  stages: EarnLatencyStageSummary[];
  status: "available" | "unavailable";
  submittedToConfirmedP50Ms: number;
  submittedToConfirmedP95Ms: number;
  totalConfirmed: number;
};

type EarnLatencySqlRow = {
  confirmed_at: Date | string;
  decision_at: Date | string;
  decision_to_signed_ms: SqlScalar;
  id: string;
  monitor_to_submitted_ms: SqlScalar;
  observed_to_opportunity_ms: SqlScalar;
  opportunity_at: Date | string;
  opportunity_to_ready_ms: SqlScalar;
  ready_at: Date | string | null;
  ready_to_decision_ms: SqlScalar;
  signed_at: Date | string;
  signed_to_submitted_ms: SqlScalar;
  source_reserve: string;
  submitted_at: Date | string;
  submitted_to_confirmed_ms: SqlScalar;
  target_observed_at: Date | string;
  target_reserve: string;
  total_confirmed: SqlScalar;
};

const STAGES: ReadonlyArray<{
  key: EarnLatencyStageKey;
  label: string;
}> = [
  {
    key: "observedToOpportunityMs",
    label: "Observed → opportunity",
  },
  {
    key: "opportunityToReadyMs",
    label: "Opportunity → ready",
  },
  { key: "readyToDecisionMs", label: "Ready → decision" },
  { key: "decisionToSignedMs", label: "Decision → signed" },
  { key: "signedToSubmittedMs", label: "Signed → submitted" },
  {
    key: "submittedToConfirmedMs",
    label: "Submitted → confirmed",
  },
];

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toNumber(value: SqlScalar): number {
  if (value === null) {
    return 0;
  }
  return Number(value);
}

function toNullableNumber(value: SqlScalar): number | null {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentile(values: readonly number[], level: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * level;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  return lower + (upper - lower) * (position - lowerIndex);
}

function summarize(
  points: EarnLatencyPoint[],
  key: EarnLatencyStageKey,
  label: string
): EarnLatencyStageSummary {
  const values = points.flatMap((point) => {
    const value = point[key];
    return typeof value === "number" ? [value] : [];
  });

  return {
    key,
    label,
    measuredCount: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

async function loadEarnRebalanceLatencyData(): Promise<EarnRebalanceLatencyData> {
  const rows = (await getYieldNeonSql().query(`
    WITH first_submission AS MATERIALIZED (
      SELECT
        submission.decision_id,
        MIN(submission.created_at) AS signed_at,
        MIN(submission.submitted_at) FILTER (
          WHERE submission.submitted_at IS NOT NULL
        ) AS submitted_at,
        MIN(submission.confirmed_at) FILTER (
          WHERE submission.confirmed_at IS NOT NULL
        ) AS confirmed_at
      FROM loyal_yield.signed_route_submissions AS submission
      WHERE submission.decision_id IS NOT NULL
      GROUP BY submission.decision_id
    ),
    linked AS MATERIALIZED (
      SELECT
        decision.id,
        decision.source_reserve,
        decision.target_reserve,
        opportunity.created_at AS opportunity_at,
        opportunity.ready_at,
        decision.created_at AS decision_at,
        first_submission.signed_at,
        first_submission.submitted_at,
        first_submission.confirmed_at,
        target_reserve.observed_at AS target_observed_at
      FROM loyal_yield.rebalance_decisions AS decision
      INNER JOIN loyal_yield.rebalance_opportunities AS opportunity
        ON opportunity.decision_id = decision.id
      INNER JOIN loyal_yield.optimizer_epochs AS epoch
        ON epoch.id = opportunity.optimizer_epoch_id
      INNER JOIN LATERAL (
        SELECT (reserve.value->>'observedAt')::timestamptz AS observed_at
        FROM jsonb_array_elements(epoch.market_state->'reserves') AS reserve(value)
        WHERE reserve.value->>'reserve' = decision.target_reserve
          AND reserve.value->>'observedAt' IS NOT NULL
        LIMIT 1
      ) AS target_reserve ON true
      INNER JOIN first_submission
        ON first_submission.decision_id = decision.id
      WHERE decision.status = 'confirmed'
        AND decision.source_reserve IS NOT NULL
        AND decision.target_reserve IS NOT NULL
    ),
    valid AS MATERIALIZED (
      SELECT *
      FROM linked
      WHERE target_observed_at <= opportunity_at
        AND opportunity_at <= decision_at
        AND decision_at <= signed_at
        AND signed_at <= submitted_at
        AND submitted_at <= confirmed_at
    )
    SELECT
      valid.id::text,
      valid.source_reserve,
      valid.target_reserve,
      valid.target_observed_at,
      valid.opportunity_at,
      valid.ready_at,
      valid.decision_at,
      valid.signed_at,
      valid.submitted_at,
      valid.confirmed_at,
      ROUND(EXTRACT(epoch FROM (
        valid.opportunity_at - valid.target_observed_at
      ))::numeric * 1000)::bigint::text AS observed_to_opportunity_ms,
      CASE
        WHEN valid.ready_at >= valid.opportunity_at
          AND valid.ready_at <= valid.decision_at
          THEN ROUND(EXTRACT(epoch FROM (
            valid.ready_at - valid.opportunity_at
          ))::numeric * 1000)::bigint::text
      END AS opportunity_to_ready_ms,
      CASE
        WHEN valid.ready_at >= valid.opportunity_at
          AND valid.ready_at <= valid.decision_at
          THEN ROUND(EXTRACT(epoch FROM (
            valid.decision_at - valid.ready_at
          ))::numeric * 1000)::bigint::text
      END AS ready_to_decision_ms,
      ROUND(EXTRACT(epoch FROM (
        valid.signed_at - valid.decision_at
      ))::numeric * 1000)::bigint::text AS decision_to_signed_ms,
      ROUND(EXTRACT(epoch FROM (
        valid.submitted_at - valid.signed_at
      ))::numeric * 1000)::bigint::text AS signed_to_submitted_ms,
      ROUND(EXTRACT(epoch FROM (
        valid.confirmed_at - valid.submitted_at
      ))::numeric * 1000)::bigint::text AS submitted_to_confirmed_ms,
      ROUND(EXTRACT(epoch FROM (
        valid.submitted_at - valid.target_observed_at
      ))::numeric * 1000)::bigint::text AS monitor_to_submitted_ms,
      (
        SELECT COUNT(*)::integer
        FROM loyal_yield.rebalance_decisions AS total
        WHERE total.status = 'confirmed'
          AND total.source_reserve IS NOT NULL
          AND total.target_reserve IS NOT NULL
      )::text AS total_confirmed
    FROM valid
    ORDER BY valid.submitted_at ASC, valid.id ASC
  `)) as unknown as EarnLatencySqlRow[];

  const points = rows.map(
    (row): EarnLatencyPoint => ({
      confirmedAt: toIsoString(row.confirmed_at) ?? "",
      decisionAt: toIsoString(row.decision_at) ?? "",
      decisionId: row.id,
      decisionToSignedMs: toNumber(row.decision_to_signed_ms),
      monitorToSubmittedMs: toNumber(row.monitor_to_submitted_ms),
      observedToOpportunityMs: toNumber(row.observed_to_opportunity_ms),
      opportunityAt: toIsoString(row.opportunity_at) ?? "",
      opportunityToReadyMs: toNullableNumber(row.opportunity_to_ready_ms),
      readyAt: toIsoString(row.ready_at),
      readyToDecisionMs: toNullableNumber(row.ready_to_decision_ms),
      signedAt: toIsoString(row.signed_at) ?? "",
      signedToSubmittedMs: toNumber(row.signed_to_submitted_ms),
      sourceReserve: row.source_reserve,
      submittedAt: toIsoString(row.submitted_at) ?? "",
      submittedToConfirmedMs: toNumber(row.submitted_to_confirmed_ms),
      targetObservedAt: toIsoString(row.target_observed_at) ?? "",
      targetReserve: row.target_reserve,
    })
  );
  const monitorToSubmitted = points.map((point) => point.monitorToSubmittedMs);
  const submittedToConfirmed = points.map(
    (point) => point.submittedToConfirmedMs
  );

  return {
    fetchedAt: new Date().toISOString(),
    measuredCount: points.length,
    monitorToSubmittedP50Ms: percentile(monitorToSubmitted, 0.5),
    monitorToSubmittedP95Ms: percentile(monitorToSubmitted, 0.95),
    points,
    rangeEndedAt: points.at(-1)?.submittedAt ?? null,
    rangeStartedAt: points[0]?.submittedAt ?? null,
    stages: STAGES.map(({ key, label }) => summarize(points, key, label)),
    status: "available",
    submittedToConfirmedP50Ms: percentile(submittedToConfirmed, 0.5),
    submittedToConfirmedP95Ms: percentile(submittedToConfirmed, 0.95),
    totalConfirmed: rows.length > 0 ? toNumber(rows[0].total_confirmed) : 0,
  };
}

const getCachedEarnRebalanceLatencyData = unstable_cache(
  loadEarnRebalanceLatencyData,
  ["earn-rebalance-latency"],
  { revalidate: DATA_CACHE_TTL_SECONDS }
);

export async function getEarnRebalanceLatencyData(): Promise<EarnRebalanceLatencyData> {
  try {
    return await getCachedEarnRebalanceLatencyData();
  } catch (error) {
    console.error("Earn rebalance latency query failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown database error",
      errorName: error instanceof Error ? error.name : "Error",
    });

    return {
      fetchedAt: new Date().toISOString(),
      measuredCount: 0,
      monitorToSubmittedP50Ms: 0,
      monitorToSubmittedP95Ms: 0,
      points: [],
      rangeEndedAt: null,
      rangeStartedAt: null,
      stages: STAGES.map(({ key, label }) => ({
        key,
        label,
        measuredCount: 0,
        p50Ms: 0,
        p95Ms: 0,
      })),
      status: "unavailable",
      submittedToConfirmedP50Ms: 0,
      submittedToConfirmedP95Ms: 0,
      totalConfirmed: 0,
    };
  }
}
