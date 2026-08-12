CREATE TABLE IF NOT EXISTS loyal_yield.earn_earnings_snapshots (
  id BIGSERIAL PRIMARY KEY,
  cluster TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  settings TEXT NOT NULL,
  vault_index SMALLINT NOT NULL,
  timezone TEXT NOT NULL,
  history_revision TEXT NOT NULL,
  principal_amount_raw BIGINT NOT NULL,
  payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT earn_earnings_snapshots_scope_uidx
    UNIQUE (cluster, wallet_address, settings, vault_index, timezone)
);

CREATE INDEX IF NOT EXISTS earn_earnings_snapshots_updated_idx
  ON loyal_yield.earn_earnings_snapshots (updated_at);
