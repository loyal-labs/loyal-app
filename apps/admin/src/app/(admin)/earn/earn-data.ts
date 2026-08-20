import "server-only";

import {
  EARN_STABLECOIN_DESCRIPTORS,
  STABLECOIN_DECIMALS,
  type EarnStablecoinSymbol,
} from "@/lib/earn/stablecoin-monitor.shared";
import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

const STABLE_MINT_VALUES_SQL = EARN_STABLECOIN_DESCRIPTORS.map(
  ({ mint }) => `('${mint}')`
).join(", ");
const ACTIVE_EARN_HOLDINGS_CTE = `
  WITH active_positions AS (
    SELECT
      position.id AS position_id,
      position.wallet_address,
      position.settings,
      position.vault_index,
      position.vault_pubkey,
      position.current_reserve,
      position.current_amount_raw,
      position.principal_amount_raw,
      position.current_observed_at,
      position.deposit_mint,
      vault.id AS vault_id
    FROM loyal_yield.user_yield_positions AS position
    LEFT JOIN loyal_yield.managed_vaults AS vault
      ON vault.settings = position.settings
      AND vault.vault_index = position.vault_index
      AND vault.vault_pubkey = position.vault_pubkey
      AND vault.active = true
    WHERE position.status = 'active'
  ),
  reserve_rows AS (
    SELECT
      active.position_id,
      reserve.amount_raw,
      COALESCE(
        reserve.planning_metadata->>'amountSemantics',
        reserve.planning_metadata->>'amount_semantics'
      ) AS amount_semantics,
      COALESCE(
        reserve.planning_metadata->>'redeemable_liquidity_amount_raw',
        reserve.planning_metadata->>'redeemable_source_liquidity_amount_raw'
      ) AS redeemable_amount_raw_text
    FROM active_positions AS active
    CROSS JOIN LATERAL (
      SELECT
        reserve.amount_raw,
        reserve.planning_metadata,
        reserve.liquidity_mint,
        reserve.vault_id
      FROM loyal_yield.vault_reserve_positions_current AS reserve
      WHERE reserve.vault_id = active.vault_id
        AND reserve.liquidity_mint = active.deposit_mint
    ) AS reserve
  ),
  normalized_reserve_by_position AS (
    SELECT
      position_id,
      COALESCE(SUM(
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
        END
      ), 0)::bigint AS normalized_reserve_raw,
      COALESCE(SUM(
        CASE
          WHEN amount_semantics = 'kamino_obligation_collateral_deposited_amount'
            THEN amount_raw
          ELSE 0::bigint
        END
      ), 0)::bigint AS collateral_stored_amount_raw,
      COALESCE(SUM(
        CASE
          WHEN amount_semantics = 'kamino_obligation_collateral_deposited_amount'
            AND (
              redeemable_amount_raw_text IS NULL
              OR redeemable_amount_raw_text !~ '^[0-9]+$'
            )
            THEN amount_raw
          WHEN amount_semantics IS NULL
            OR amount_semantics NOT IN (
              'kamino_redeemable_liquidity',
              'redeemable_liquidity_amount',
              'kamino_obligation_collateral_deposited_amount'
            )
            THEN amount_raw
          ELSE 0::bigint
        END
      ), 0)::bigint AS excluded_reserve_raw,
      COUNT(*) FILTER (
        WHERE amount_semantics IN (
          'kamino_redeemable_liquidity',
          'redeemable_liquidity_amount'
        )
      )::bigint AS redeemable_reserve_rows,
      COUNT(*) FILTER (
        WHERE amount_semantics = 'kamino_obligation_collateral_deposited_amount'
      )::bigint AS collateral_reserve_rows,
      COUNT(*) FILTER (
        WHERE amount_semantics = 'kamino_obligation_collateral_deposited_amount'
          AND (
            redeemable_amount_raw_text IS NULL
            OR redeemable_amount_raw_text !~ '^[0-9]+$'
          )
      )::bigint AS missing_redeemable_metadata_rows,
      COUNT(*) FILTER (
        WHERE amount_semantics IS NULL
          OR amount_semantics NOT IN (
            'kamino_redeemable_liquidity',
            'redeemable_liquidity_amount',
            'kamino_obligation_collateral_deposited_amount'
          )
      )::bigint AS unknown_reserve_semantics_rows
    FROM reserve_rows
    GROUP BY position_id
  ),
  idle_by_position AS (
    SELECT
      active.position_id,
      COALESCE(SUM(idle.amount_raw), 0)::bigint AS idle_raw
    FROM active_positions AS active
    INNER JOIN loyal_yield.vault_idle_token_balances_current AS idle
      ON idle.vault_id = active.vault_id
      AND idle.mint = active.deposit_mint
    GROUP BY active.position_id
  ),
  normalized_active_positions AS (
    SELECT
      active.position_id,
      active.wallet_address,
      active.settings,
      active.deposit_mint,
      active.current_reserve,
      active.current_amount_raw,
      active.principal_amount_raw,
      active.current_observed_at,
      COALESCE(reserve.normalized_reserve_raw, 0::bigint)
        AS normalized_reserve_raw,
      COALESCE(idle.idle_raw, 0::bigint) AS idle_raw,
      COALESCE(reserve.normalized_reserve_raw, 0::bigint)
        + COALESCE(idle.idle_raw, 0::bigint) AS normalized_aum_raw,
      COALESCE(reserve.collateral_stored_amount_raw, 0::bigint)
        AS collateral_stored_amount_raw,
      COALESCE(reserve.excluded_reserve_raw, 0::bigint)
        AS excluded_reserve_raw,
      COALESCE(reserve.redeemable_reserve_rows, 0::bigint)
        AS redeemable_reserve_rows,
      COALESCE(reserve.collateral_reserve_rows, 0::bigint)
        AS collateral_reserve_rows,
      COALESCE(reserve.missing_redeemable_metadata_rows, 0::bigint)
        AS missing_redeemable_metadata_rows,
      COALESCE(reserve.unknown_reserve_semantics_rows, 0::bigint)
        AS unknown_reserve_semantics_rows,
      CASE WHEN active.vault_id IS NULL THEN 1::bigint ELSE 0::bigint END
        AS missing_managed_vault_rows,
      COALESCE(reserve.normalized_reserve_raw, 0::bigint)
        + COALESCE(idle.idle_raw, 0::bigint)
        - active.current_amount_raw AS current_pointer_delta_raw
    FROM active_positions AS active
    LEFT JOIN normalized_reserve_by_position AS reserve
      ON reserve.position_id = active.position_id
    LEFT JOIN idle_by_position AS idle
      ON idle.position_id = active.position_id
  )
`;

