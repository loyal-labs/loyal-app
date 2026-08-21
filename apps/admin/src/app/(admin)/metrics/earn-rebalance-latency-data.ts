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
  liquidityMint: string | null;
  sourceReserve: string;
  submittedAt: string;
  submittedToConfirmedMs: number;
  targetObservedAt: string;
  targetReserve: string;
};

export type EarnLatencyChartPoint = {
  bucketStartedAt: string;
  decisionToSignedMs: number | null;
  monitorToSubmittedMs: number | null;
  observedToOpportunityMs: number | null;
  opportunityToReadyMs: number | null;
  readyToDecisionMs: number | null;
  sampleCount: number;
  signedToSubmittedMs: number | null;
  submittedToConfirmedMs: number | null;
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
  latestPoints: EarnLatencyPoint[];
  points: EarnLatencyChartPoint[];
  rangeEndedAt: string | null;
  rangeStartedAt: string | null;
  stages: EarnLatencyStageSummary[];
  status: "available" | "unavailable";
  submittedToConfirmedP50Ms: number;
  submittedToConfirmedP95Ms: number;
  totalConfirmed: number;
};

type EarnLatencySqlDetail = {
  confirmed_at: Date | string;
  decision_at: Date | string;
  decision_to_signed_ms: SqlScalar;
  id: string;
  liquidity_mint: string | null;
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
};

type EarnLatencySqlChartPoint = {
  bucket_started_at: Date | string;
  decision_to_signed_ms: SqlScalar;
  monitor_to_submitted_ms: SqlScalar;
  observed_to_opportunity_ms: SqlScalar;
  opportunity_to_ready_ms: SqlScalar;
  ready_to_decision_ms: SqlScalar;
  sample_count: SqlScalar;
  signed_to_submitted_ms: SqlScalar;
  submitted_to_confirmed_ms: SqlScalar;
};

type EarnLatencySqlStage = {
  key: EarnLatencyStageKey;
  label: string;
  measured_count: SqlScalar;
  p50_ms: SqlScalar;
  p95_ms: SqlScalar;
};

