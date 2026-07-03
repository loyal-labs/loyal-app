CREATE TABLE IF NOT EXISTS loyal_yield.push_campaign_sends (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  campaign TEXT NOT NULL,
  cohort_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_campaign_send_wallet_campaign_uidx
  ON loyal_yield.push_campaign_sends (wallet_address, campaign);
