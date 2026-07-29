import "server-only";

import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

type SqlScalar = string | number | bigint | null;

export type RebalanceAuditRange = "24h" | "7d" | "30d" | "all";
export type RebalanceAuditView =
  | "completed_rebalances"
  | "completed_deposits"
  | "errors";
export type RebalanceAuditErrorFilter =
  | "all"
  | "rebalance"
  | "deposit"
  | "needs_review";
export type RebalanceAuditLane = "rebalance" | "deposit" | "needs_review";
export type RebalanceAuditSource =
  | "autodeposit"
  | "idle_vault_deposit"
  | "manual_deposit"
  | "needs_review"
  | "rebalance";

export type RebalanceAuditCursor = {
  createdAt: string;
  id: string;
  sourceRank: number;
};

export type EarnActiveReserveRouteRow = {
  activeAumRaw: bigint;
  currentReserve: string;
  latestObservedAt: string | null;
  positionCount: number;
};

export type EarnRebalanceDecisionRow = {
  abandonReason: string | null;
  amountRaw: bigint | null;
  confirmedSlot: bigint | null;
  createdAt: string;
  decisionReason: string | null;
  decisionType: "rebalance" | null;
  estimatedEdgeBps: number | null;
  id: string;
  signature: string | null;
  sourceApyBps: number | null;
  sourceReserve: string | null;
  status: string;
  targetApyBps: number | null;
  targetReserve: string | null;
  updatedAt: string;
};

export type RebalanceActivityPoint = {
  bucketStartedAt: string;
  confirmed: number;
  expiredSubmissions: number;
  failedDecisions: number;
  failedOpportunities: number;
  fleetClaims: number;
  terminalAttempts: number;
};

export type OptimizationVolumePoint = {
  confirmedCount: number;
  cumulativeAmountRaw: bigint;
  dailyAmountRaw: bigint;
  date: string;
};

export type RebalanceAuditRow = {
  abandonReason: string | null;
  amountRaw: bigint | null;
  confirmedSlot: bigint | null;
  createdAt: string;
  decisionReason: string | null;
  estimatedEdgeBps: number | null;
  id: string;
  lane: RebalanceAuditLane;
  movementKind: string | null;
  source: RebalanceAuditSource;
  signature: string | null;
  secondarySignature: string | null;
  sourceApyBps: number | null;
  sourceReserve: string | null;
  status: string;
  submittedSlot: bigint | null;
  targetApyBps: number | null;
  targetReserve: string | null;
  updatedAt: string;
  vaultId: string | null;
  vaultIndex: number | null;
  vaultPubkey: string | null;
};

export type RebalanceAuditSummary = {
  active: number;
  completedDeposits: number;
  completedRebalances: number;
  depositErrors: number;
  errors: number;
  needsReview: number;
  rebalanceErrors: number;
  staleActive: number;
};

export type RebalanceAuditPage = {
  nextCursor: string | null;
  rows: RebalanceAuditRow[];
};

export type RebalanceAuditQuery = {
  cursor?: RebalanceAuditCursor | null;
  errorFilter?: RebalanceAuditErrorFilter;
  limit?: number;
  range: RebalanceAuditRange;
  view: RebalanceAuditView;
};

export type RebalanceAuditActiveQuery = {
  cursor?: RebalanceAuditCursor | null;
  limit?: number;
  range: RebalanceAuditRange;
};

type ActiveReserveRouteSqlRow = {
  active_aum_raw: SqlScalar;
  current_reserve: string;
  latest_observed_at: Date | string | null;
  position_count: SqlScalar;
};

type RebalanceDecisionSqlRow = {
  abandon_reason: string | null;
  amount_raw: SqlScalar;
  confirmed_slot: SqlScalar;
  created_at: Date | string;
  decision_reason: string | null;
  estimated_edge_bps: SqlScalar;
  execution_kind: string | null;
  id: string | number | bigint;
  signature: string | null;
  source_apy_bps: SqlScalar;
  source_reserve: string | null;
  status: string;
  target_apy_bps: SqlScalar;
  target_reserve: string | null;
  updated_at: Date | string;
};

type RebalanceActivitySqlRow = {
  bucket_started_at: Date | string;
  confirmed: SqlScalar;
  expired_submissions: SqlScalar;
  failed_decisions: SqlScalar;
  failed_opportunities: SqlScalar;
  fleet_claims: SqlScalar;
  terminal_attempts: SqlScalar;
};

