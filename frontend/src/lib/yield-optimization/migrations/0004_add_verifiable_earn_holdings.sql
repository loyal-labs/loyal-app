CREATE TYPE loyal_yield.user_yield_holding_event_type AS ENUM (
  'deposit_initialized',
  'deposit_top_up',
  'withdrawal_partial',
  'withdrawal_full',
  'rebalance_confirmed',
  'snapshot_reconciled'
);

ALTER TABLE loyal_yield.user_yield_positions
  RENAME COLUMN target_reserve TO initial_reserve;

ALTER TABLE loyal_yield.user_yield_positions
  RENAME COLUMN market TO initial_market;

ALTER TABLE loyal_yield.user_yield_positions
  RENAME COLUMN liquidity_mint TO initial_liquidity_mint;

ALTER TABLE loyal_yield.user_yield_positions
  RENAME COLUMN target_supply_apy_bps TO initial_supply_apy_bps;

ALTER INDEX loyal_yield.user_yield_positions_target_uidx
  RENAME TO user_yield_positions_initial_uidx;

ALTER TABLE loyal_yield.user_yield_positions
  ADD COLUMN current_reserve TEXT,
  ADD COLUMN current_market TEXT,
  ADD COLUMN current_liquidity_mint TEXT,
  ADD COLUMN current_amount_raw BIGINT,
  ADD COLUMN current_observed_slot BIGINT,
  ADD COLUMN current_observed_at TIMESTAMPTZ,
  ADD COLUMN last_holding_event_id BIGINT,
  ADD COLUMN last_rebalance_decision_id BIGINT;

UPDATE loyal_yield.user_yield_positions
SET
  current_reserve = initial_reserve,
  current_market = initial_market,
  current_liquidity_mint = initial_liquidity_mint,
  current_amount_raw = principal_amount_raw,
  current_observed_slot = last_confirmed_slot,
  current_observed_at = updated_at
WHERE current_reserve IS NULL;

ALTER TABLE loyal_yield.user_yield_positions
  ALTER COLUMN current_reserve SET NOT NULL,
  ALTER COLUMN current_liquidity_mint SET NOT NULL,
  ALTER COLUMN current_amount_raw SET NOT NULL,
  ALTER COLUMN current_observed_slot SET NOT NULL,
  ALTER COLUMN current_observed_at SET NOT NULL;

CREATE TABLE loyal_yield.user_yield_position_holding_events (
  id BIGSERIAL PRIMARY KEY,
  position_id BIGINT NOT NULL REFERENCES loyal_yield.user_yield_positions(id),
  event_type loyal_yield.user_yield_holding_event_type NOT NULL,
  reserve TEXT NOT NULL,
  market TEXT,
  liquidity_mint TEXT NOT NULL,
  amount_raw BIGINT NOT NULL,
  principal_delta_raw BIGINT,
  holding_delta_raw BIGINT,
  observed_slot BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  source_signature TEXT,
  source_deposit_id BIGINT REFERENCES loyal_yield.user_yield_position_deposits(id),
  source_withdrawal_id BIGINT REFERENCES loyal_yield.user_yield_position_withdrawals(id),
  source_rebalance_decision_id BIGINT REFERENCES loyal_yield.rebalance_decisions(id),
  source_snapshot_id BIGINT REFERENCES loyal_yield.vault_position_snapshots(id),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT user_yield_position_holding_events_provenance_chk CHECK (
    source_signature IS NOT NULL
    OR source_deposit_id IS NOT NULL
    OR source_withdrawal_id IS NOT NULL
    OR source_rebalance_decision_id IS NOT NULL
    OR source_snapshot_id IS NOT NULL
  ),
  CONSTRAINT user_yield_position_holding_events_rebalance_source_chk CHECK (
    event_type <> 'rebalance_confirmed'
    OR (
      source_rebalance_decision_id IS NOT NULL
      AND source_snapshot_id IS NOT NULL
    )
  )
);

WITH inserted_holding_events AS (
  INSERT INTO loyal_yield.user_yield_position_holding_events (
    position_id,
    event_type,
    reserve,
    market,
    liquidity_mint,
    amount_raw,
    principal_delta_raw,
    holding_delta_raw,
    observed_slot,
    observed_at,
    source_signature,
    source_deposit_id,
    source_withdrawal_id,
    source_rebalance_decision_id,
    source_snapshot_id,
    created_at
  )
  SELECT
    p.id,
    'snapshot_reconciled'::loyal_yield.user_yield_holding_event_type,
    p.current_reserve,
    p.current_market,
    p.current_liquidity_mint,
    p.current_amount_raw,
    NULL,
    NULL,
    p.current_observed_slot,
    p.current_observed_at,
    p.last_deposit_signature,
    latest_deposit.id,
    NULL,
    NULL,
    NULL,
    NOW()
  FROM loyal_yield.user_yield_positions p
  LEFT JOIN LATERAL (
    SELECT deposit.id
    FROM loyal_yield.user_yield_position_deposits deposit
    WHERE deposit.settings = p.settings
      AND deposit.vault_index = p.vault_index
      AND deposit.target_reserve = p.initial_reserve
      AND deposit.wallet_address = p.wallet_address
    ORDER BY deposit.confirmed_slot DESC, deposit.confirmed_at DESC, deposit.id DESC
    LIMIT 1
  ) latest_deposit ON TRUE
  WHERE p.last_holding_event_id IS NULL
  RETURNING id, position_id
)
UPDATE loyal_yield.user_yield_positions p
SET last_holding_event_id = inserted_holding_events.id
FROM inserted_holding_events
WHERE p.id = inserted_holding_events.position_id;

CREATE INDEX user_yield_position_holding_events_position_idx
  ON loyal_yield.user_yield_position_holding_events (
    position_id,
    observed_slot,
    observed_at,
    id
  );

ALTER TABLE loyal_yield.user_yield_positions
  ADD CONSTRAINT user_yield_positions_last_holding_event_fk
  FOREIGN KEY (last_holding_event_id)
  REFERENCES loyal_yield.user_yield_position_holding_events(id);

ALTER TABLE loyal_yield.user_yield_positions
  ADD CONSTRAINT user_yield_positions_last_rebalance_decision_fk
  FOREIGN KEY (last_rebalance_decision_id)
  REFERENCES loyal_yield.rebalance_decisions(id);
