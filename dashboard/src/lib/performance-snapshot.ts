import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

const USDC_DECIMALS = 6;
const EARN_AUM_START_DATE = "2026-06-15";
const ACTIVE_EARN_HOLDINGS_CTE = `
  WITH active_positions AS (
    SELECT
      position.id AS position_id,
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
    INNER JOIN loyal_yield.vault_reserve_positions_current AS reserve
      ON reserve.vault_id = active.vault_id
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
      ), 0)::bigint AS normalized_reserve_raw
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
      active.principal_amount_raw,
      active.current_observed_at,
      COALESCE(reserve.normalized_reserve_raw, 0::bigint)
        AS normalized_reserve_raw,
      COALESCE(reserve.normalized_reserve_raw, 0::bigint)
        + COALESCE(idle.idle_raw, 0::bigint) AS normalized_aum_raw
    FROM active_positions AS active
    LEFT JOIN normalized_reserve_by_position AS reserve
      ON reserve.position_id = active.position_id
    LEFT JOIN idle_by_position AS idle
      ON idle.position_id = active.position_id
  )
`;

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const dateLabelFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

type AumSeriesRow = {
  aum_raw: string | number | bigint | null;
  week_end: string;
  week_start: string;
};

type OptimizationVolumeSeriesRow = {
  volume_raw: string | number | bigint | null;
  week_end: string;
  week_start: string;
};

