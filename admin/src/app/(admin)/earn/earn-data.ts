import "server-only";

import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

const USDC_DECIMALS = 6;

export type EarnFlowPoint = {
  date: string;
  depositedRaw: bigint;
  netRaw: bigint;
  withdrawnRaw: bigint;
};

export type EarnPositionRow = {
  currentAmountRaw: bigint;
  currentObservedAt: string;
  currentReserve: string;
  principalAmountRaw: bigint;
  settings: string;
  walletAddress: string;
};

export type EarnFreshnessMetric = {
  label: string;
  timestamp: string | null;
};

export type EarnData = {
  activeAumRaw: bigint;
  activeAutodepositPolicies: number;
  activePrincipalRaw: bigint;
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
  topPositions: EarnPositionRow[];
  totalDeposited30dRaw: bigint;
  totalWithdrawn30dRaw: bigint;
  uniqueEarnPolicies: number;
  uniqueEarnUsers: number;
};

type HeadlineRow = {
  active_aum_raw: string | number | bigint | null;
  active_principal_raw: string | number | bigint | null;
  active_autodeposit_policies: string | number | bigint | null;
  unique_earn_policies: string | number | bigint | null;
  unique_earn_users: string | number | bigint | null;
};

type FlowRow = {
  day: string;
  deposited_raw: string | number | bigint | null;
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
  current_amount_raw: string | number | bigint;
  current_observed_at: Date | string;
  current_reserve: string;
  principal_amount_raw: string | number | bigint;
  settings: string;
  wallet_address: string;
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

  const [
    headlineRows,
    flowRows,
    statusRows,
    scheduledRows,
    executionRows,
    freshnessRows,
    positionRows,
  ] = await Promise.all([
    queryRows<HeadlineRow>(
      `
        SELECT
          (
            SELECT COALESCE(SUM(current_amount_raw), 0)::text
            FROM loyal_yield.user_yield_positions
            WHERE status = 'active'
          ) AS active_aum_raw,
          (
            SELECT COALESCE(SUM(principal_amount_raw), 0)::text
            FROM loyal_yield.user_yield_positions
            WHERE status = 'active'
          ) AS active_principal_raw,
          (
            SELECT COUNT(DISTINCT COALESCE(NULLIF(wallet_address, ''), settings))::text
            FROM loyal_yield.user_yield_positions
            WHERE status = 'active'
          ) AS unique_earn_users,
          (
            SELECT COUNT(DISTINCT policy_account)::text
            FROM loyal_yield.route_policies
            WHERE active = true
          ) AS unique_earn_policies,
          (
            SELECT COUNT(DISTINCT policy.policy_account)::text
            FROM loyal_yield.balance_sweep_policies AS policy
            INNER JOIN loyal_yield.balance_sweep_targets AS target
              ON target.balance_sweep_policy_id = policy.id
            WHERE policy.active = true
              AND target.active = true
              AND target.lifecycle_status = 'active'
          ) AS active_autodeposit_policies
      `
    ),
    queryRows<FlowRow>(
      `
        WITH bounds AS (
          SELECT
            ((date_trunc('day', now() AT TIME ZONE 'UTC')::date + 1) - 30)::date AS start_day,
            (date_trunc('day', now() AT TIME ZONE 'UTC')::date + 1)::date AS end_day
        ),
        days AS (
          SELECT generate_series(
            (SELECT start_day FROM bounds),
            (SELECT end_day FROM bounds) - 1,
            interval '1 day'
          )::date AS day
        ),
        deposits AS (
          SELECT
            (confirmed_at AT TIME ZONE 'UTC')::date AS day,
            SUM(principal_amount_raw) AS amount_raw
          FROM loyal_yield.user_yield_position_deposits
          WHERE confirmed_at >= (SELECT start_day FROM bounds)
            AND confirmed_at < (SELECT end_day FROM bounds)
          GROUP BY 1
        ),
        withdrawals AS (
          SELECT
            (confirmed_at AT TIME ZONE 'UTC')::date AS day,
            SUM(withdrawn_amount_raw) AS amount_raw
          FROM loyal_yield.user_yield_position_withdrawals
          WHERE confirmed_at >= (SELECT start_day FROM bounds)
            AND confirmed_at < (SELECT end_day FROM bounds)
          GROUP BY 1
        )
        SELECT
          to_char(days.day, 'YYYY-MM-DD') AS day,
          COALESCE(deposits.amount_raw, 0)::text AS deposited_raw,
          COALESCE(withdrawals.amount_raw, 0)::text AS withdrawn_raw
        FROM days
        LEFT JOIN deposits ON deposits.day = days.day
        LEFT JOIN withdrawals ON withdrawals.day = days.day
        ORDER BY days.day ASC
      `
    ),
    queryRows<AutodepositStatusRow>(
      `
        WITH classified AS (
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
        )
        SELECT status, COUNT(*)::text AS total
        FROM classified
        GROUP BY status
      `
    ),
    queryRows<ScheduledRow>(
      `
        SELECT
          (COUNT(*) FILTER (WHERE lot.status = 'open' AND lot.remaining_amount_raw > 0))::text AS open_lot_count,
          COALESCE(SUM(lot.remaining_amount_raw) FILTER (WHERE lot.status = 'open' AND lot.remaining_amount_raw > 0), 0)::text AS open_amount_raw,
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
      `
    ),
    queryRows<ExecutionRow>(
      `
        SELECT
          COUNT(*)::text AS count,
          COALESCE(SUM(amount_raw), 0)::text AS amount_raw,
          (COUNT(*) FILTER (WHERE received_at >= now() - interval '30 days'))::text AS count_30d,
          COALESCE(SUM(amount_raw) FILTER (WHERE received_at >= now() - interval '30 days'), 0)::text AS amount_30d_raw
        FROM loyal_yield.balance_sweep_executions
      `
    ),
    queryRows<FreshnessRow>(
      `
        SELECT
          (SELECT MAX(current_observed_at) FROM loyal_yield.user_yield_positions WHERE status = 'active') AS latest_position_observed_at,
          (
            SELECT MAX(target.last_seen_at)
            FROM loyal_yield.balance_sweep_targets AS target
            LEFT JOIN loyal_yield.balance_sweep_policies AS policy
              ON policy.id = target.balance_sweep_policy_id
            WHERE policy.active = true
              AND target.active = true
              AND target.lifecycle_status = 'active'
          ) AS latest_target_seen_at,
          (SELECT MAX(received_at) FROM loyal_yield.balance_sweep_executions) AS latest_sweep_execution_received_at,
          (SELECT MAX(observed_at) FROM loyal_yield.balance_sweep_wallet_balances_current) AS latest_wallet_balance_observed_at,
          (SELECT MAX(observed_at) FROM loyal_yield.balance_sweep_wallet_balance_events) AS latest_wallet_balance_event_observed_at,
          (SELECT MAX(projected_at) FROM loyal_yield.balance_sweep_wallet_balance_events) AS latest_wallet_balance_projected_at
      `
    ),
    queryRows<PositionRow>(
      `
        SELECT
          wallet_address,
          settings,
          current_reserve,
          current_amount_raw::text,
          principal_amount_raw::text,
          current_observed_at
        FROM loyal_yield.user_yield_positions
        WHERE status = 'active'
        ORDER BY current_amount_raw DESC, updated_at DESC
        LIMIT 25
      `
    ),
  ]);

  const headline = headlineRows[0];
  const scheduled = scheduledRows[0];
  const executions = executionRows[0];
  const autodepositStatusCounts = {
    active: 0,
    closed: 0,
    paused: 0,
    pending: 0,
  };

  for (const row of statusRows) {
    if (row.status in autodepositStatusCounts) {
      autodepositStatusCounts[
        row.status as keyof typeof autodepositStatusCounts
      ] = toNumber(row.total);
    }
  }

  const flow30d = flowRows.map((row) => {
    const depositedRaw = toBigInt(row.deposited_raw);
    const withdrawnRaw = toBigInt(row.withdrawn_raw);

    return {
      date: row.day,
      depositedRaw,
      netRaw: depositedRaw - withdrawnRaw,
      withdrawnRaw,
    };
  });

  return {
    activeAumRaw: toBigInt(headline?.active_aum_raw),
    activeAutodepositPolicies: toNumber(headline?.active_autodeposit_policies),
    activePrincipalRaw: toBigInt(headline?.active_principal_raw),
    autodepositExecutionAmount30dRaw: toBigInt(executions?.amount_30d_raw),
    autodepositExecutionAmountRaw: toBigInt(executions?.amount_raw),
    autodepositExecutionCount30d: toNumber(executions?.count_30d),
    autodepositExecutionCount: toNumber(executions?.count),
    autodepositStatusCounts,
    flow30d,
    freshness: createFreshnessMetrics(freshnessRows[0]),
    scheduledEligibleAmountRaw: toBigInt(scheduled?.eligible_amount_raw),
    scheduledEligibleLotCount: toNumber(scheduled?.eligible_lot_count),
    scheduledOpenAmountRaw: toBigInt(scheduled?.open_amount_raw),
    scheduledOpenLotCount: toNumber(scheduled?.open_lot_count),
    topPositions: positionRows.map((row) => ({
      currentAmountRaw: toBigInt(row.current_amount_raw),
      currentObservedAt: toIsoString(row.current_observed_at) ?? "",
      currentReserve: row.current_reserve,
      principalAmountRaw: toBigInt(row.principal_amount_raw),
      settings: row.settings,
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

export { USDC_DECIMALS };
