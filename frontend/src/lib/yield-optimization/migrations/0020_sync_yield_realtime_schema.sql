ALTER TYPE loyal_yield.decision_reason
  ADD VALUE IF NOT EXISTS 'unsupported_amount_semantics';

ALTER TYPE loyal_yield.decision_reason
  ADD VALUE IF NOT EXISTS 'idle_vault_liquidity_available';

CREATE TABLE IF NOT EXISTS loyal_yield.balance_sweep_execution_lots (
  execution_id BIGINT NOT NULL REFERENCES loyal_yield.balance_sweep_executions(id) ON DELETE CASCADE,
  lot_id BIGINT NOT NULL REFERENCES loyal_yield.balance_sweep_surplus_lots(id) ON DELETE RESTRICT,
  amount_raw BIGINT NOT NULL CHECK (amount_raw > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_id, lot_id)
);

CREATE INDEX IF NOT EXISTS balance_sweep_execution_lots_lot_idx
  ON loyal_yield.balance_sweep_execution_lots (lot_id, created_at DESC);

CREATE TABLE IF NOT EXISTS loyal_yield.route_lookup_tables (
  id BIGSERIAL PRIMARY KEY,
  cluster TEXT NOT NULL,
  scope TEXT NOT NULL,
  table_address TEXT NOT NULL,
  authority TEXT NOT NULL,
  payer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'usable',
  durable BOOLEAN NOT NULL DEFAULT TRUE,
  address_count INTEGER NOT NULL DEFAULT 0 CHECK (
    address_count >= 0
    AND address_count <= 256
  ),
  address_hash TEXT NOT NULL DEFAULT '',
  addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  create_signature TEXT,
  extend_signatures JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_extended_slot BIGINT,
  warmup_slot BIGINT,
  deactivated_slot BIGINT,
  deactivate_signature TEXT,
  closed_signature TEXT,
  close_recipient TEXT,
  reclaimed_lamports BIGINT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (table_address)
);

CREATE INDEX IF NOT EXISTS route_lookup_tables_active_scope_idx
  ON loyal_yield.route_lookup_tables (cluster, scope, authority, status)
  WHERE durable = TRUE
    AND status IN ('active', 'warming', 'usable');

CREATE UNIQUE INDEX IF NOT EXISTS route_lookup_tables_unique_active_scope_idx
  ON loyal_yield.route_lookup_tables (cluster, scope, authority)
  WHERE durable = TRUE
    AND status IN ('active', 'warming', 'usable');

CREATE INDEX IF NOT EXISTS route_lookup_tables_cleanup_idx
  ON loyal_yield.route_lookup_tables (authority, durable, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS loyal_yield.realtime_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  scope TEXT NOT NULL,
  reason TEXT NOT NULL,
  solana_env TEXT,
  wallet_address TEXT,
  settings_pda TEXT,
  smart_account_address TEXT,
  vault_pubkey TEXT,
  target_id BIGINT,
  scheduled_slot_id BIGINT,
  execution_id BIGINT,
  source_table TEXT,
  source_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS realtime_events_scope_id_idx
  ON loyal_yield.realtime_events (scope, id);

CREATE INDEX IF NOT EXISTS realtime_events_settings_pda_id_idx
  ON loyal_yield.realtime_events (settings_pda, id)
  WHERE settings_pda IS NOT NULL;

CREATE INDEX IF NOT EXISTS realtime_events_wallet_address_id_idx
  ON loyal_yield.realtime_events (wallet_address, id)
  WHERE wallet_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS realtime_events_target_id_id_idx
  ON loyal_yield.realtime_events (target_id, id)
  WHERE target_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS realtime_events_source_idx
  ON loyal_yield.realtime_events (source_table, source_id)
  WHERE source_table IS NOT NULL
    AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS realtime_events_created_at_idx
  ON loyal_yield.realtime_events (created_at);

CREATE OR REPLACE FUNCTION loyal_yield.emit_realtime_event(
  p_event_type TEXT,
  p_scope TEXT,
  p_reason TEXT,
  p_solana_env TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_settings_pda TEXT DEFAULT NULL,
  p_smart_account_address TEXT DEFAULT NULL,
  p_vault_pubkey TEXT DEFAULT NULL,
  p_target_id BIGINT DEFAULT NULL,
  p_scheduled_slot_id BIGINT DEFAULT NULL,
  p_execution_id BIGINT DEFAULT NULL,
  p_source_table TEXT DEFAULT NULL,
  p_source_id TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_event_id BIGINT;
BEGIN
  INSERT INTO loyal_yield.realtime_events (
    event_type,
    scope,
    reason,
    solana_env,
    wallet_address,
    settings_pda,
    smart_account_address,
    vault_pubkey,
    target_id,
    scheduled_slot_id,
    execution_id,
    source_table,
    source_id,
    payload
  )
  VALUES (
    p_event_type,
    p_scope,
    p_reason,
    p_solana_env,
    p_wallet_address,
    p_settings_pda,
    p_smart_account_address,
    p_vault_pubkey,
    p_target_id,
    p_scheduled_slot_id,
    p_execution_id,
    p_source_table,
    p_source_id,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO inserted_event_id;

  PERFORM pg_notify(
    'loyal_yield_realtime',
    json_build_object('event_id', inserted_event_id)::text
  );

  RETURN inserted_event_id;
END;
$$;