export type EarnFlowPoint = {
  date: string;
  depositedRaw: bigint;
  liquidityMint: string;
  netRaw: bigint;
  withdrawnRaw: bigint;
};

export type EarnPositionRow = {
  collateralReserveRows: number;
  collateralStoredAmountRaw: bigint;
  currentObservedAt: string;
  currentPointerDeltaRaw: bigint;
  currentReserve: string;
  depositMint: string;
  excludedReserveRaw: bigint;
  idleAmountRaw: bigint;
  missingManagedVaultRows: number;
  missingRedeemableMetadataRows: number;
  normalizedAumRaw: bigint;
  normalizedReserveRaw: bigint;
  principalAmountRaw: bigint;
  redeemableReserveRows: number;
  settings: string;
  storedCurrentPointerRaw: bigint;
  unknownReserveSemanticsRows: number;
  walletAddress: string;
};

export type EarnStablecoinSummary = {
  activeAumRaw: bigint;
  activeExcludedReserveRaw: bigint;
  activeIdleRaw: bigint;
  activePositionCount: number;
  activePrincipalRaw: bigint;
  activeReserveRaw: bigint;
  activeStoredCurrentPointerRaw: bigint;
  currentPointerDeltaRaw: bigint;
  deposited30dRaw: bigint;
  latestRebalanceAt: string | null;
  liquidityMint: string;
  symbol: EarnStablecoinSymbol;
  withdrawn30dRaw: bigint;
};

export type EarnFreshnessMetric = {
  label: string;
  timestamp: string | null;
};

