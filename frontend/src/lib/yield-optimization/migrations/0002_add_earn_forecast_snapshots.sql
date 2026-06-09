CREATE TABLE loyal_yield.earn_forecast_snapshots (
  id BIGSERIAL PRIMARY KEY,
  strategy TEXT NOT NULL,
  risk_profile TEXT NOT NULL,
  fee_bps SMALLINT NOT NULL,
  snapshot_date DATE NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  window_ended_at TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  apy_bps INTEGER NOT NULL,
  range_low_bps INTEGER NOT NULL,
  range_high_bps INTEGER NOT NULL,
  samples JSONB NOT NULL,
  CONSTRAINT earn_forecast_snapshots_samples_array_check
    CHECK (jsonb_typeof(samples) = 'array')
);

CREATE UNIQUE INDEX earn_forecast_snapshots_latest_key_uidx
  ON loyal_yield.earn_forecast_snapshots (
    strategy,
    risk_profile,
    fee_bps,
    snapshot_date
  );

CREATE INDEX earn_forecast_snapshots_latest_lookup_idx
  ON loyal_yield.earn_forecast_snapshots (
    strategy,
    risk_profile,
    fee_bps,
    snapshot_date DESC,
    generated_at DESC
  );
