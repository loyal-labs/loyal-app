ALTER TABLE loyal_yield.balance_sweep_targets
  ADD COLUMN IF NOT EXISTS subscription_authority TEXT,
  ADD COLUMN IF NOT EXISTS recurring_delegation TEXT,
  ADD COLUMN IF NOT EXISTS period_length_seconds BIGINT,
  ADD COLUMN IF NOT EXISTS wallet_balance_floor_raw BIGINT,
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS close_signature TEXT,
  ADD COLUMN IF NOT EXISTS close_slot BIGINT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'balance_sweep_targets_lifecycle_status_chk'
      AND conrelid = 'loyal_yield.balance_sweep_targets'::regclass
  ) THEN
    ALTER TABLE loyal_yield.balance_sweep_targets
      ADD CONSTRAINT balance_sweep_targets_lifecycle_status_chk
      CHECK (lifecycle_status IN (
        'pending_delegation',
        'active',
        'closing',
        'closed'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'balance_sweep_targets_wallet_balance_floor_raw_chk'
      AND conrelid = 'loyal_yield.balance_sweep_targets'::regclass
  ) THEN
    ALTER TABLE loyal_yield.balance_sweep_targets
      ADD CONSTRAINT balance_sweep_targets_wallet_balance_floor_raw_chk
      CHECK (wallet_balance_floor_raw IS NULL OR wallet_balance_floor_raw >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS balance_sweep_targets_recurring_delegation_uidx
  ON loyal_yield.balance_sweep_targets (recurring_delegation)
  WHERE recurring_delegation IS NOT NULL;

CREATE INDEX IF NOT EXISTS balance_sweep_targets_lifecycle_status_idx
  ON loyal_yield.balance_sweep_targets (lifecycle_status, active);
