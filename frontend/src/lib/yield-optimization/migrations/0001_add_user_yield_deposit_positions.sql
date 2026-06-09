CREATE TYPE loyal_yield.yield_position_status AS ENUM ('active', 'closed');

CREATE TABLE loyal_yield.user_yield_positions (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  smart_account_address TEXT NOT NULL,
  settings TEXT NOT NULL,
  vault_index SMALLINT NOT NULL,
  vault_pubkey TEXT NOT NULL,
  policy_id BIGINT NOT NULL,
  policy_account TEXT NOT NULL,
  policy_seed BIGINT NOT NULL,
  target_reserve TEXT NOT NULL,
  market TEXT,
  liquidity_mint TEXT NOT NULL,
  target_supply_apy_bps BIGINT,
  deposit_mint TEXT NOT NULL,
  principal_amount_raw BIGINT NOT NULL,
  first_deposit_signature TEXT NOT NULL,
  last_deposit_signature TEXT NOT NULL,
  last_confirmed_slot BIGINT NOT NULL,
  status loyal_yield.yield_position_status NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX user_yield_positions_target_uidx
  ON loyal_yield.user_yield_positions (
    settings,
    vault_index,
    target_reserve
  );

CREATE INDEX user_yield_positions_wallet_idx
  ON loyal_yield.user_yield_positions (
    wallet_address,
    status
  );

CREATE TABLE loyal_yield.user_yield_position_deposits (
  id BIGSERIAL PRIMARY KEY,
  deposit_signature TEXT NOT NULL,
  policy_signature TEXT NOT NULL,
  confirmed_slot BIGINT NOT NULL,
  wallet_address TEXT NOT NULL,
  smart_account_address TEXT NOT NULL,
  settings TEXT NOT NULL,
  vault_index SMALLINT NOT NULL,
  vault_pubkey TEXT NOT NULL,
  policy_id BIGINT NOT NULL,
  policy_account TEXT NOT NULL,
  policy_seed BIGINT NOT NULL,
  target_reserve TEXT NOT NULL,
  market TEXT,
  liquidity_mint TEXT NOT NULL,
  target_supply_apy_bps BIGINT,
  deposit_mint TEXT NOT NULL,
  principal_amount_raw BIGINT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX user_yield_position_deposits_signature_uidx
  ON loyal_yield.user_yield_position_deposits (
    deposit_signature
  );

CREATE INDEX user_yield_position_deposits_position_idx
  ON loyal_yield.user_yield_position_deposits (
    settings,
    vault_index,
    target_reserve,
    confirmed_slot
  );

CREATE TABLE loyal_yield.user_yield_position_withdrawals (
  id BIGSERIAL PRIMARY KEY,
  withdrawal_signature TEXT NOT NULL,
  confirmed_slot BIGINT NOT NULL,
  wallet_address TEXT NOT NULL,
  smart_account_address TEXT NOT NULL,
  settings TEXT NOT NULL,
  vault_index SMALLINT NOT NULL,
  vault_pubkey TEXT NOT NULL,
  policy_id BIGINT NOT NULL,
  policy_account TEXT NOT NULL,
  policy_seed BIGINT NOT NULL,
  target_reserve TEXT NOT NULL,
  market TEXT,
  liquidity_mint TEXT NOT NULL,
  withdrawn_amount_raw BIGINT NOT NULL,
  mode TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX user_yield_position_withdrawals_signature_uidx
  ON loyal_yield.user_yield_position_withdrawals (
    withdrawal_signature
  );

CREATE INDEX user_yield_position_withdrawals_position_idx
  ON loyal_yield.user_yield_position_withdrawals (
    settings,
    vault_index,
    target_reserve,
    confirmed_slot
  );