type EarnLatencySqlRow = {
  chart_points: EarnLatencySqlChartPoint[] | null;
  latest_points: EarnLatencySqlDetail[] | null;
  measured_count: SqlScalar;
  monitor_to_submitted_p50_ms: SqlScalar;
  monitor_to_submitted_p95_ms: SqlScalar;
  range_ended_at: Date | string | null;
  range_started_at: Date | string | null;
  stages: EarnLatencySqlStage[] | null;
  submitted_to_confirmed_p50_ms: SqlScalar;
  submitted_to_confirmed_p95_ms: SqlScalar;
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
        decision.liquidity_mint,
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
    ),
    measured AS MATERIALIZED (
      SELECT
        valid.*,
        ROUND(EXTRACT(epoch FROM (
          valid.opportunity_at - valid.target_observed_at
        ))::numeric * 1000)::bigint AS observed_to_opportunity_ms,
      CASE
        WHEN valid.ready_at >= valid.opportunity_at
          AND valid.ready_at <= valid.decision_at
          THEN ROUND(EXTRACT(epoch FROM (
            valid.ready_at - valid.opportunity_at
          ))::numeric * 1000)::bigint
      END AS opportunity_to_ready_ms,
      CASE
        WHEN valid.ready_at >= valid.opportunity_at
          AND valid.ready_at <= valid.decision_at
          THEN ROUND(EXTRACT(epoch FROM (
            valid.decision_at - valid.ready_at
          ))::numeric * 1000)::bigint
      END AS ready_to_decision_ms,
      ROUND(EXTRACT(epoch FROM (
        valid.signed_at - valid.decision_at
        ))::numeric * 1000)::bigint AS decision_to_signed_ms,
      ROUND(EXTRACT(epoch FROM (
        valid.submitted_at - valid.signed_at
        ))::numeric * 1000)::bigint AS signed_to_submitted_ms,
      ROUND(EXTRACT(epoch FROM (
        valid.confirmed_at - valid.submitted_at
        ))::numeric * 1000)::bigint AS submitted_to_confirmed_ms,
      ROUND(EXTRACT(epoch FROM (
        valid.submitted_at - valid.target_observed_at
        ))::numeric * 1000)::bigint AS monitor_to_submitted_ms_number
      FROM valid
    ),
    summary AS (
      SELECT
        COUNT(*)::integer AS measured_count,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY monitor_to_submitted_ms_number
        ) AS monitor_to_submitted_p50_ms,
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY monitor_to_submitted_ms_number
        ) AS monitor_to_submitted_p95_ms,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY submitted_to_confirmed_ms
        ) AS submitted_to_confirmed_p50_ms,
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY submitted_to_confirmed_ms
        ) AS submitted_to_confirmed_p95_ms,
        MIN(submitted_at) AS range_started_at,
        MAX(submitted_at) AS range_ended_at
      FROM measured
    ),
    stage_summaries AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'key', stage.key,
          'label', stage.label,
          'measured_count', stage.measured_count,
          'p50_ms', stage.p50_ms,
          'p95_ms', stage.p95_ms
        )
        ORDER BY stage.position
      ) AS stages
      FROM (
        SELECT
          1 AS position,
          'observedToOpportunityMs'::text AS key,
          'Observed → opportunity'::text AS label,
          COUNT(measured.observed_to_opportunity_ms)::integer AS measured_count,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY measured.observed_to_opportunity_ms
          ) AS p50_ms,
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY measured.observed_to_opportunity_ms
          ) AS p95_ms
        FROM measured

        UNION ALL

        SELECT
          2,
          'opportunityToReadyMs',
          'Opportunity → ready',
          COUNT(measured.opportunity_to_ready_ms)::integer,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY measured.opportunity_to_ready_ms
          ),
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY measured.opportunity_to_ready_ms
          )
        FROM measured

        UNION ALL

        SELECT
          3,
          'readyToDecisionMs',
          'Ready → decision',
          COUNT(measured.ready_to_decision_ms)::integer,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY measured.ready_to_decision_ms
          ),
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY measured.ready_to_decision_ms
          )
        FROM measured

        UNION ALL

        SELECT
          4,
          'decisionToSignedMs',
          'Decision → signed',
          COUNT(measured.decision_to_signed_ms)::integer,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY measured.decision_to_signed_ms
          ),
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY measured.decision_to_signed_ms
          )
        FROM measured

        UNION ALL

        SELECT
          5,
          'signedToSubmittedMs',
          'Signed → submitted',
          COUNT(measured.signed_to_submitted_ms)::integer,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY measured.signed_to_submitted_ms
          ),
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY measured.signed_to_submitted_ms
          )
        FROM measured

        UNION ALL

        SELECT
          6,
          'submittedToConfirmedMs',
          'Submitted → confirmed',
          COUNT(measured.submitted_to_confirmed_ms)::integer,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY measured.submitted_to_confirmed_ms
          ),
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY measured.submitted_to_confirmed_ms
          )
        FROM measured
      ) AS stage
    ),
    chart_points AS (
      SELECT
        date_bin(
          interval '1 day',
          measured.submitted_at,
          timestamptz '1970-01-01 00:00:00+00'
        ) AS bucket_started_at,
        COUNT(*)::integer AS sample_count,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY measured.monitor_to_submitted_ms_number
        ) AS monitor_to_submitted_ms,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY measured.observed_to_opportunity_ms
        ) AS observed_to_opportunity_ms,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY measured.opportunity_to_ready_ms
        ) AS opportunity_to_ready_ms,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY measured.ready_to_decision_ms
        ) AS ready_to_decision_ms,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY measured.decision_to_signed_ms
        ) AS decision_to_signed_ms,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY measured.signed_to_submitted_ms
        ) AS signed_to_submitted_ms,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY measured.submitted_to_confirmed_ms
        ) AS submitted_to_confirmed_ms
      FROM measured
      GROUP BY 1
    ),
    latest_points AS (
      SELECT measured.*
      FROM measured
      ORDER BY measured.submitted_at DESC, measured.id DESC
      LIMIT 50
    ),
    total_confirmed AS (
      SELECT COUNT(*)::integer AS total_confirmed
        FROM loyal_yield.rebalance_decisions AS total
        WHERE total.status = 'confirmed'
          AND total.source_reserve IS NOT NULL
          AND total.target_reserve IS NOT NULL
    )
    SELECT
      summary.measured_count,
      summary.monitor_to_submitted_p50_ms,
      summary.monitor_to_submitted_p95_ms,
      summary.range_started_at,
      summary.range_ended_at,
      summary.submitted_to_confirmed_p50_ms,
      summary.submitted_to_confirmed_p95_ms,
      total_confirmed.total_confirmed,
      stage_summaries.stages,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'bucket_started_at', chart.bucket_started_at,
              'decision_to_signed_ms', chart.decision_to_signed_ms,
              'monitor_to_submitted_ms', chart.monitor_to_submitted_ms,
              'observed_to_opportunity_ms', chart.observed_to_opportunity_ms,
              'opportunity_to_ready_ms', chart.opportunity_to_ready_ms,
              'ready_to_decision_ms', chart.ready_to_decision_ms,
              'sample_count', chart.sample_count,
              'signed_to_submitted_ms', chart.signed_to_submitted_ms,
              'submitted_to_confirmed_ms', chart.submitted_to_confirmed_ms
            )
            ORDER BY chart.bucket_started_at
          )
          FROM chart_points AS chart
        ),
        '[]'::jsonb
      ) AS chart_points,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'confirmed_at', latest.confirmed_at,
              'decision_at', latest.decision_at,
              'decision_to_signed_ms', latest.decision_to_signed_ms,
              'id', latest.id::text,
              'liquidity_mint', latest.liquidity_mint,
              'monitor_to_submitted_ms', latest.monitor_to_submitted_ms_number,
              'observed_to_opportunity_ms', latest.observed_to_opportunity_ms,
              'opportunity_at', latest.opportunity_at,
              'opportunity_to_ready_ms', latest.opportunity_to_ready_ms,
              'ready_at', latest.ready_at,
              'ready_to_decision_ms', latest.ready_to_decision_ms,
              'signed_at', latest.signed_at,
              'signed_to_submitted_ms', latest.signed_to_submitted_ms,
              'source_reserve', latest.source_reserve,
              'submitted_at', latest.submitted_at,
              'submitted_to_confirmed_ms', latest.submitted_to_confirmed_ms,
              'target_observed_at', latest.target_observed_at,
              'target_reserve', latest.target_reserve
            )
            ORDER BY latest.submitted_at DESC, latest.id DESC
          )
          FROM latest_points AS latest
        ),
        '[]'::jsonb
      ) AS latest_points
    FROM summary
    CROSS JOIN stage_summaries
    CROSS JOIN total_confirmed
  `)) as unknown as EarnLatencySqlRow[];

  const row = rows[0];
  const latestPoints = (row?.latest_points ?? []).map(
    (point): EarnLatencyPoint => ({
      confirmedAt: toIsoString(point.confirmed_at) ?? "",
      decisionAt: toIsoString(point.decision_at) ?? "",
      decisionId: point.id,
      decisionToSignedMs: toNumber(point.decision_to_signed_ms),
      monitorToSubmittedMs: toNumber(point.monitor_to_submitted_ms),
      observedToOpportunityMs: toNumber(point.observed_to_opportunity_ms),
      opportunityAt: toIsoString(point.opportunity_at) ?? "",
      opportunityToReadyMs: toNullableNumber(point.opportunity_to_ready_ms),
      readyAt: toIsoString(point.ready_at),
      readyToDecisionMs: toNullableNumber(point.ready_to_decision_ms),
      signedAt: toIsoString(point.signed_at) ?? "",
      signedToSubmittedMs: toNumber(point.signed_to_submitted_ms),
      liquidityMint: point.liquidity_mint,
      sourceReserve: point.source_reserve,
      submittedAt: toIsoString(point.submitted_at) ?? "",
      submittedToConfirmedMs: toNumber(point.submitted_to_confirmed_ms),
      targetObservedAt: toIsoString(point.target_observed_at) ?? "",
      targetReserve: point.target_reserve,
    })
  );
  const points = (row?.chart_points ?? []).map(
    (point): EarnLatencyChartPoint => ({
      bucketStartedAt: toIsoString(point.bucket_started_at) ?? "",
      decisionToSignedMs: toNullableNumber(point.decision_to_signed_ms),
      monitorToSubmittedMs: toNullableNumber(point.monitor_to_submitted_ms),
      observedToOpportunityMs: toNullableNumber(
        point.observed_to_opportunity_ms
      ),
      opportunityToReadyMs: toNullableNumber(point.opportunity_to_ready_ms),
      readyToDecisionMs: toNullableNumber(point.ready_to_decision_ms),
      sampleCount: toNumber(point.sample_count),
      signedToSubmittedMs: toNullableNumber(point.signed_to_submitted_ms),
      submittedToConfirmedMs: toNullableNumber(point.submitted_to_confirmed_ms),
    })
  );

  return {
    fetchedAt: new Date().toISOString(),
    measuredCount: toNumber(row?.measured_count ?? null),
    monitorToSubmittedP50Ms: toNumber(row?.monitor_to_submitted_p50_ms ?? null),
    monitorToSubmittedP95Ms: toNumber(row?.monitor_to_submitted_p95_ms ?? null),
    latestPoints,
    points,
    rangeEndedAt: toIsoString(row?.range_ended_at ?? null),
    rangeStartedAt: toIsoString(row?.range_started_at ?? null),
    stages: (row?.stages ?? []).map((stage) => ({
      key: stage.key,
      label: stage.label,
      measuredCount: toNumber(stage.measured_count),
      p50Ms: toNumber(stage.p50_ms),
      p95Ms: toNumber(stage.p95_ms),
    })),
    status: "available",
    submittedToConfirmedP50Ms: toNumber(
      row?.submitted_to_confirmed_p50_ms ?? null
    ),
    submittedToConfirmedP95Ms: toNumber(
      row?.submitted_to_confirmed_p95_ms ?? null
    ),
    totalConfirmed: toNumber(row?.total_confirmed ?? null),
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
      latestPoints: [],
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