type OptimizationVolumeSqlRow = {
  confirmed_count: SqlScalar;
  cumulative_amount_raw: SqlScalar;
  daily_amount_raw: SqlScalar;
  date: string;
};

type RebalanceAuditSqlRow = {
  abandon_reason: string | null;
  amount_raw: SqlScalar;
  confirmed_slot: SqlScalar;
  created_at: Date | string;
  decision_reason: string | null;
  event_at: Date | string;
  estimated_edge_bps: SqlScalar;
  execution_kind: string | null;
  id: string | number | bigint;
  lane: RebalanceAuditLane;
  movement_source: RebalanceAuditSource;
  record_type: string;
  signature: string | null;
  secondary_signature: string | null;
  sort_id: string | number | bigint;
  sort_source: SqlScalar;
  source_apy_bps: SqlScalar;
  source_reserve: string | null;
  status: string;
  submitted_slot: SqlScalar;
  target_apy_bps: SqlScalar;
  target_reserve: string | null;
  updated_at: Date | string;
  vault_id: string | number | bigint | null;
  vault_index: SqlScalar;
  vault_pubkey: string | null;
};

type RebalanceAuditSummarySqlRow = {
  active: SqlScalar;
  completed_deposits: SqlScalar;
  completed_rebalances: SqlScalar;
  deposit_errors: SqlScalar;
  errors: SqlScalar;
  needs_review: SqlScalar;
  rebalance_errors: SqlScalar;
  stale_active: SqlScalar;
};

function toBigInt(value: SqlScalar | undefined): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(Math.trunc(value));
  }

  if (typeof value === "string" && value.length > 0) {
    return BigInt(value);
  }

  return BigInt(0);
}

function toNullableBigInt(value: SqlScalar | undefined): bigint | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return toBigInt(value);
}

function toNumber(value: SqlScalar | undefined): number {
  return Number(toBigInt(value));
}

function toNullableNumber(value: SqlScalar | undefined): number | null {
  const bigintValue = toNullableBigInt(value);
  return bigintValue === null ? null : Number(bigintValue);
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function queryRows<T>(query: string): Promise<T[]> {
  return getYieldNeonSql().query(query) as unknown as Promise<T[]>;
}

function getDecisionType(
  row: Pick<RebalanceDecisionSqlRow, "execution_kind">
): EarnRebalanceDecisionRow["decisionType"] {
  if (row.execution_kind === "same_mint") {
    return "rebalance";
  }

  return null;
}

function mapAuditLane(value: string | null): RebalanceAuditLane {
  if (value === "rebalance" || value === "deposit") {
    return value;
  }

  return "needs_review";
}

function mapAuditSource(value: string | null): RebalanceAuditSource {
  if (
    value === "autodeposit" ||
    value === "idle_vault_deposit" ||
    value === "manual_deposit" ||
    value === "rebalance"
  ) {
    return value;
  }

  return "needs_review";
}

function rangePredicate(range: RebalanceAuditRange): string {
  switch (range) {
    case "24h":
      return "audit.event_at >= now() - interval '24 hours'";
    case "7d":
      return "audit.event_at >= now() - interval '7 days'";
    case "30d":
      return "audit.event_at >= now() - interval '30 days'";
    case "all":
      return "TRUE";
  }
}

function viewPredicate(
  view: RebalanceAuditView,
  errorFilter: RebalanceAuditErrorFilter
): string {
  const completedRebalances = `
    audit.record_type = 'decision'
    AND audit.movement_source = 'rebalance'
    AND audit.status = 'confirmed'
  `;
  const completedDeposits = `
    (
      audit.record_type = 'yield_deposit'
      AND audit.status = 'confirmed'
    )
    OR (
      audit.record_type = 'decision'
      AND audit.movement_source = 'idle_vault_deposit'
      AND audit.is_idle_fallback
      AND audit.status = 'confirmed'
    )
  `;
  const rebalanceErrors = `
    audit.record_type = 'decision'
    AND audit.movement_source = 'rebalance'
    AND audit.status IN ('failed', 'abandoned')
  `;
  const depositErrors = `
    (
      audit.record_type = 'decision'
      AND audit.movement_source = 'idle_vault_deposit'
      AND audit.status IN ('failed', 'abandoned')
    )
    OR (
      audit.record_type = 'execution'
      AND audit.movement_source = 'autodeposit'
      AND audit.status = 'failed'
    )
  `;
  const unknownStatus = `audit.record_type = 'decision' AND audit.status NOT IN (
    'planned', 'simulating', 'ready', 'submitted', 'confirming',
    'confirmed', 'failed', 'abandoned', 'skipped'
  )`;
  const needsReview = `
    audit.record_type = 'decision'
    AND (audit.movement_source = 'needs_review' OR ${unknownStatus})
  `;

  switch (view) {
    case "completed_rebalances":
      return completedRebalances;
    case "completed_deposits":
      return completedDeposits;
    case "errors":
      if (errorFilter === "rebalance") {
        return rebalanceErrors;
      }

      if (errorFilter === "deposit") {
        return depositErrors;
      }

      if (errorFilter === "needs_review") {
        return needsReview;
      }

      return `(${rebalanceErrors} OR ${depositErrors} OR ${needsReview})`;
  }
}

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function cursorPredicate(cursor: RebalanceAuditCursor | null | undefined) {
  if (!cursor) {
    return "";
  }

  return `AND (audit.event_at, audit.sort_source, audit.sort_id) < ('${escapeSqlLiteral(
    cursor.createdAt
  )}'::timestamptz, ${cursor.sourceRank}, ${cursor.id}::bigint)`;
}

export function decodeRebalanceAuditCursor(
  value: string | null | undefined
): RebalanceAuditCursor | null {
  if (!value) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as { createdAt?: unknown; id?: unknown; sourceRank?: unknown };

    const sourceRank = decoded.sourceRank ?? 1;

    if (
      typeof decoded.createdAt !== "string" ||
      Number.isNaN(Date.parse(decoded.createdAt)) ||
      typeof decoded.id !== "string" ||
      !/^\d+$/.test(decoded.id) ||
      typeof sourceRank !== "number" ||
      !Number.isInteger(sourceRank) ||
      sourceRank < 1 ||
      sourceRank > 3
    ) {
      return null;
    }

    return {
      createdAt: new Date(decoded.createdAt).toISOString(),
      id: decoded.id,
      sourceRank,
    };
  } catch {
    return null;
  }
}

