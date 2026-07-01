ALTER TABLE loyal_yield.user_yield_position_withdrawals
  ADD COLUMN IF NOT EXISTS reserve_withdrawals JSONB NOT NULL DEFAULT '[]'::jsonb;
