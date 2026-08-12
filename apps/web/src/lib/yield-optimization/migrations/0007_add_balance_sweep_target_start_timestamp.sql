ALTER TABLE loyal_yield.balance_sweep_targets
  ADD COLUMN IF NOT EXISTS start_timestamp BIGINT;
