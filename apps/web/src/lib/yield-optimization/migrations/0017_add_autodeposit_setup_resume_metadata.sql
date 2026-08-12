ALTER TABLE loyal_yield.balance_sweep_targets
  ADD COLUMN IF NOT EXISTS cluster TEXT,
  ADD COLUMN IF NOT EXISTS recurring_delegation_nonce BIGINT,
  ADD COLUMN IF NOT EXISTS recurring_delegation_expiry_timestamp BIGINT,
  ADD COLUMN IF NOT EXISTS policy_signature TEXT,
  ADD COLUMN IF NOT EXISTS policy_confirmed_slot BIGINT,
  ADD COLUMN IF NOT EXISTS recurring_delegation_signature TEXT,
  ADD COLUMN IF NOT EXISTS recurring_delegation_confirmed_slot BIGINT;