function encodeRebalanceAuditCursor(cursor: RebalanceAuditCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

const activeStatusPredicate = `audit.record_type = 'decision' AND audit.status IN (
  'planned', 'simulating', 'ready', 'submitted', 'confirming'
)`;

function mapRebalanceAuditRow(row: RebalanceAuditSqlRow): RebalanceAuditRow {
  return {
    abandonReason: row.abandon_reason,
    amountRaw: toNullableBigInt(row.amount_raw),
    confirmedSlot: toNullableBigInt(row.confirmed_slot),
    createdAt: toIsoString(row.created_at) ?? "",
    decisionReason: row.decision_reason,
    estimatedEdgeBps: toNullableNumber(row.estimated_edge_bps),
    id: String(row.id),
    lane: mapAuditLane(row.lane),
    movementKind: row.execution_kind,
    source: mapAuditSource(row.movement_source),
    signature: row.signature,
    secondarySignature: row.secondary_signature,
    sourceApyBps: toNullableNumber(row.source_apy_bps),
    sourceReserve: row.source_reserve,
    status: row.status,
    submittedSlot: toNullableBigInt(row.submitted_slot),
    targetApyBps: toNullableNumber(row.target_apy_bps),
    targetReserve: row.target_reserve,
    updatedAt: toIsoString(row.updated_at) ?? "",
    vaultId: row.vault_id === null ? null : String(row.vault_id),
    vaultIndex: toNullableNumber(row.vault_index),
    vaultPubkey: row.vault_pubkey,
  };
}

const AUDIT_ROWS_CTE = `
  WITH audit_rows AS (
    SELECT
      'decision'::text AS record_type,
      ('decision:' || decision.id::text) AS id,
      decision.id::bigint AS sort_id,
      1::integer AS sort_source,
      decision.created_at AS event_at,
      decision.created_at,
      decision.updated_at,
      CASE
        WHEN decision.execution_plan->>'kind' = 'same_mint' THEN 'rebalance'
        WHEN decision.execution_plan->>'kind' = 'idle_vault_deposit' THEN 'deposit'
        ELSE 'needs_review'
      END::text AS lane,
      CASE
        WHEN decision.execution_plan->>'kind' = 'same_mint' THEN 'rebalance'
        WHEN decision.execution_plan->>'kind' = 'idle_vault_deposit' THEN 'idle_vault_deposit'
        ELSE 'needs_review'
      END::text AS movement_source,
      decision.execution_plan->>'kind' AS execution_kind,
      decision.status::text AS status,
      decision.abandon_reason,
      decision.amount_raw,
      decision.confirmed_slot,
      decision.submitted_slot,
      decision.decision_reason::text,
      decision.estimated_edge_bps,
      decision.source_apy_bps,
      decision.source_reserve,
      decision.target_apy_bps,
      decision.target_reserve,
      decision.signature,
      NULL::text AS secondary_signature,
      decision.vault_id::text AS vault_id,
      vault.vault_index::text AS vault_index,
      vault.vault_pubkey,
      (
        decision.execution_plan->>'kind' = 'idle_vault_deposit'
        AND NOT EXISTS (
          SELECT 1
          FROM loyal_yield.user_yield_position_deposits AS linked_deposit
          WHERE linked_deposit.deposit_signature = decision.signature
        )
      ) AS is_idle_fallback
    FROM loyal_yield.rebalance_decisions AS decision
    LEFT JOIN loyal_yield.managed_vaults AS vault
      ON vault.id = decision.vault_id

    UNION ALL

    SELECT
      'yield_deposit'::text AS record_type,
      ('deposit:' || deposit.id::text) AS id,
      deposit.id::bigint AS sort_id,
      2::integer AS sort_source,
      deposit.confirmed_at AS event_at,
      deposit.created_at,
      deposit.confirmed_at AS updated_at,
      'deposit'::text AS lane,
      CASE
        WHEN execution.id IS NOT NULL THEN 'autodeposit'
        WHEN idle_decision.id IS NOT NULL THEN 'idle_vault_deposit'
        ELSE 'manual_deposit'
      END::text AS movement_source,
      CASE
        WHEN execution.id IS NOT NULL THEN 'autodeposit'
        WHEN idle_decision.id IS NOT NULL THEN 'idle_vault_deposit'
        ELSE 'manual_deposit'
      END::text AS execution_kind,
      'confirmed'::text AS status,
      NULL::text AS abandon_reason,
      deposit.principal_amount_raw AS amount_raw,
      deposit.confirmed_slot,
      NULL::bigint AS submitted_slot,
      CASE
        WHEN execution.id IS NOT NULL THEN 'autodeposit_completed'
        WHEN idle_decision.id IS NOT NULL THEN 'idle_vault_deposit_completed'
        ELSE 'user_deposit_confirmed'
      END::text AS decision_reason,
      NULL::bigint AS estimated_edge_bps,
      NULL::bigint AS source_apy_bps,
      NULL::text AS source_reserve,
      deposit.target_supply_apy_bps AS target_apy_bps,
      deposit.target_reserve,
      COALESCE(execution.kamino_deposit_signature, deposit.deposit_signature) AS signature,
      execution.signature AS secondary_signature,
      vault.id::text AS vault_id,
      deposit.vault_index::text AS vault_index,
      deposit.vault_pubkey,
      false AS is_idle_fallback
    FROM loyal_yield.user_yield_position_deposits AS deposit
    LEFT JOIN loyal_yield.balance_sweep_executions AS execution
      ON execution.id = deposit.balance_sweep_execution_id
    LEFT JOIN LATERAL (
      SELECT idle.id
      FROM loyal_yield.rebalance_decisions AS idle
      WHERE idle.signature = deposit.deposit_signature
        AND idle.execution_plan->>'kind' = 'idle_vault_deposit'
      ORDER BY idle.id DESC
      LIMIT 1
    ) AS idle_decision ON true
    LEFT JOIN loyal_yield.managed_vaults AS vault
      ON vault.settings = deposit.settings
      AND vault.vault_index = deposit.vault_index
      AND vault.vault_pubkey = deposit.vault_pubkey

    UNION ALL

    SELECT
      'execution'::text AS record_type,
      ('execution:' || execution.id::text) AS id,
      execution.id::bigint AS sort_id,
      3::integer AS sort_source,
      COALESCE(execution.completed_at, execution.received_at, execution.inserted_at) AS event_at,
      execution.inserted_at AS created_at,
      COALESCE(execution.completed_at, execution.received_at, execution.inserted_at) AS updated_at,
      'deposit'::text AS lane,
      'autodeposit'::text AS movement_source,
      'autodeposit'::text AS execution_kind,
      'failed'::text AS status,
      execution.completion_failure_code AS abandon_reason,
      execution.amount_raw,
      execution.slot AS confirmed_slot,
      NULL::bigint AS submitted_slot,
      NULL::text AS decision_reason,
      NULL::bigint AS estimated_edge_bps,
      NULL::bigint AS source_apy_bps,
      NULL::text AS source_reserve,
      NULL::bigint AS target_apy_bps,
      NULL::text AS target_reserve,
      COALESCE(execution.kamino_deposit_signature, execution.signature) AS signature,
      CASE
        WHEN execution.kamino_deposit_signature IS NOT NULL THEN execution.signature
        ELSE NULL::text
      END AS secondary_signature,
      vault.id::text AS vault_id,
      target.vault_index::text AS vault_index,
      target.vault_pubkey,
      false AS is_idle_fallback
    FROM loyal_yield.balance_sweep_executions AS execution
    INNER JOIN loyal_yield.balance_sweep_targets AS target
      ON target.id = execution.target_id
    LEFT JOIN loyal_yield.managed_vaults AS vault
      ON vault.settings = target.settings
      AND vault.vault_index = target.vault_index
      AND vault.vault_pubkey = target.vault_pubkey
    WHERE execution.completion_failure_code IS NOT NULL
  )
`;

async function getRebalanceAuditPageByPredicate({
  cursor,
  limit: requestedLimit,
  predicate,
  range,
}: {
  cursor?: RebalanceAuditCursor | null;
  limit?: number;
  predicate: string;
  range: RebalanceAuditRange;
}): Promise<RebalanceAuditPage> {
  const limit = Math.min(Math.max(requestedLimit ?? 25, 1), 50);
  const rows = await queryRows<RebalanceAuditSqlRow>(
    `
      ${AUDIT_ROWS_CTE}
      SELECT
        audit.*
      FROM audit_rows AS audit
      WHERE ${rangePredicate(range)}
        AND ${predicate}
        ${cursorPredicate(cursor)}
      ORDER BY audit.event_at DESC, audit.sort_source DESC, audit.sort_id DESC
      LIMIT ${limit + 1}
    `
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows.at(-1);

  return {
    nextCursor:
      hasMore && lastRow
        ? encodeRebalanceAuditCursor({
            createdAt: toIsoString(lastRow.event_at) ?? "",
            id: String(lastRow.sort_id),
            sourceRank: toNumber(lastRow.sort_source),
          })
        : null,
    rows: pageRows.map(mapRebalanceAuditRow),
  };
}

export async function getActiveReserveRoutes(): Promise<
  EarnActiveReserveRouteRow[]
> {
  const rows = await queryRows<ActiveReserveRouteSqlRow>(
    `
      WITH reserve_rows AS (
        SELECT
          reserve.reserve AS current_reserve,
          reserve.observed_at,
          vault.id AS vault_id,
          reserve.amount_raw,
          COALESCE(
            reserve.planning_metadata->>'amountSemantics',
            reserve.planning_metadata->>'amount_semantics'
          ) AS amount_semantics,
          COALESCE(
            reserve.planning_metadata->>'redeemable_liquidity_amount_raw',
            reserve.planning_metadata->>'redeemable_source_liquidity_amount_raw'
          ) AS redeemable_amount_raw_text
        FROM loyal_yield.managed_vaults AS vault
        INNER JOIN loyal_yield.vault_reserve_positions_current AS reserve
          ON reserve.vault_id = vault.id
        WHERE vault.active = true
          AND vault.vault_index = 1
          AND reserve.has_value = true
          AND reserve.amount_raw > 0
      ),
      normalized_reserve_rows AS (
        SELECT
          current_reserve,
          observed_at,
          vault_id,
          CASE
            WHEN amount_semantics IN (
              'kamino_redeemable_liquidity',
              'redeemable_liquidity_amount'
            )
              THEN amount_raw
            WHEN amount_semantics = 'kamino_obligation_collateral_deposited_amount'
              AND redeemable_amount_raw_text ~ '^[0-9]+$'
              THEN redeemable_amount_raw_text::bigint
            ELSE 0::bigint
          END AS normalized_amount_raw
        FROM reserve_rows
      )
      SELECT
        current_reserve,
        COUNT(DISTINCT vault_id)::text AS position_count,
        COALESCE(SUM(normalized_amount_raw), 0)::text AS active_aum_raw,
        MAX(observed_at) AS latest_observed_at
      FROM normalized_reserve_rows
      WHERE normalized_amount_raw > 0
      GROUP BY current_reserve
      ORDER BY COALESCE(SUM(normalized_amount_raw), 0) DESC
    `
  );

  return rows.map((row) => ({
    activeAumRaw: toBigInt(row.active_aum_raw),
    currentReserve: row.current_reserve,
    latestObservedAt: toIsoString(row.latest_observed_at),
    positionCount: toNumber(row.position_count),
  }));
}

export async function getRecentRebalanceDecisions(): Promise<
  EarnRebalanceDecisionRow[]
> {
  const rows = await queryRows<RebalanceDecisionSqlRow>(
    `
      SELECT
        id::text,
        status::text,
        source_reserve,
        target_reserve,
        amount_raw::text,
        source_apy_bps::text,
        target_apy_bps::text,
        estimated_edge_bps::text,
        decision_reason::text,
        abandon_reason,
        signature,
        confirmed_slot::text,
        created_at,
        updated_at,
        execution_plan->>'kind' AS execution_kind
      FROM loyal_yield.rebalance_decisions
      WHERE execution_plan->>'kind' = 'same_mint'
      ORDER BY created_at DESC, id DESC
      LIMIT 25
    `
  );

  return rows.map((row) => ({
    abandonReason: row.abandon_reason,
    amountRaw: toNullableBigInt(row.amount_raw),
    confirmedSlot: toNullableBigInt(row.confirmed_slot),
    createdAt: toIsoString(row.created_at) ?? "",
    decisionReason: row.decision_reason,
    decisionType: getDecisionType(row),
    estimatedEdgeBps: toNullableNumber(row.estimated_edge_bps),
    id: String(row.id),
    signature: row.signature,
    sourceApyBps: toNullableNumber(row.source_apy_bps),
    sourceReserve: row.source_reserve,
    status: row.status,
    targetApyBps: toNullableNumber(row.target_apy_bps),
    targetReserve: row.target_reserve,
    updatedAt: toIsoString(row.updated_at) ?? "",
  }));
}

export async function getRebalanceActivity(): Promise<
  RebalanceActivityPoint[]
> {
  const rows = await queryRows<RebalanceActivitySqlRow>(
    `
      WITH bounds AS (
        SELECT
          now() - interval '72 hours' AS window_started_at,
          date_bin(
            interval '2 hours',
            now() - interval '72 hours',
            timestamptz '1970-01-01 00:00:00+00'
          ) AS started_at,
          date_bin(
            interval '2 hours',
            now(),
            timestamptz '1970-01-01 00:00:00+00'
          ) AS ended_at
      ),
      buckets AS (
        SELECT generate_series(
          (SELECT started_at FROM bounds),
          (SELECT ended_at FROM bounds),
          interval '2 hours'
        ) AS bucket_started_at
      ),
      decision_activity AS (
        SELECT
          date_bin(
            interval '2 hours',
            decision.updated_at,
            timestamptz '1970-01-01 00:00:00+00'
          ) AS bucket_started_at,
          COUNT(*) FILTER (
            WHERE decision.status = 'confirmed'
          )::bigint AS confirmed,
          COUNT(*) FILTER (
            WHERE decision.status IN ('confirmed', 'failed')
          )::bigint AS terminal_attempts,
          COUNT(*) FILTER (
            WHERE decision.status = 'failed'
          )::bigint AS failed_decisions
        FROM loyal_yield.rebalance_decisions AS decision
        WHERE decision.execution_plan->>'kind' = 'same_mint'
          AND decision.updated_at >= (SELECT window_started_at FROM bounds)
        GROUP BY 1
      ),
      opportunity_activity AS (
        SELECT
          date_bin(
            interval '2 hours',
            opportunity.state_entered_at,
            timestamptz '1970-01-01 00:00:00+00'
          ) AS bucket_started_at,
          COUNT(*)::bigint AS failed_opportunities
        FROM loyal_yield.rebalance_opportunities AS opportunity
        WHERE opportunity.execution_plan->>'kind' = 'same_mint'
          AND opportunity.opportunity_state = 'failed'
          AND opportunity.state_entered_at >= (
            SELECT window_started_at FROM bounds
          )
        GROUP BY 1
      ),
      submission_activity AS (
        SELECT
          date_bin(
            interval '2 hours',
            submission.submission_state_entered_at,
            timestamptz '1970-01-01 00:00:00+00'
          ) AS bucket_started_at,
          COUNT(*)::bigint AS expired_submissions
        FROM loyal_yield.signed_route_submissions AS submission
        WHERE submission.submission_state = 'expired'
          AND submission.submission_state_entered_at >= (
            SELECT window_started_at FROM bounds
          )
        GROUP BY 1
      ),
      opportunity_claims AS (
        SELECT
          date_bin(
            interval '2 hours',
            opportunity.created_at,
            timestamptz '1970-01-01 00:00:00+00'
          ) AS bucket_started_at,
          COALESCE(SUM(opportunity.attempt_count), 0)::bigint AS fleet_claims
        FROM loyal_yield.rebalance_opportunities AS opportunity
        WHERE opportunity.execution_plan->>'kind' = 'same_mint'
          AND opportunity.created_at >= (SELECT window_started_at FROM bounds)
        GROUP BY 1
      )
      SELECT
        bucket.bucket_started_at,
        COALESCE(decision.confirmed, 0)::text AS confirmed,
        COALESCE(decision.terminal_attempts, 0)::text AS terminal_attempts,
        COALESCE(decision.failed_decisions, 0)::text AS failed_decisions,
        COALESCE(opportunity.failed_opportunities, 0)::text
          AS failed_opportunities,
        COALESCE(submission.expired_submissions, 0)::text
          AS expired_submissions,
        COALESCE(claim.fleet_claims, 0)::text AS fleet_claims
      FROM buckets AS bucket
      LEFT JOIN decision_activity AS decision USING (bucket_started_at)
      LEFT JOIN opportunity_activity AS opportunity USING (bucket_started_at)
      LEFT JOIN submission_activity AS submission USING (bucket_started_at)
      LEFT JOIN opportunity_claims AS claim USING (bucket_started_at)
      ORDER BY bucket.bucket_started_at ASC
    `
  );

  return rows.map((row) => ({
    bucketStartedAt: toIsoString(row.bucket_started_at) ?? "",
    confirmed: toNumber(row.confirmed),
    expiredSubmissions: toNumber(row.expired_submissions),
    failedDecisions: toNumber(row.failed_decisions),
    failedOpportunities: toNumber(row.failed_opportunities),
    fleetClaims: toNumber(row.fleet_claims),
    terminalAttempts: toNumber(row.terminal_attempts),
  }));
}

export async function getOptimizationVolumeSeries(): Promise<
  OptimizationVolumePoint[]
> {
  const rows = await queryRows<OptimizationVolumeSqlRow>(
    `
      WITH confirmed_daily AS (
        SELECT
          (decision.updated_at AT TIME ZONE 'UTC')::date AS date,
          COUNT(*)::bigint AS confirmed_count,
          COALESCE(SUM(decision.amount_raw), 0)::bigint AS daily_amount_raw
        FROM loyal_yield.rebalance_decisions AS decision
        WHERE decision.status = 'confirmed'
          AND decision.signature IS NOT NULL
          AND decision.amount_raw IS NOT NULL
        GROUP BY 1
      ),
      bounds AS (
        SELECT
          COALESCE(
            MIN(date),
            (now() AT TIME ZONE 'UTC')::date
          ) AS started_on,
          (now() AT TIME ZONE 'UTC')::date AS ended_on
        FROM confirmed_daily
      ),
      days AS (
        SELECT generate_series(
          (SELECT started_on FROM bounds),
          (SELECT ended_on FROM bounds),
          interval '1 day'
        )::date AS date
      ),
      daily AS (
        SELECT
          day.date,
          COALESCE(confirmed.confirmed_count, 0)::bigint AS confirmed_count,
          COALESCE(confirmed.daily_amount_raw, 0)::bigint AS daily_amount_raw
        FROM days AS day
        LEFT JOIN confirmed_daily AS confirmed USING (date)
      )
      SELECT
        to_char(date, 'YYYY-MM-DD') AS date,
        confirmed_count::text AS confirmed_count,
        daily_amount_raw::text AS daily_amount_raw,
        SUM(daily_amount_raw) OVER (ORDER BY date ASC)::text
          AS cumulative_amount_raw
      FROM daily
      ORDER BY date ASC
    `
  );

  return rows.map((row) => ({
    confirmedCount: toNumber(row.confirmed_count),
    cumulativeAmountRaw: toBigInt(row.cumulative_amount_raw),
    dailyAmountRaw: toBigInt(row.daily_amount_raw),
    date: row.date,
  }));
}

export async function getRebalanceAuditSummary(
  range: RebalanceAuditRange
): Promise<RebalanceAuditSummary> {
  const rows = await queryRows<RebalanceAuditSummarySqlRow>(
    `
      ${AUDIT_ROWS_CTE}
      SELECT
        COUNT(*) FILTER (
          WHERE audit.record_type = 'decision'
            AND audit.movement_source = 'rebalance'
            AND audit.status = 'confirmed'
        )::text AS completed_rebalances,
        COUNT(*) FILTER (
          WHERE (
            audit.record_type = 'yield_deposit'
            AND audit.status = 'confirmed'
          ) OR (
            audit.record_type = 'decision'
            AND audit.movement_source = 'idle_vault_deposit'
            AND audit.is_idle_fallback
            AND audit.status = 'confirmed'
          )
        )::text AS completed_deposits,
        COUNT(*) FILTER (
          WHERE audit.record_type = 'decision'
            AND audit.movement_source = 'rebalance'
            AND audit.status IN ('failed', 'abandoned')
        )::text AS rebalance_errors,
        COUNT(*) FILTER (
          WHERE (
            audit.record_type = 'decision'
            AND audit.movement_source = 'idle_vault_deposit'
            AND audit.status IN ('failed', 'abandoned')
          ) OR (
            audit.record_type = 'execution'
            AND audit.movement_source = 'autodeposit'
            AND audit.status = 'failed'
          )
        )::text AS deposit_errors,
        COUNT(*) FILTER (
          WHERE (
            audit.record_type = 'decision'
            AND audit.movement_source = 'rebalance'
            AND audit.status IN ('failed', 'abandoned')
          ) OR (
            audit.record_type = 'decision'
            AND audit.movement_source = 'idle_vault_deposit'
            AND audit.status IN ('failed', 'abandoned')
          ) OR (
            audit.record_type = 'execution'
            AND audit.movement_source = 'autodeposit'
            AND audit.status = 'failed'
          ) OR (
            audit.record_type = 'decision'
            AND (
              audit.movement_source = 'needs_review'
              OR audit.status NOT IN (
                'planned', 'simulating', 'ready', 'submitted', 'confirming',
                'confirmed', 'failed', 'abandoned', 'skipped'
              )
            )
          )
        )::text AS errors,
        COUNT(*) FILTER (
          WHERE audit.record_type = 'decision'
            AND (
              audit.movement_source = 'needs_review'
              OR audit.status NOT IN (
                'planned', 'simulating', 'ready', 'submitted', 'confirming',
                'confirmed', 'failed', 'abandoned', 'skipped'
              )
            )
        )::text AS needs_review,
        COUNT(*) FILTER (
          WHERE audit.record_type = 'decision'
            AND audit.status IN (
            'planned', 'simulating', 'ready', 'submitted', 'confirming'
          )
        )::text AS active,
        COUNT(*) FILTER (
          WHERE audit.record_type = 'decision'
            AND audit.status IN (
            'planned', 'simulating', 'ready', 'submitted', 'confirming'
          )
          AND audit.event_at < now() - interval '2 minutes'
        )::text AS stale_active
      FROM audit_rows AS audit
      WHERE ${rangePredicate(range)}
    `
  );

  const row = rows[0];
  return {
    active: toNumber(row?.active),
    completedDeposits: toNumber(row?.completed_deposits),
    completedRebalances: toNumber(row?.completed_rebalances),
    depositErrors: toNumber(row?.deposit_errors),
    errors: toNumber(row?.errors),
    needsReview: toNumber(row?.needs_review),
    rebalanceErrors: toNumber(row?.rebalance_errors),
    staleActive: toNumber(row?.stale_active),
  };
}

export async function getRebalanceAuditPage(
  query: RebalanceAuditQuery
): Promise<RebalanceAuditPage> {
  const errorFilter = query.errorFilter ?? "all";
  return getRebalanceAuditPageByPredicate({
    cursor: query.cursor,
    limit: query.limit,
    predicate: viewPredicate(query.view, errorFilter),
    range: query.range,
  });
}

export async function getRebalanceAuditActivePage(
  query: RebalanceAuditActiveQuery
): Promise<RebalanceAuditPage> {
  return getRebalanceAuditPageByPredicate({
    cursor: query.cursor,
    limit: query.limit,
    predicate: activeStatusPredicate,
    range: query.range,
  });
}
