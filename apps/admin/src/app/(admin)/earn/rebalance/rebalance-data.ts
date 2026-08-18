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
  liquidityMint: string;
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
  liquidityMint: string | null;
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

export type AutodepositTimeSeriesRangeKey = "2d" | "7d" | "30d";

export type AutodepositTimeSeriesPoint = {
  accountNotFound: number;
  bucketStartedAt: string;
  confirmationOrTimeout: number;
  depositedAmountRaw: bigint;
  insufficientRent: number;
  missingTokenDelegate: number;
  noLinkedError: number;
  otherPrePull: number;
  postPullKaminoTopUp: number;
  successful: number;
};

export type AutodepositTimeSeriesRange = {
  bucketHours: number;
  key: AutodepositTimeSeriesRangeKey;
  points: AutodepositTimeSeriesPoint[];
};

export type OptimizationVolumePoint = {
  confirmedCount: number;
  cumulativeAmountRaw: bigint;
  dailyAmountRaw: bigint;
  date: string;
};

export type Last30DaysRebalancePoint = {
  confirmed: number;
  date: string;
  failed: number;
  terminalAttempts: number;
};

export type ExecutedEarnRebalanceRow = {
  amountRaw: bigint;
  authority: string;
  confirmedSlot: bigint;
  currentDepositRaw: bigint;
  executedAt: string;
  id: string;
  liquidityMint: string | null;
  sourceReserve: string;
  targetReserve: string;
  userRank: number;
};

export type ExecutedEarnRebalanceHistory = {
  executions: ExecutedEarnRebalanceRow[];
  generatedAt: string;
  userCount: number;
};

export type EarnVaultRebalanceFrequencyRow = {
  allCount: number;
  currentDepositRaw: bigint;
  currentReserve: string | null;
  depositRank: number;
  last12hCount: number;
  last2hCount: number;
  last7dCount: number;
  liquidityMint: string | null;
  opportunity12hCount: number;
  opportunity2hCount: number;
  opportunity7dCount: number;
  opportunityAllCount: number;
  positionCount: number;
  vaultId: string;
  vaultPubkey: string;
};