export type EarnData = {
  activeAumRaw: bigint;
  activeAutodepositPolicies: number;
  activeCollateralStoredAmountRaw: bigint;
  activeCurrentPointerDeltaRaw: bigint;
  activeExcludedReserveRaw: bigint;
  activeIdleRaw: bigint;
  activeMissingManagedVaultRows: number;
  activeMissingRedeemableMetadataRows: number;
  activePrincipalRaw: bigint;
  activeRedeemableReserveRows: number;
  activeCollateralReserveRows: number;
  activeReserveRaw: bigint;
  activeStoredCurrentPointerRaw: bigint;
  activeUnknownReserveSemanticsRows: number;
  autodepositExecutionAmount30dRaw: bigint;
  autodepositExecutionAmountRaw: bigint;
  autodepositExecutionCount30d: number;
  autodepositExecutionCount: number;
  autodepositStatusCounts: {
    active: number;
    closed: number;
    paused: number;
    pending: number;
  };
  flow30d: EarnFlowPoint[];
  freshness: EarnFreshnessMetric[];
  scheduledEligibleAmountRaw: bigint;
  scheduledEligibleLotCount: number;
  scheduledOpenAmountRaw: bigint;
  scheduledOpenLotCount: number;
  stablecoins: EarnStablecoinSummary[];
  topPositions: EarnPositionRow[];
  totalDeposited30dRaw: bigint;
  totalWithdrawn30dRaw: bigint;
  uniqueEarnPolicies: number;
  uniqueEarnUsers: number;
};

type HeadlineRow = {
  active_aum_raw: string | number | bigint | null;
  active_collateral_stored_amount_raw: string | number | bigint | null;
  active_current_pointer_delta_raw: string | number | bigint | null;
  active_excluded_reserve_raw: string | number | bigint | null;
  active_idle_raw: string | number | bigint | null;
  active_missing_managed_vault_rows: string | number | bigint | null;
  active_missing_redeemable_metadata_rows: string | number | bigint | null;
  active_principal_raw: string | number | bigint | null;
  active_redeemable_reserve_rows: string | number | bigint | null;
  active_collateral_reserve_rows: string | number | bigint | null;
  active_reserve_raw: string | number | bigint | null;
  active_stored_current_pointer_raw: string | number | bigint | null;
  active_unknown_reserve_semantics_rows: string | number | bigint | null;
  active_autodeposit_policies: string | number | bigint | null;
  unique_earn_policies: string | number | bigint | null;
  unique_earn_users: string | number | bigint | null;
};

type FlowRow = {
  day: string;
  deposited_raw: string | number | bigint | null;
  liquidity_mint: string;
  withdrawn_raw: string | number | bigint | null;
};

type AutodepositStatusRow = {
  status: string;
  total: string | number | bigint | null;
};

type ScheduledRow = {
  eligible_amount_raw: string | number | bigint | null;
  eligible_lot_count: string | number | bigint | null;
  open_amount_raw: string | number | bigint | null;
  open_lot_count: string | number | bigint | null;
};

type ExecutionRow = {
  amount_30d_raw: string | number | bigint | null;
  amount_raw: string | number | bigint | null;
  count_30d: string | number | bigint | null;
  count: string | number | bigint | null;
};

type FreshnessRow = {
  latest_position_observed_at: Date | string | null;
  latest_target_seen_at: Date | string | null;
  latest_wallet_balance_event_observed_at: Date | string | null;
  latest_wallet_balance_observed_at: Date | string | null;
  latest_wallet_balance_projected_at: Date | string | null;
  latest_sweep_execution_received_at: Date | string | null;
};

type PositionRow = {
  collateral_reserve_rows: string | number | bigint;
  collateral_stored_amount_raw: string | number | bigint;
  current_observed_at: Date | string;
  current_pointer_delta_raw: string | number | bigint;
  current_reserve: string;
  deposit_mint: string;
  excluded_reserve_raw: string | number | bigint;
  idle_raw: string | number | bigint;
  missing_managed_vault_rows: string | number | bigint;
  missing_redeemable_metadata_rows: string | number | bigint;
  normalized_aum_raw: string | number | bigint;
  normalized_reserve_raw: string | number | bigint;
  principal_amount_raw: string | number | bigint;
  redeemable_reserve_rows: string | number | bigint;
  settings: string;
  stored_current_pointer_raw: string | number | bigint;
  unknown_reserve_semantics_rows: string | number | bigint;
  wallet_address: string;
};

type MintHoldingSummaryRow = {
  active_aum_raw: string | number | bigint | null;
  active_excluded_reserve_raw: string | number | bigint | null;
  active_idle_raw: string | number | bigint | null;
  active_position_count: string | number | bigint | null;
  active_principal_raw: string | number | bigint | null;
  active_reserve_raw: string | number | bigint | null;
  active_stored_current_pointer_raw: string | number | bigint | null;
  current_pointer_delta_raw: string | number | bigint | null;
  deposit_mint: string;
  latest_rebalance_at: Date | string | null;
};

