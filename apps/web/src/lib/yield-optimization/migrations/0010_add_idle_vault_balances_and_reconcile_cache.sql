ALTER TABLE loyal_yield.managed_vaults
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reconciled_slot BIGINT;

CREATE TABLE IF NOT EXISTS loyal_yield.vault_idle_token_balances_current (
  vault_id BIGINT NOT NULL REFERENCES loyal_yield.managed_vaults(id),
  mint TEXT NOT NULL,
  amount_raw BIGINT NOT NULL,
  owner TEXT NOT NULL,
  token_account TEXT NOT NULL,
  observed_slot BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  source_commitment TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (vault_id, mint)
);

CREATE INDEX IF NOT EXISTS vault_idle_token_balances_current_mint_idx
  ON loyal_yield.vault_idle_token_balances_current (mint);