export type EarnVaultRebalanceFrequency = {
  generatedAt: string;
  vaultCount: number;
  vaults: EarnVaultRebalanceFrequencyRow[];
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
  liquidityMint: string | null;
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
  liquidity_mint: string;
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
  liquidity_mint: string | null;
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

type AutodepositTimeSeriesSqlRow = {
  account_not_found: SqlScalar;
  bucket_hours: SqlScalar;
  bucket_started_at: Date | string;
  confirmation_or_timeout: SqlScalar;
  deposited_amount_raw: SqlScalar;
  insufficient_rent: SqlScalar;
  missing_token_delegate: SqlScalar;
  no_linked_error: SqlScalar;
  other_pre_pull: SqlScalar;
  post_pull_kamino_top_up: SqlScalar;
  range_key: AutodepositTimeSeriesRangeKey;
  successful: SqlScalar;
};

type OptimizationVolumeSqlRow = {
  confirmed_count: SqlScalar;
  cumulative_amount_raw: SqlScalar;
  daily_amount_raw: SqlScalar;
  date: string;
};

type Last30DaysRebalanceSqlRow = {
  confirmed: SqlScalar;
  date: string;
  failed: SqlScalar;
  terminal_attempts: SqlScalar;
};

type ExecutedEarnRebalanceSqlRow = {
  amount_raw: SqlScalar;
  authority: string;
  confirmed_slot: SqlScalar;
  current_deposit_raw: SqlScalar;
  executed_at: Date | string;
  id: string;
  liquidity_mint: string | null;
  source_reserve: string;
  target_reserve: string;
  user_count: SqlScalar;
  user_rank: SqlScalar;
};

type EarnVaultRebalanceFrequencySqlRow = {
  all_count: SqlScalar;
  opportunity_all_count: SqlScalar;
  opportunity_last_12h_count: SqlScalar;
  opportunity_last_2h_count: SqlScalar;
  opportunity_last_7d_count: SqlScalar;
  current_deposit_raw: SqlScalar;
  current_reserve: string | null;
  deposit_rank: SqlScalar;
  last_12h_count: SqlScalar;
  last_2h_count: SqlScalar;
  last_7d_count: SqlScalar;
  liquidity_mint: string | null;
  position_count: SqlScalar;
  vault_count: SqlScalar;
  vault_id: string;
  vault_pubkey: string;
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
  liquidity_mint: string | null;
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
    liquidityMint: row.liquidity_mint,
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
      decision.liquidity_mint,
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
      deposit.liquidity_mint,
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
      execution.token_mint AS liquidity_mint,
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
          reserve.liquidity_mint,
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
          liquidity_mint,
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
        liquidity_mint,
        COUNT(DISTINCT vault_id)::text AS position_count,
        COALESCE(SUM(normalized_amount_raw), 0)::text AS active_aum_raw,
        MAX(observed_at) AS latest_observed_at
      FROM normalized_reserve_rows
      WHERE normalized_amount_raw > 0
      GROUP BY current_reserve, liquidity_mint
      ORDER BY COALESCE(SUM(normalized_amount_raw), 0) DESC
    `
  );

  return rows.map((row) => ({
    activeAumRaw: toBigInt(row.active_aum_raw),
    currentReserve: row.current_reserve,
    latestObservedAt: toIsoString(row.latest_observed_at),
    liquidityMint: row.liquidity_mint,
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
        liquidity_mint,
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
    liquidityMint: row.liquidity_mint,
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

export async function getAutodepositTimeSeries(): Promise<
  AutodepositTimeSeriesRange[]
> {
  const rows = await queryRows<AutodepositTimeSeriesSqlRow>(
    `
      WITH params AS (
        SELECT now() AT TIME ZONE 'UTC' AS utc_now
      ),
      ranges AS (
        SELECT
          '2d'::text AS range_key,
          2::integer AS bucket_hours,
          interval '2 hours' AS bucket_size,
          date_trunc('day', utc_now) - interval '1 day' AS started_at,
          date_bin(
            interval '2 hours',
            utc_now,
            timestamp '1970-01-01 00:00:00'
          ) AS ended_at
        FROM params

        UNION ALL

        SELECT
          '7d'::text AS range_key,
          6::integer AS bucket_hours,
          interval '6 hours' AS bucket_size,
          date_trunc('day', utc_now) - interval '6 days' AS started_at,
          date_bin(
            interval '6 hours',
            utc_now,
            timestamp '1970-01-01 00:00:00'
          ) AS ended_at
        FROM params

        UNION ALL

        SELECT
          '30d'::text AS range_key,
          24::integer AS bucket_hours,
          interval '1 day' AS bucket_size,
          date_trunc('day', utc_now) - interval '29 days' AS started_at,
          date_trunc('day', utc_now) AS ended_at
        FROM params
      ),
      buckets AS (
        SELECT
          range.range_key,
          range.bucket_hours,
          range.bucket_size,
          generate_series(
            range.started_at,
            range.ended_at,
            range.bucket_size
          ) AS bucket_started_at
        FROM ranges AS range
      ),
      window_bounds AS (
        SELECT MIN(started_at) AS started_at FROM ranges
      ),
      execution_events AS (
        SELECT
          execution.inserted_at AS event_at,
          CASE
            WHEN execution.decoded_evidence->>'status' = 'executed'
              AND execution.completion_failure_code IS NULL
              THEN 1
            ELSE 0
          END::bigint AS successful,
          CASE
            WHEN execution.decoded_evidence->>'status' = 'executed'
              AND execution.completion_failure_code IS NULL
              THEN execution.amount_raw
            ELSE 0
          END::bigint AS deposited_amount_raw,
          0::bigint AS post_pull_kamino_top_up
        FROM loyal_yield.balance_sweep_executions AS execution
        WHERE execution.inserted_at >= (
          SELECT started_at AT TIME ZONE 'UTC'
          FROM window_bounds
        )
          AND execution.inserted_at <= now()
          AND execution.decoded_evidence->>'status' = 'executed'
          AND execution.completion_failure_code IS NULL

        UNION ALL

        SELECT
          COALESCE(execution.completed_at, execution.inserted_at) AS event_at,
          0::bigint AS successful,
          0::bigint AS deposited_amount_raw,
          1::bigint AS post_pull_kamino_top_up
        FROM loyal_yield.balance_sweep_executions AS execution
        WHERE COALESCE(execution.completed_at, execution.inserted_at) >= (
          SELECT started_at AT TIME ZONE 'UTC'
          FROM window_bounds
        )
          AND COALESCE(execution.completed_at, execution.inserted_at) <= now()
          AND (
            execution.completion_failure_code IS NOT NULL
            OR (
              execution.decoded_evidence->>'status' LIKE 'partial_executed%'
              AND execution.decoded_evidence->>'status'
                <> 'partial_executed_idle_vault_deposited'
            )
          )
      ),
      -- Events are collapsed into 2-hour base buckets exactly once, then rolled
      -- up per range, instead of being cross-joined against every range while
      -- still at full row granularity. Every range boundary is midnight- or
      -- bucket-aligned and every bucket size (2h / 6h / 1 day) is a whole
      -- multiple of 2 hours sharing the same 1970-01-01 origin, so
      -- date_bin(size, date_bin(2h, t)) = date_bin(size, t) and the range
      -- predicate is equivalent on the base bucket. Both sides stay in UTC
      -- wall-clock timestamps to match "ranges".
      execution_base AS (
        SELECT
          date_bin(
            interval '2 hours',
            event.event_at AT TIME ZONE 'UTC',
            timestamp '1970-01-01 00:00:00'
          ) AS base_bucket,
          SUM(event.successful)::bigint AS successful,
          SUM(event.deposited_amount_raw)::bigint AS deposited_amount_raw,
          SUM(event.post_pull_kamino_top_up)::bigint
            AS post_pull_kamino_top_up
        FROM execution_events AS event
        GROUP BY 1
      ),
      execution_activity AS (
        SELECT
          range.range_key,
          date_bin(
            range.bucket_size,
            base.base_bucket,
            timestamp '1970-01-01 00:00:00'
          ) AS bucket_started_at,
          SUM(base.successful)::bigint AS successful,
          SUM(base.deposited_amount_raw)::bigint AS deposited_amount_raw,
          SUM(base.post_pull_kamino_top_up)::bigint
            AS post_pull_kamino_top_up
        FROM execution_base AS base
        CROSS JOIN ranges AS range
        WHERE base.base_bucket >= range.started_at
          AND base.base_bucket < range.ended_at + range.bucket_size
        GROUP BY 1, 2
      ),
      -- The scheduled-slot id is derived once per claim so the join key is a
      -- plain column and the planner can hash-join the slots rather than run a
      -- nested-loop index probe per claim per range. Claims whose token does
      -- not match the autodeposit pattern keep a NULL id, so they still fall
      -- through the LEFT JOIN to 'no_linked_error' as before.
      pre_pull_claims AS (
        SELECT
          claim.updated_at AS event_at,
          CASE
            WHEN claim.claim_token ~ '^autodeposit-trigger:[0-9]+:[0-9]+:'
              THEN split_part(claim.claim_token, ':', 3)::bigint
          END AS scheduled_slot_id
        FROM loyal_yield.balance_sweep_lot_claims AS claim
        WHERE claim.updated_at >= (
          SELECT started_at AT TIME ZONE 'UTC'
          FROM window_bounds
        )
          AND claim.updated_at <= now()
          AND claim.status::text IN ('released', 'failed')
          AND claim.execution_id IS NULL
      ),
      -- Slot ids are 1:1 with claims, so probing the slot primary key per claim
      -- means ~187k random index lookups (~750k buffer hits). Classifying every
      -- slot once behind MATERIALIZED forces a single sequential pass plus a
      -- hash join on a narrow (id, cause) tuple instead.
      slot_causes AS MATERIALIZED (
        SELECT
          slot.id,
          CASE
            WHEN slot.last_error ILIKE '%AccountNotFound%'
              THEN 'account_not_found'
            WHEN slot.last_error ILIKE '%InsufficientFundsForRent%'
              THEN 'insufficient_rent'
            WHEN slot.last_error ILIKE '%owner does not match%'
              OR slot.last_error ILIKE '%missing token delegate%'
              THEN 'missing_token_delegate'
            WHEN slot.last_error ILIKE '%unable to confirm transaction%'
              OR slot.last_error ILIKE '%timed out%'
              OR slot.last_error ILIKE '%BlockhashNotFound%'
              THEN 'confirmation_or_timeout'
            WHEN slot.last_error IS NULL OR slot.last_error = ''
              THEN 'no_linked_error'
            ELSE 'other_pre_pull'
          END AS cause
        FROM loyal_yield.balance_sweep_scheduled_slots AS slot
      ),
      pre_pull_failure_events AS (
        -- A claim with no matching slot has no linked error, which is the same
        -- bucket a matched slot with an empty last_error falls into.
        SELECT
          claim.event_at,
          COALESCE(slot.cause, 'no_linked_error') AS cause
        FROM pre_pull_claims AS claim
        LEFT JOIN slot_causes AS slot
          ON slot.id = claim.scheduled_slot_id
      ),
      pre_pull_base AS (
        SELECT
          date_bin(
            interval '2 hours',
            failure.event_at AT TIME ZONE 'UTC',
            timestamp '1970-01-01 00:00:00'
          ) AS base_bucket,
          COUNT(*) FILTER (
            WHERE failure.cause = 'account_not_found'
          )::bigint AS account_not_found,
          COUNT(*) FILTER (
            WHERE failure.cause = 'insufficient_rent'
          )::bigint AS insufficient_rent,
          COUNT(*) FILTER (
            WHERE failure.cause = 'missing_token_delegate'
          )::bigint AS missing_token_delegate,
          COUNT(*) FILTER (
            WHERE failure.cause = 'confirmation_or_timeout'
          )::bigint AS confirmation_or_timeout,
          COUNT(*) FILTER (
            WHERE failure.cause = 'no_linked_error'
          )::bigint AS no_linked_error,
          COUNT(*) FILTER (
            WHERE failure.cause = 'other_pre_pull'
          )::bigint AS other_pre_pull
        FROM pre_pull_failure_events AS failure
        GROUP BY 1
      ),
      pre_pull_failure_activity AS (
        SELECT
          range.range_key,
          date_bin(
            range.bucket_size,
            base.base_bucket,
            timestamp '1970-01-01 00:00:00'
          ) AS bucket_started_at,
          SUM(base.account_not_found)::bigint AS account_not_found,
          SUM(base.insufficient_rent)::bigint AS insufficient_rent,
          SUM(base.missing_token_delegate)::bigint AS missing_token_delegate,
          SUM(base.confirmation_or_timeout)::bigint AS confirmation_or_timeout,
          SUM(base.no_linked_error)::bigint AS no_linked_error,
          SUM(base.other_pre_pull)::bigint AS other_pre_pull
        FROM pre_pull_base AS base
        CROSS JOIN ranges AS range
        WHERE base.base_bucket >= range.started_at
          AND base.base_bucket < range.ended_at + range.bucket_size
        GROUP BY 1, 2
      )
      SELECT
        bucket.range_key,
        bucket.bucket_hours::text AS bucket_hours,
        bucket.bucket_started_at AT TIME ZONE 'UTC' AS bucket_started_at,
        COALESCE(execution.successful, 0)::text AS successful,
        COALESCE(execution.deposited_amount_raw, 0)::text
          AS deposited_amount_raw,
        COALESCE(failure.account_not_found, 0)::text
          AS account_not_found,
        COALESCE(failure.insufficient_rent, 0)::text
          AS insufficient_rent,
        COALESCE(failure.missing_token_delegate, 0)::text
          AS missing_token_delegate,
        COALESCE(failure.confirmation_or_timeout, 0)::text
          AS confirmation_or_timeout,
        COALESCE(failure.no_linked_error, 0)::text
          AS no_linked_error,
        COALESCE(failure.other_pre_pull, 0)::text AS other_pre_pull,
        COALESCE(execution.post_pull_kamino_top_up, 0)::text
          AS post_pull_kamino_top_up
      FROM buckets AS bucket
      LEFT JOIN execution_activity AS execution
        USING (range_key, bucket_started_at)
      LEFT JOIN pre_pull_failure_activity AS failure
        USING (range_key, bucket_started_at)
      ORDER BY
        CASE bucket.range_key
          WHEN '2d' THEN 1
          WHEN '7d' THEN 2
          ELSE 3
        END,
        bucket.bucket_started_at ASC
    `
  );

  const ranges: AutodepositTimeSeriesRange[] = [
    { bucketHours: 2, key: "2d", points: [] },
    { bucketHours: 6, key: "7d", points: [] },
    { bucketHours: 24, key: "30d", points: [] },
  ];
  const rangeByKey = new Map(ranges.map((range) => [range.key, range]));

  for (const row of rows) {
    rangeByKey.get(row.range_key)?.points.push({
      accountNotFound: toNumber(row.account_not_found),
      bucketStartedAt: toIsoString(row.bucket_started_at) ?? "",
      confirmationOrTimeout: toNumber(row.confirmation_or_timeout),
      depositedAmountRaw: toBigInt(row.deposited_amount_raw),
      insufficientRent: toNumber(row.insufficient_rent),
      missingTokenDelegate: toNumber(row.missing_token_delegate),
      noLinkedError: toNumber(row.no_linked_error),
      otherPrePull: toNumber(row.other_pre_pull),
      postPullKaminoTopUp: toNumber(row.post_pull_kamino_top_up),
      successful: toNumber(row.successful),
    });
  }

  return ranges;
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

export async function getLast30DaysRebalanceSeries(): Promise<
  Last30DaysRebalancePoint[]
> {
  const rows = await queryRows<Last30DaysRebalanceSqlRow>(
    `
      WITH bounds AS (
        SELECT
          date_trunc('day', now() AT TIME ZONE 'UTC') - interval '29 days'
            AS started_at,
          now() AT TIME ZONE 'UTC' AS ended_at
      ),
      days AS (
        SELECT generate_series(
          (SELECT started_at::date FROM bounds),
          (SELECT ended_at::date FROM bounds),
          interval '1 day'
        )::date AS date
      ),
      daily AS (
        SELECT
          (decision.updated_at AT TIME ZONE 'UTC')::date AS date,
          COUNT(*) FILTER (
            WHERE decision.status = 'confirmed'
          )::bigint AS confirmed,
          COUNT(*) FILTER (
            WHERE decision.status = 'failed'
          )::bigint AS failed
        FROM loyal_yield.rebalance_decisions AS decision
        WHERE decision.execution_plan->>'kind' = 'same_mint'
          AND decision.status IN ('confirmed', 'failed')
          AND decision.updated_at >= (
            SELECT started_at AT TIME ZONE 'UTC' FROM bounds
          )
          AND decision.updated_at < (
            SELECT ended_at AT TIME ZONE 'UTC' FROM bounds
          )
        GROUP BY 1
      )
      SELECT
        to_char(day.date, 'YYYY-MM-DD') AS date,
        COALESCE(daily.confirmed, 0)::text AS confirmed,
        COALESCE(daily.failed, 0)::text AS failed,
        (
          COALESCE(daily.confirmed, 0) + COALESCE(daily.failed, 0)
        )::text AS terminal_attempts
      FROM days AS day
      LEFT JOIN daily USING (date)
      ORDER BY day.date ASC
    `
  );

  return rows.map((row) => ({
    confirmed: toNumber(row.confirmed),
    date: row.date,
    failed: toNumber(row.failed),
    terminalAttempts: toNumber(row.terminal_attempts),
  }));
}

export async function getExecutedEarnRebalanceHistory(): Promise<ExecutedEarnRebalanceHistory> {
  const rows = await queryRows<ExecutedEarnRebalanceSqlRow>(
    `
      WITH executed AS MATERIALIZED (
        SELECT
          decision.id,
          decision.updated_at AS executed_at,
          decision.amount_raw,
          decision.source_reserve,
          decision.target_reserve,
          decision.liquidity_mint,
          decision.confirmed_slot,
          policy.authority
        FROM loyal_yield.rebalance_decisions AS decision
        INNER JOIN loyal_yield.managed_vaults AS vault
          ON vault.id = decision.vault_id
        INNER JOIN loyal_yield.route_policies AS policy
          ON policy.id = vault.active_policy_id
        WHERE decision.status = 'confirmed'
          AND decision.source_reserve IS NOT NULL
          AND decision.target_reserve IS NOT NULL
          AND decision.amount_raw IS NOT NULL
          AND decision.confirmed_slot IS NOT NULL
      ),
      executed_users AS MATERIALIZED (
        SELECT DISTINCT authority FROM executed
      ),
      relevant_vaults AS MATERIALIZED (
        SELECT vault.id AS vault_id, policy.authority
        FROM loyal_yield.managed_vaults AS vault
        INNER JOIN loyal_yield.route_policies AS policy
          ON policy.id = vault.active_policy_id
        INNER JOIN executed_users
          ON executed_users.authority = policy.authority
      ),
      current_reserve_by_vault AS MATERIALIZED (
        SELECT
          position.vault_id,
          SUM(
            CASE
              WHEN COALESCE(
                position.planning_metadata->>'amountSemantics',
                position.planning_metadata->>'amount_semantics'
              ) IN (
                'kamino_redeemable_liquidity',
                'redeemable_liquidity_amount'
              )
                THEN position.amount_raw
              WHEN COALESCE(
                position.planning_metadata->>'amountSemantics',
                position.planning_metadata->>'amount_semantics'
              ) = 'kamino_obligation_collateral_deposited_amount'
                AND COALESCE(
                  position.planning_metadata->>'redeemable_liquidity_amount_raw',
                  position.planning_metadata->>'redeemable_source_liquidity_amount_raw'
                ) ~ '^[0-9]+$'
                THEN COALESCE(
                  position.planning_metadata->>'redeemable_liquidity_amount_raw',
                  position.planning_metadata->>'redeemable_source_liquidity_amount_raw'
                )::bigint
              ELSE 0::bigint
            END
          )::bigint AS amount_raw
        FROM relevant_vaults AS relevant
        INNER JOIN loyal_yield.vault_reserve_positions_current AS position
          ON position.vault_id = relevant.vault_id
        WHERE position.has_value = true
          AND position.amount_raw > 0
        GROUP BY position.vault_id
      ),
      current_idle_by_vault AS MATERIALIZED (
        SELECT idle.vault_id, SUM(idle.amount_raw)::bigint AS amount_raw
        FROM relevant_vaults AS relevant
        INNER JOIN loyal_yield.vault_idle_token_balances_current AS idle
          ON idle.vault_id = relevant.vault_id
        WHERE idle.amount_raw > 0
        GROUP BY idle.vault_id
      ),
      current_user_deposits AS MATERIALIZED (
        SELECT
          relevant.authority,
          SUM(
            COALESCE(reserve.amount_raw, 0::bigint)
            + COALESCE(idle.amount_raw, 0::bigint)
          )::bigint AS current_deposit_raw
        FROM relevant_vaults AS relevant
        LEFT JOIN current_reserve_by_vault AS reserve
          ON reserve.vault_id = relevant.vault_id
        LEFT JOIN current_idle_by_vault AS idle
          ON idle.vault_id = relevant.vault_id
        GROUP BY relevant.authority
      ),
      ranked_users AS MATERIALIZED (
        SELECT
          executed_user.authority,
          COALESCE(deposit_total.current_deposit_raw, 0::bigint)
            AS current_deposit_raw,
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(deposit_total.current_deposit_raw, 0::bigint) ASC,
              executed_user.authority ASC
          )::integer AS user_rank
        FROM executed_users AS executed_user
        LEFT JOIN current_user_deposits AS deposit_total
          ON deposit_total.authority = executed_user.authority
      )
      SELECT
        executed.id::text,
        executed.executed_at,
        executed.amount_raw::text,
        executed.source_reserve,
        executed.target_reserve,
        executed.liquidity_mint,
        executed.confirmed_slot::text,
        executed.authority,
        ranked_users.current_deposit_raw::text,
        ranked_users.user_rank::text,
        MAX(ranked_users.user_rank) OVER ()::text AS user_count
      FROM executed
      INNER JOIN ranked_users
        ON ranked_users.authority = executed.authority
      ORDER BY executed.executed_at ASC, executed.id ASC
    `
  );

  return {
    executions: rows.map((row) => ({
      amountRaw: toBigInt(row.amount_raw),
      authority: row.authority,
      confirmedSlot: toBigInt(row.confirmed_slot),
      currentDepositRaw: toBigInt(row.current_deposit_raw),
      executedAt: toIsoString(row.executed_at) ?? "",
      id: row.id,
      liquidityMint: row.liquidity_mint,
      sourceReserve: row.source_reserve,
      targetReserve: row.target_reserve,
      userRank: toNumber(row.user_rank),
    })),
    generatedAt: new Date().toISOString(),
    userCount: rows.length > 0 ? toNumber(rows[0].user_count) : 0,
  };
}

export async function getEarnVaultRebalanceFrequency(): Promise<EarnVaultRebalanceFrequency> {
  const rows = await queryRows<EarnVaultRebalanceFrequencySqlRow>(
    `
      WITH active_vaults AS MATERIALIZED (
        SELECT id, vault_pubkey
        FROM loyal_yield.managed_vaults
        WHERE active = true
          AND vault_index = 1
      ),
      normalized_positions AS MATERIALIZED (
        SELECT
          position.vault_id,
          position.reserve,
          position.liquidity_mint,
          position.observed_at,
          CASE
            WHEN COALESCE(
              position.planning_metadata->>'amountSemantics',
              position.planning_metadata->>'amount_semantics'
            ) IN (
              'kamino_redeemable_liquidity',
              'redeemable_liquidity_amount'
            )
              THEN position.amount_raw
            WHEN COALESCE(
              position.planning_metadata->>'amountSemantics',
              position.planning_metadata->>'amount_semantics'
            ) = 'kamino_obligation_collateral_deposited_amount'
              AND COALESCE(
                position.planning_metadata->>'redeemable_liquidity_amount_raw',
                position.planning_metadata->>'redeemable_source_liquidity_amount_raw'
              ) ~ '^[0-9]+$'
              THEN COALESCE(
                position.planning_metadata->>'redeemable_liquidity_amount_raw',
                position.planning_metadata->>'redeemable_source_liquidity_amount_raw'
              )::bigint
            ELSE 0::bigint
          END AS normalized_amount_raw
        FROM active_vaults AS vault
        INNER JOIN LATERAL (
          SELECT position.*
          FROM loyal_yield.vault_reserve_positions_current AS position
          WHERE position.vault_id = vault.id
            AND position.has_value = true
            AND position.amount_raw > 0
          OFFSET 0
        ) AS position ON true
      ),
      positive_positions AS MATERIALIZED (
        SELECT *
        FROM normalized_positions
        WHERE normalized_amount_raw > 0
      ),
      position_totals AS MATERIALIZED (
        SELECT
          vault_id,
          SUM(normalized_amount_raw)::bigint AS amount_raw,
          COUNT(*)::integer AS position_count
        FROM positive_positions
        GROUP BY vault_id
      ),
      primary_positions AS MATERIALIZED (
        SELECT vault_id, reserve, liquidity_mint
        FROM (
          SELECT
            position.*,
            ROW_NUMBER() OVER (
              PARTITION BY position.vault_id
              ORDER BY
                position.normalized_amount_raw DESC,
                position.observed_at DESC NULLS LAST,
                position.reserve ASC
            ) AS priority
          FROM positive_positions AS position
        ) AS ranked
        WHERE priority = 1
      ),
      positive_idle AS MATERIALIZED (
        SELECT idle.*
        FROM active_vaults AS vault
        INNER JOIN LATERAL (
          SELECT idle.*
          FROM loyal_yield.vault_idle_token_balances_current AS idle
          WHERE idle.vault_id = vault.id
            AND idle.amount_raw > 0
          OFFSET 0
        ) AS idle ON true
      ),
      idle_totals AS MATERIALIZED (
        SELECT vault_id, SUM(amount_raw)::bigint AS amount_raw
        FROM positive_idle
        GROUP BY vault_id
      ),
      primary_idle AS MATERIALIZED (
        SELECT vault_id, mint
        FROM (
          SELECT
            idle.*,
            ROW_NUMBER() OVER (
              PARTITION BY idle.vault_id
              ORDER BY
                idle.amount_raw DESC,
                idle.observed_at DESC NULLS LAST,
                idle.mint ASC
            ) AS priority
          FROM positive_idle AS idle
        ) AS ranked
        WHERE priority = 1
      ),
      rebalance_counts AS MATERIALIZED (
        SELECT
          decision.vault_id,
          COUNT(*)::integer AS all_count,
          COUNT(*) FILTER (
            WHERE decision.updated_at >= NOW() - INTERVAL '7 days'
          )::integer AS last_7d_count,
          COUNT(*) FILTER (
            WHERE decision.updated_at >= NOW() - INTERVAL '12 hours'
          )::integer AS last_12h_count,
          COUNT(*) FILTER (
            WHERE decision.updated_at >= NOW() - INTERVAL '2 hours'
          )::integer AS last_2h_count
        FROM loyal_yield.rebalance_decisions AS decision
        WHERE decision.status = 'confirmed'
          AND decision.source_reserve IS NOT NULL
          AND decision.target_reserve IS NOT NULL
        GROUP BY decision.vault_id
      ),
      opportunity_counts AS MATERIALIZED (
        SELECT
          opportunity.vault_id,
          COUNT(*)::integer AS all_count,
          COUNT(*) FILTER (
            WHERE opportunity.created_at >= NOW() - INTERVAL '7 days'
          )::integer AS last_7d_count,
          COUNT(*) FILTER (
            WHERE opportunity.created_at >= NOW() - INTERVAL '12 hours'
          )::integer AS last_12h_count,
          COUNT(*) FILTER (
            WHERE opportunity.created_at >= NOW() - INTERVAL '2 hours'
          )::integer AS last_2h_count
        FROM loyal_yield.rebalance_opportunities AS opportunity
        GROUP BY opportunity.vault_id
      ),
      current_vaults AS MATERIALIZED (
        SELECT
          vault.id,
          vault.vault_pubkey,
          primary_position.reserve AS current_reserve,
          COALESCE(primary_position.liquidity_mint, primary_idle.mint)
            AS liquidity_mint,
          COALESCE(position_total.amount_raw, 0::bigint)
            + COALESCE(idle_total.amount_raw, 0::bigint)
            AS current_deposit_raw,
          COALESCE(position_total.position_count, 0) AS position_count,
          COALESCE(rebalance.all_count, 0) AS all_count,
          COALESCE(rebalance.last_7d_count, 0) AS last_7d_count,
          COALESCE(rebalance.last_12h_count, 0) AS last_12h_count,
          COALESCE(rebalance.last_2h_count, 0) AS last_2h_count,
          COALESCE(opportunity.all_count, 0) AS opportunity_all_count,
          COALESCE(opportunity.last_7d_count, 0) AS opportunity_last_7d_count,
          COALESCE(opportunity.last_12h_count, 0) AS opportunity_last_12h_count,
          COALESCE(opportunity.last_2h_count, 0) AS opportunity_last_2h_count
        FROM active_vaults AS vault
        LEFT JOIN position_totals AS position_total
          ON position_total.vault_id = vault.id
        LEFT JOIN primary_positions AS primary_position
          ON primary_position.vault_id = vault.id
        LEFT JOIN idle_totals AS idle_total
          ON idle_total.vault_id = vault.id
        LEFT JOIN primary_idle
          ON primary_idle.vault_id = vault.id
        LEFT JOIN rebalance_counts AS rebalance
          ON rebalance.vault_id = vault.id
        LEFT JOIN opportunity_counts AS opportunity
          ON opportunity.vault_id = vault.id
        WHERE COALESCE(position_total.amount_raw, 0::bigint)
          + COALESCE(idle_total.amount_raw, 0::bigint) > 0
      ),
      ranked_vaults AS MATERIALIZED (
        SELECT
          current_vault.*,
          ROW_NUMBER() OVER (
            ORDER BY
              current_vault.current_deposit_raw ASC,
              current_vault.vault_pubkey ASC
          )::integer AS deposit_rank
        FROM current_vaults AS current_vault
      )
      SELECT
        ranked_vault.id::text AS vault_id,
        ranked_vault.vault_pubkey,
        ranked_vault.current_reserve,
        ranked_vault.liquidity_mint,
        ranked_vault.current_deposit_raw::text,
        ranked_vault.position_count::text,
        ranked_vault.all_count::text,
        ranked_vault.last_7d_count::text,
        ranked_vault.last_12h_count::text,
        ranked_vault.last_2h_count::text,
        ranked_vault.opportunity_all_count::text,
        ranked_vault.opportunity_last_7d_count::text,
        ranked_vault.opportunity_last_12h_count::text,
        ranked_vault.opportunity_last_2h_count::text,
        ranked_vault.deposit_rank::text,
        MAX(ranked_vault.deposit_rank) OVER ()::text AS vault_count
      FROM ranked_vaults AS ranked_vault
      ORDER BY ranked_vault.deposit_rank ASC
    `
  );

  return {
    generatedAt: new Date().toISOString(),
    vaultCount: rows.length > 0 ? toNumber(rows[0].vault_count) : 0,
    vaults: rows.map((row) => ({
      allCount: toNumber(row.all_count),
      currentDepositRaw: toBigInt(row.current_deposit_raw),
      currentReserve: row.current_reserve,
      depositRank: toNumber(row.deposit_rank),
      last12hCount: toNumber(row.last_12h_count),
      last2hCount: toNumber(row.last_2h_count),
      last7dCount: toNumber(row.last_7d_count),
      liquidityMint: row.liquidity_mint,
      opportunity12hCount: toNumber(row.opportunity_last_12h_count),
      opportunity2hCount: toNumber(row.opportunity_last_2h_count),
      opportunity7dCount: toNumber(row.opportunity_last_7d_count),
      opportunityAllCount: toNumber(row.opportunity_all_count),
      positionCount: toNumber(row.position_count),
      vaultId: row.vault_id,
      vaultPubkey: row.vault_pubkey,
    })),
  };
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
