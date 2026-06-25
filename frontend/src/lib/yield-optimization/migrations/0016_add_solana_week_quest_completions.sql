CREATE TABLE IF NOT EXISTS loyal_yield.solana_week_quest_completions (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  quest_kind TEXT NOT NULL,
  quest_id TEXT,
  status TEXT NOT NULL,
  solana_status TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  metadata JSONB,
  reported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS solana_week_quest_completion_wallet_kind_uidx
  ON loyal_yield.solana_week_quest_completions (wallet_address, quest_kind);

CREATE INDEX IF NOT EXISTS solana_week_quest_completion_unreported_idx
  ON loyal_yield.solana_week_quest_completions (updated_at)
  WHERE status <> 'reported';