type HeadlineRow = {
  active_aum_raw: string | number | bigint | null;
  active_user_earnings_raw: string | number | bigint | null;
  balance_sweep_volume_raw: string | number | bigint | null;
  optimization_volume_raw: string | number | bigint | null;
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

function formatDateLabel(value: string) {
  return dateLabelFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

function formatDateRangeLabel(start: string, end: string) {
  return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
}

function formatUsdcRaw(raw: bigint) {
  const amount = Number(raw) / 10 ** USDC_DECIMALS;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(amount);
}

function rawToUsdc(raw: bigint) {
  return Number(raw) / 10 ** USDC_DECIMALS;
}

async function loadPublicPerformanceSnapshot() {
  const sql = getYieldNeonSql();
  const queryRows = <T>(query: string) =>
    sql.query(query) as unknown as Promise<T[]>;

  const [aumRows, optimizationVolumeRows, headlineRows] = await Promise.all([
    queryRows<AumSeriesRow>(
      `
        ${ACTIVE_EARN_HOLDINGS_CTE},
        current_bounds AS (
          SELECT date_trunc('day', now() AT TIME ZONE 'UTC')::date AS current_day
        ),
        current_aum AS (
          SELECT COALESCE(SUM(normalized_aum_raw), 0)::bigint AS aum_raw
          FROM normalized_active_positions
        ),
        raw_weeks AS (
          SELECT generated.week_start::date AS week_start
          FROM generate_series(
            DATE '${EARN_AUM_START_DATE}',
            date_trunc('week', now() AT TIME ZONE 'UTC')::date,
            interval '1 week'
          ) AS generated(week_start)
        ),
        weeks AS (
          SELECT
            raw_weeks.week_start,
            LEAST(
              (raw_weeks.week_start + interval '6 days')::date,
              (SELECT current_day FROM current_bounds)
            )::date AS week_end,
            LEAST(
              (
                (raw_weeks.week_start + interval '7 days')::timestamp
                AT TIME ZONE 'UTC'
              ),
              (
                ((SELECT current_day FROM current_bounds) + interval '1 day')::timestamp
                AT TIME ZONE 'UTC'
              )
            ) AS week_end_exclusive
          FROM raw_weeks
        ),
        latest_by_position AS (
          SELECT
            weeks.week_start,
            event.position_id,
            event.amount_raw,
            row_number() OVER (
              PARTITION BY weeks.week_start, event.position_id
              ORDER BY event.observed_at DESC, event.id DESC
            ) AS rank
          FROM weeks
          INNER JOIN loyal_yield.user_yield_position_holding_events AS event
            ON event.observed_at < weeks.week_end_exclusive
        )
        SELECT
          to_char(weeks.week_start, 'YYYY-MM-DD') AS week_start,
          to_char(weeks.week_end, 'YYYY-MM-DD') AS week_end,
          CASE
            WHEN weeks.week_end = (SELECT current_day FROM current_bounds)
              THEN (SELECT aum_raw FROM current_aum)
            ELSE COALESCE(SUM(latest.amount_raw), 0)::bigint
          END::text AS aum_raw
        FROM weeks
        LEFT JOIN latest_by_position AS latest
          ON latest.week_start = weeks.week_start
          AND latest.rank = 1
        GROUP BY weeks.week_start, weeks.week_end
        ORDER BY weeks.week_start ASC
      `
    ),
    queryRows<OptimizationVolumeSeriesRow>(
      `
        WITH current_bounds AS (
          SELECT date_trunc('day', now() AT TIME ZONE 'UTC')::date AS current_day
        ),
        raw_weeks AS (
          SELECT generated.week_start::date AS week_start
          FROM generate_series(
            DATE '${EARN_AUM_START_DATE}',
            date_trunc('week', now() AT TIME ZONE 'UTC')::date,
            interval '1 week'
          ) AS generated(week_start)
        ),
        weeks AS (
          SELECT
            raw_weeks.week_start,
            (raw_weeks.week_start::timestamp AT TIME ZONE 'UTC')
              AS week_start_inclusive,
            LEAST(
              (raw_weeks.week_start + interval '6 days')::date,
              (SELECT current_day FROM current_bounds)
            )::date AS week_end,
            LEAST(
              (
                (raw_weeks.week_start + interval '7 days')::timestamp
                AT TIME ZONE 'UTC'
              ),
              (
                ((SELECT current_day FROM current_bounds) + interval '1 day')::timestamp
                AT TIME ZONE 'UTC'
              )
            ) AS week_end_exclusive
          FROM raw_weeks
        )
        SELECT
          to_char(weeks.week_start, 'YYYY-MM-DD') AS week_start,
          to_char(weeks.week_end, 'YYYY-MM-DD') AS week_end,
          COALESCE(SUM(decision.amount_raw), 0)::text AS volume_raw
        FROM weeks
        LEFT JOIN loyal_yield.rebalance_decisions AS decision
          ON decision.status = 'confirmed'
          AND decision.signature IS NOT NULL
          AND decision.amount_raw IS NOT NULL
          AND decision.updated_at >= weeks.week_start_inclusive
          AND decision.updated_at < weeks.week_end_exclusive
        GROUP BY weeks.week_start, weeks.week_end
        ORDER BY weeks.week_start ASC
      `
    ),
    queryRows<HeadlineRow>(
      `
        ${ACTIVE_EARN_HOLDINGS_CTE}
        SELECT
          COALESCE(SUM(normalized_aum_raw), 0)::text AS active_aum_raw,
          COALESCE(
            SUM(normalized_reserve_raw - principal_amount_raw),
            0
          )::text AS active_user_earnings_raw,
          (
            SELECT COALESCE(SUM(execution.amount_raw), 0)::text
            FROM loyal_yield.balance_sweep_executions AS execution
          ) AS balance_sweep_volume_raw,
          (
            SELECT COALESCE(SUM(decision.amount_raw), 0)::text
            FROM loyal_yield.rebalance_decisions AS decision
            WHERE decision.status = 'confirmed'
              AND decision.signature IS NOT NULL
              AND decision.amount_raw IS NOT NULL
          ) AS optimization_volume_raw
        FROM normalized_active_positions
      `
    ),
  ]);

  const earnAumSeries = aumRows.map((row) => {
    const raw = toBigInt(row.aum_raw);

    return {
      label: formatDateLabel(row.week_start),
      periodLabel: formatDateRangeLabel(row.week_start, row.week_end),
      value: rawToUsdc(raw),
      valueRaw: raw.toString(),
    };
  });
  const optimizationVolumeSeries = optimizationVolumeRows.map((row) => {
    const raw = toBigInt(row.volume_raw);

    return {
      label: formatDateLabel(row.week_start),
      periodLabel: formatDateRangeLabel(row.week_start, row.week_end),
      value: rawToUsdc(raw),
      valueRaw: raw.toString(),
    };
  });
  const headline = headlineRows[0];

  return {
    updatedAt: `${dateTimeFormatter.format(new Date())} UTC`,
    metrics: [
      {
        label: "Earn AUM",
        value: formatUsdcRaw(toBigInt(headline?.active_aum_raw)),
        detail: "Current normalized Earn AUM.",
        tooltip:
          "Cumulative value deposited into our active Earn routing policies.",
      },
      {
        label: "Optimization Volume",
        value: formatUsdcRaw(toBigInt(headline?.optimization_volume_raw)),
        detail: "Cumulative confirmed moved volume.",
        tooltip:
          "Total USDC reallocated by confirmed Earn optimizations. This measures routing throughput across reserves, so the same deposited dollar can add to volume again when it is moved by a later optimization.",
      },
      {
        label: "User Earnings",
        value: formatUsdcRaw(toBigInt(headline?.active_user_earnings_raw)),
        detail: "Current net earned on active deposits.",
        tooltip:
          "Current reserve value above active principal, excluding idle vault USDC. This is active on-reserve earned value, not lifetime realized withdrawals.",
      },
      {
        label: "Balance Sweep Volume",
        value: formatUsdcRaw(toBigInt(headline?.balance_sweep_volume_raw)),
        detail: "Cumulative balance sweep volume.",
        tooltip:
          "Cumulative USDC moved by balance sweep executions from user wallets into Earn vaults through autodeposit.",
      },
    ],
    earnAumSeries,
    optimizationVolumeSeries,
  };
}

export async function getPublicPerformanceSnapshot() {
  return loadPublicPerformanceSnapshot();
}