type CombinedHoldingsRow = {
  headline: HeadlineRow | null;
  mint_summaries: MintHoldingSummaryRow[];
  top_positions: PositionRow[];
};

type SmallMetricsRow = {
  executions: ExecutionRow | null;
  flow: FlowRow[];
  freshness: FreshnessRow | null;
  scheduled: ScheduledRow | null;
  status: AutodepositStatusRow[];
};

function toBigInt(value: string | number | bigint | null | undefined): bigint {
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

function toNumber(value: string | number | bigint | null | undefined): number {
  return Number(toBigInt(value));
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function createFreshnessMetrics(
  row: FreshnessRow | undefined
): EarnFreshnessMetric[] {
  return [
    {
      label: "Earn positions",
      timestamp: toIsoString(row?.latest_position_observed_at),
    },
    {
      label: "Autodeposit targets",
      timestamp: toIsoString(row?.latest_target_seen_at),
    },
    {
      label: "Sweep executions",
      timestamp: toIsoString(row?.latest_sweep_execution_received_at),
    },
    {
      label: "Wallet balances current",
      timestamp: toIsoString(row?.latest_wallet_balance_observed_at),
    },
    {
      label: "Wallet balance events",
      timestamp: toIsoString(row?.latest_wallet_balance_event_observed_at),
    },
    {
      label: "Wallet balance projections",
      timestamp: toIsoString(row?.latest_wallet_balance_projected_at),
    },
  ];
}

async function loadEarnData(): Promise<EarnData> {
  const sql = getYieldNeonSql();
  const queryRows = <T>(query: string) =>
    sql.query(query) as unknown as Promise<T[]>;

  const combinedHoldingsQuery = `
    ${ACTIVE_EARN_HOLDINGS_CTE},
    holdings_by_mint AS (
      SELECT deposit_mint, COUNT(*)::text AS active_position_count,
        COALESCE(SUM(normalized_aum_raw), 0)::text AS active_aum_raw,
        COALESCE(SUM(excluded_reserve_raw), 0)::text AS active_excluded_reserve_raw,
        COALESCE(SUM(normalized_reserve_raw), 0)::text AS active_reserve_raw,
        COALESCE(SUM(idle_raw), 0)::text AS active_idle_raw,
        COALESCE(SUM(principal_amount_raw), 0)::text AS active_principal_raw,
        COALESCE(SUM(current_amount_raw), 0)::text AS active_stored_current_pointer_raw,
        COALESCE(SUM(current_pointer_delta_raw), 0)::text AS current_pointer_delta_raw
      FROM normalized_active_positions GROUP BY deposit_mint
    ),
    latest_rebalance_by_mint AS (
      SELECT liquidity_mint AS deposit_mint, MAX(updated_at) AS latest_rebalance_at
      FROM loyal_yield.rebalance_decisions
      WHERE status = 'confirmed' AND execution_plan->>'kind' = 'same_mint'
        AND liquidity_mint IS NOT NULL
      GROUP BY liquidity_mint
    ),
    mint_summary AS (
      SELECT COALESCE(holdings.deposit_mint, rebalance.deposit_mint) AS deposit_mint,
        COALESCE(holdings.active_position_count, '0') AS active_position_count,
        COALESCE(holdings.active_aum_raw, '0') AS active_aum_raw,
        COALESCE(holdings.active_excluded_reserve_raw, '0') AS active_excluded_reserve_raw,
        COALESCE(holdings.active_reserve_raw, '0') AS active_reserve_raw,
        COALESCE(holdings.active_idle_raw, '0') AS active_idle_raw,
        COALESCE(holdings.active_principal_raw, '0') AS active_principal_raw,
        COALESCE(holdings.active_stored_current_pointer_raw, '0') AS active_stored_current_pointer_raw,
        COALESCE(holdings.current_pointer_delta_raw, '0') AS current_pointer_delta_raw,
        rebalance.latest_rebalance_at
      FROM holdings_by_mint AS holdings
      FULL OUTER JOIN latest_rebalance_by_mint AS rebalance
        ON rebalance.deposit_mint = holdings.deposit_mint
    ),
    headline AS (
      SELECT COALESCE(SUM(normalized_aum_raw), 0)::text AS active_aum_raw,
        COALESCE(SUM(normalized_reserve_raw), 0)::text AS active_reserve_raw,
        COALESCE(SUM(idle_raw), 0)::text AS active_idle_raw,
        COALESCE(SUM(current_amount_raw), 0)::text AS active_stored_current_pointer_raw,
        COALESCE(SUM(current_pointer_delta_raw), 0)::text AS active_current_pointer_delta_raw,
        COALESCE(SUM(principal_amount_raw), 0)::text AS active_principal_raw,
        COALESCE(SUM(collateral_stored_amount_raw), 0)::text AS active_collateral_stored_amount_raw,
        COALESCE(SUM(excluded_reserve_raw), 0)::text AS active_excluded_reserve_raw,
        COALESCE(SUM(redeemable_reserve_rows), 0)::text AS active_redeemable_reserve_rows,
        COALESCE(SUM(collateral_reserve_rows), 0)::text AS active_collateral_reserve_rows,
        COALESCE(SUM(missing_redeemable_metadata_rows), 0)::text AS active_missing_redeemable_metadata_rows,
        COALESCE(SUM(unknown_reserve_semantics_rows), 0)::text AS active_unknown_reserve_semantics_rows,
        COALESCE(SUM(missing_managed_vault_rows), 0)::text AS active_missing_managed_vault_rows,
        (SELECT COUNT(DISTINCT COALESCE(NULLIF(wallet_address, ''), settings))::text FROM loyal_yield.user_yield_positions WHERE status = 'active') AS unique_earn_users,
        (SELECT COUNT(DISTINCT policy_account)::text FROM loyal_yield.route_policies WHERE active = true) AS unique_earn_policies,
        (SELECT COUNT(DISTINCT policy.policy_account)::text FROM loyal_yield.balance_sweep_policies AS policy
          INNER JOIN loyal_yield.balance_sweep_targets AS target ON target.balance_sweep_policy_id = policy.id
          WHERE policy.active = true AND target.active = true AND target.lifecycle_status = 'active') AS active_autodeposit_policies
      FROM normalized_active_positions
    ),
    top_positions AS (
      SELECT wallet_address, settings, deposit_mint, current_reserve,
        normalized_aum_raw::text, normalized_reserve_raw::text, idle_raw::text,
        current_amount_raw::text AS stored_current_pointer_raw,
        current_pointer_delta_raw::text, principal_amount_raw::text,
        collateral_stored_amount_raw::text, excluded_reserve_raw::text,
        redeemable_reserve_rows::text, collateral_reserve_rows::text,
        missing_redeemable_metadata_rows::text, unknown_reserve_semantics_rows::text,
        missing_managed_vault_rows::text, current_observed_at
      FROM normalized_active_positions
      ORDER BY normalized_aum_raw DESC, current_observed_at DESC LIMIT 25
    )
    SELECT (SELECT row_to_json(headline) FROM headline) AS headline,
      COALESCE((SELECT json_agg(mint_summary ORDER BY deposit_mint) FROM mint_summary), '[]'::json) AS mint_summaries,
      COALESCE((SELECT json_agg(top_positions ORDER BY normalized_aum_raw DESC, current_observed_at DESC) FROM top_positions), '[]'::json) AS top_positions
  `;

  const smallMetricsQuery = `
    WITH bounds AS (
      SELECT
        ((date_trunc('day', now() AT TIME ZONE 'UTC')::date + 1) - 30)::date AS start_day,
        (date_trunc('day', now() AT TIME ZONE 'UTC')::date + 1)::date AS end_day
    ),
    stable_mints(liquidity_mint) AS (
      VALUES ${STABLE_MINT_VALUES_SQL}
    ),
    days AS (
      SELECT generate_series(
        (SELECT start_day FROM bounds),
        (SELECT end_day FROM bounds) - 1,
        interval '1 day'
      )::date AS day
    ),
    confirmed_flow_events AS (
      SELECT
        (deposit.confirmed_at AT TIME ZONE 'UTC')::date AS day,
        'deposit'::text AS direction,
        'earn_deposit'::text AS source,
        deposit.id AS source_id,
        deposit.deposit_mint AS liquidity_mint,
        deposit.principal_amount_raw AS amount_raw
      FROM loyal_yield.user_yield_position_deposits AS deposit
      WHERE deposit.confirmed_at >= (SELECT start_day FROM bounds)
        AND deposit.confirmed_at < (SELECT end_day FROM bounds)
      UNION ALL
      SELECT
        (withdrawal.confirmed_at AT TIME ZONE 'UTC')::date AS day,
        'withdrawal'::text AS direction,
        'earn_withdrawal'::text AS source,
        withdrawal.id AS source_id,
        withdrawal.liquidity_mint,
        withdrawal.withdrawn_amount_raw AS amount_raw
      FROM loyal_yield.user_yield_position_withdrawals AS withdrawal
      WHERE withdrawal.confirmed_at >= (SELECT start_day FROM bounds)
        AND withdrawal.confirmed_at < (SELECT end_day FROM bounds)
    ),
    flow_by_day AS (
      SELECT
        day,
        liquidity_mint,
        SUM(amount_raw) FILTER (WHERE direction = 'deposit') AS deposited_raw,
        SUM(amount_raw) FILTER (WHERE direction = 'withdrawal') AS withdrawn_raw
      FROM confirmed_flow_events
      GROUP BY day, liquidity_mint
    ),
    flow_rows AS (
      SELECT
        to_char(days.day, 'YYYY-MM-DD') AS day,
        stable_mints.liquidity_mint,
        COALESCE(flow_by_day.deposited_raw, 0)::text AS deposited_raw,
        COALESCE(flow_by_day.withdrawn_raw, 0)::text AS withdrawn_raw
      FROM days
      CROSS JOIN stable_mints
      LEFT JOIN flow_by_day
        ON flow_by_day.day = days.day
        AND flow_by_day.liquidity_mint = stable_mints.liquidity_mint
    ),
    flow_json AS (
      SELECT COALESCE(
        json_agg(flow_rows ORDER BY flow_rows.day, flow_rows.liquidity_mint),
        '[]'::json
      ) AS value
      FROM flow_rows
    ),
    classified_statuses AS (
      SELECT
        CASE
          WHEN policy.active = true
            AND target.active = true
            AND target.lifecycle_status = 'active'
            THEN 'active'
          WHEN policy.active = true
            AND target.active = false
            AND target.lifecycle_status = 'active'
            THEN 'paused'
          WHEN target.lifecycle_status IN ('pending_delegation', 'closing')
            THEN 'pending'
          ELSE 'closed'
        END AS status
      FROM loyal_yield.balance_sweep_targets AS target
      LEFT JOIN loyal_yield.balance_sweep_policies AS policy
        ON policy.id = target.balance_sweep_policy_id
    ),
    status_json AS (
      SELECT COALESCE(
        json_agg(status_rows ORDER BY status_rows.status),
        '[]'::json
      ) AS value
      FROM (
        SELECT status, COUNT(*)::text AS total
        FROM classified_statuses
        GROUP BY status
      ) AS status_rows
    ),
    scheduled AS (
      SELECT
        (COUNT(*) FILTER (
          WHERE lot.status = 'open' AND lot.remaining_amount_raw > 0
        ))::text AS open_lot_count,
        COALESCE(SUM(lot.remaining_amount_raw) FILTER (
          WHERE lot.status = 'open' AND lot.remaining_amount_raw > 0
        ), 0)::text AS open_amount_raw,
        (COUNT(*) FILTER (
          WHERE lot.status = 'open'
            AND lot.remaining_amount_raw > 0
            AND lot.eligible_after <= now()
        ))::text AS eligible_lot_count,
        COALESCE(SUM(lot.remaining_amount_raw) FILTER (
          WHERE lot.status = 'open'
            AND lot.remaining_amount_raw > 0
            AND lot.eligible_after <= now()
        ), 0)::text AS eligible_amount_raw
      FROM loyal_yield.balance_sweep_surplus_lots AS lot
      INNER JOIN loyal_yield.balance_sweep_targets AS target
        ON target.id = lot.target_id
      LEFT JOIN loyal_yield.balance_sweep_policies AS policy
        ON policy.id = target.balance_sweep_policy_id
      WHERE policy.active = true
        AND target.active = true
        AND target.lifecycle_status = 'active'
    ),
    executions AS (
      SELECT
        COUNT(*)::text AS count,
        COALESCE(SUM(amount_raw), 0)::text AS amount_raw,
        (COUNT(*) FILTER (
          WHERE received_at >= now() - interval '30 days'
        ))::text AS count_30d,
        COALESCE(SUM(amount_raw) FILTER (
          WHERE received_at >= now() - interval '30 days'
        ), 0)::text AS amount_30d_raw
      FROM loyal_yield.balance_sweep_executions
    ),
    wallet_balance_event_freshness AS (
      SELECT
        (
          SELECT observed_at
          FROM loyal_yield.balance_sweep_wallet_balance_events
          ORDER BY observed_at DESC
          LIMIT 1
        ) AS latest_wallet_balance_event_observed_at,
        (
          SELECT projected_at
          FROM loyal_yield.balance_sweep_wallet_balance_events
          ORDER BY projected_at DESC
          LIMIT 1
        ) AS latest_wallet_balance_projected_at
    ),
    freshness AS (
      SELECT
        (SELECT MAX(current_observed_at)
         FROM loyal_yield.user_yield_positions
         WHERE status = 'active') AS latest_position_observed_at,
        (
          SELECT MAX(target.last_seen_at)
          FROM loyal_yield.balance_sweep_targets AS target
          LEFT JOIN loyal_yield.balance_sweep_policies AS policy
            ON policy.id = target.balance_sweep_policy_id
          WHERE policy.active = true
            AND target.active = true
            AND target.lifecycle_status = 'active'
        ) AS latest_target_seen_at,
        (SELECT MAX(received_at)
         FROM loyal_yield.balance_sweep_executions)
          AS latest_sweep_execution_received_at,
        (SELECT MAX(observed_at)
         FROM loyal_yield.balance_sweep_wallet_balances_current)
          AS latest_wallet_balance_observed_at,
        wallet_balance_event_freshness.latest_wallet_balance_event_observed_at,
        wallet_balance_event_freshness.latest_wallet_balance_projected_at
      FROM wallet_balance_event_freshness
    )
    SELECT
      (SELECT value FROM flow_json) AS flow,
      (SELECT value FROM status_json) AS status,
      (SELECT row_to_json(scheduled) FROM scheduled) AS scheduled,
      (SELECT row_to_json(executions) FROM executions) AS executions,
      (SELECT row_to_json(freshness) FROM freshness) AS freshness
  `;

  const [holdingsRows, smallMetricsRows] = await Promise.all([
    queryRows<CombinedHoldingsRow>(combinedHoldingsQuery),
    queryRows<SmallMetricsRow>(smallMetricsQuery),
  ]);

  const combinedHoldings = holdingsRows[0] ?? {
    headline: null,
    mint_summaries: [],
    top_positions: [],
  };
  const headline = combinedHoldings.headline;
  const mintHoldingSummaryRows = combinedHoldings.mint_summaries;
  const positionRows = combinedHoldings.top_positions;
  const smallMetrics = smallMetricsRows[0] ?? {
    executions: null,
    flow: [],
    freshness: null,
    scheduled: null,
    status: [],
  };
  const scheduled = smallMetrics.scheduled;
  const executions = smallMetrics.executions;
  const autodepositStatusCounts = {
    active: 0,
    closed: 0,
    paused: 0,
    pending: 0,
  };

  for (const row of smallMetrics.status) {
    if (row.status in autodepositStatusCounts) {
      autodepositStatusCounts[
        row.status as keyof typeof autodepositStatusCounts
      ] = toNumber(row.total);
    }
  }

  const flow30d = smallMetrics.flow.map((row) => {
    const depositedRaw = toBigInt(row.deposited_raw);
    const withdrawnRaw = toBigInt(row.withdrawn_raw);

    return {
      date: row.day,
      depositedRaw,
      liquidityMint: row.liquidity_mint,
      netRaw: depositedRaw - withdrawnRaw,
      withdrawnRaw,
    };
  });
  const mintHoldingSummaryByMint = new Map(
    mintHoldingSummaryRows.map((row) => [row.deposit_mint, row])
  );
  const stablecoins = EARN_STABLECOIN_DESCRIPTORS.map((descriptor) => {
    const holding = mintHoldingSummaryByMint.get(descriptor.mint);
    const mintFlow = flow30d.filter(
      (point) => point.liquidityMint === descriptor.mint
    );

    return {
      activeAumRaw: toBigInt(holding?.active_aum_raw),
      activeExcludedReserveRaw: toBigInt(holding?.active_excluded_reserve_raw),
      activeIdleRaw: toBigInt(holding?.active_idle_raw),
      activePositionCount: toNumber(holding?.active_position_count),
      activePrincipalRaw: toBigInt(holding?.active_principal_raw),
      activeReserveRaw: toBigInt(holding?.active_reserve_raw),
      activeStoredCurrentPointerRaw: toBigInt(
        holding?.active_stored_current_pointer_raw
      ),
      currentPointerDeltaRaw: toBigInt(holding?.current_pointer_delta_raw),
      deposited30dRaw: mintFlow.reduce(
        (total, point) => total + point.depositedRaw,
        BigInt(0)
      ),
      latestRebalanceAt: toIsoString(holding?.latest_rebalance_at),
      liquidityMint: descriptor.mint,
      symbol: descriptor.symbol,
      withdrawn30dRaw: mintFlow.reduce(
        (total, point) => total + point.withdrawnRaw,
        BigInt(0)
      ),
    };
  });

  return {
    activeAumRaw: toBigInt(headline?.active_aum_raw),
    activeAutodepositPolicies: toNumber(headline?.active_autodeposit_policies),
    activeCollateralStoredAmountRaw: toBigInt(
      headline?.active_collateral_stored_amount_raw
    ),
    activeCurrentPointerDeltaRaw: toBigInt(
      headline?.active_current_pointer_delta_raw
    ),
    activeExcludedReserveRaw: toBigInt(headline?.active_excluded_reserve_raw),
    activeIdleRaw: toBigInt(headline?.active_idle_raw),
    activeMissingManagedVaultRows: toNumber(
      headline?.active_missing_managed_vault_rows
    ),
    activeMissingRedeemableMetadataRows: toNumber(
      headline?.active_missing_redeemable_metadata_rows
    ),
    activePrincipalRaw: toBigInt(headline?.active_principal_raw),
    activeRedeemableReserveRows: toNumber(
      headline?.active_redeemable_reserve_rows
    ),
    activeCollateralReserveRows: toNumber(
      headline?.active_collateral_reserve_rows
    ),
    activeReserveRaw: toBigInt(headline?.active_reserve_raw),
    activeStoredCurrentPointerRaw: toBigInt(
      headline?.active_stored_current_pointer_raw
    ),
    activeUnknownReserveSemanticsRows: toNumber(
      headline?.active_unknown_reserve_semantics_rows
    ),
    autodepositExecutionAmount30dRaw: toBigInt(executions?.amount_30d_raw),
    autodepositExecutionAmountRaw: toBigInt(executions?.amount_raw),
    autodepositExecutionCount30d: toNumber(executions?.count_30d),
    autodepositExecutionCount: toNumber(executions?.count),
    autodepositStatusCounts,
    flow30d,
    freshness: createFreshnessMetrics(smallMetrics.freshness ?? undefined),
    scheduledEligibleAmountRaw: toBigInt(scheduled?.eligible_amount_raw),
    scheduledEligibleLotCount: toNumber(scheduled?.eligible_lot_count),
    scheduledOpenAmountRaw: toBigInt(scheduled?.open_amount_raw),
    scheduledOpenLotCount: toNumber(scheduled?.open_lot_count),
    stablecoins,
    topPositions: positionRows.map((row) => ({
      collateralReserveRows: toNumber(row.collateral_reserve_rows),
      collateralStoredAmountRaw: toBigInt(row.collateral_stored_amount_raw),
      currentObservedAt: toIsoString(row.current_observed_at) ?? "",
      currentPointerDeltaRaw: toBigInt(row.current_pointer_delta_raw),
      currentReserve: row.current_reserve,
      depositMint: row.deposit_mint,
      excludedReserveRaw: toBigInt(row.excluded_reserve_raw),
      idleAmountRaw: toBigInt(row.idle_raw),
      missingManagedVaultRows: toNumber(row.missing_managed_vault_rows),
      missingRedeemableMetadataRows: toNumber(
        row.missing_redeemable_metadata_rows
      ),
      normalizedAumRaw: toBigInt(row.normalized_aum_raw),
      normalizedReserveRaw: toBigInt(row.normalized_reserve_raw),
      principalAmountRaw: toBigInt(row.principal_amount_raw),
      redeemableReserveRows: toNumber(row.redeemable_reserve_rows),
      settings: row.settings,
      storedCurrentPointerRaw: toBigInt(row.stored_current_pointer_raw),
      unknownReserveSemanticsRows: toNumber(row.unknown_reserve_semantics_rows),
      walletAddress: row.wallet_address,
    })),
    totalDeposited30dRaw: flow30d.reduce(
      (total, point) => total + point.depositedRaw,
      BigInt(0)
    ),
    totalWithdrawn30dRaw: flow30d.reduce(
      (total, point) => total + point.withdrawnRaw,
      BigInt(0)
    ),
    uniqueEarnPolicies: toNumber(headline?.unique_earn_policies),
    uniqueEarnUsers: toNumber(headline?.unique_earn_users),
  };
}

export async function getEarnData(): Promise<EarnData> {
  return loadEarnData();
}

export { STABLECOIN_DECIMALS };
