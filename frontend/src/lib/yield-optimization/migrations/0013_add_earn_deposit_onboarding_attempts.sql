CREATE TABLE IF NOT EXISTS loyal_yield.earn_deposit_onboarding_attempts (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  delegated_signer TEXT NOT NULL,
  smart_account_address TEXT,
  settings TEXT NOT NULL,
  vault_index SMALLINT NOT NULL,
  vault_pubkey TEXT NOT NULL,
  policy_id BIGINT NOT NULL,
  policy_account TEXT NOT NULL,
  policy_seed BIGINT NOT NULL,
  route_policy_db_id BIGINT REFERENCES loyal_yield.route_policies(id),
  route_policy_signature TEXT,
  route_policy_confirmed_slot BIGINT,
  setup_policy_id BIGINT,
  setup_policy_account TEXT,
  setup_policy_seed BIGINT,
  setup_policy_db_id BIGINT REFERENCES loyal_yield.route_policies(id),
  setup_policy_signature TEXT,
  setup_policy_confirmed_slot BIGINT,
  deposit_signature TEXT,
  deposit_confirmed_slot BIGINT,
  deposit_mint TEXT,
  principal_amount_raw BIGINT,
  target_reserve TEXT NOT NULL,
  market TEXT,
  liquidity_mint TEXT NOT NULL,
  target_supply_apy_bps BIGINT,
  status TEXT NOT NULL,
  last_error_code TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS earn_deposit_onboarding_active_attempt_uidx
  ON loyal_yield.earn_deposit_onboarding_attempts (settings, vault_index, vault_pubkey)
  WHERE status <> 'complete';

CREATE INDEX IF NOT EXISTS earn_deposit_onboarding_wallet_idx
  ON loyal_yield.earn_deposit_onboarding_attempts (wallet_address, updated_at);

CREATE INDEX IF NOT EXISTS earn_deposit_onboarding_deposit_signature_idx
  ON loyal_yield.earn_deposit_onboarding_attempts (deposit_signature)
  WHERE deposit_signature IS NOT NULL;
