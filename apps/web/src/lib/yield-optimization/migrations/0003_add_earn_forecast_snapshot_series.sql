ALTER TABLE loyal_yield.earn_forecast_snapshots
  ADD COLUMN series JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE loyal_yield.earn_forecast_snapshots
SET series = jsonb_build_array(
  jsonb_build_object(
    'key', 'loyal',
    'label', 'Loyal Earn',
    'samples', samples
  )
)
WHERE series = '[]'::jsonb;

ALTER TABLE loyal_yield.earn_forecast_snapshots
  ADD CONSTRAINT earn_forecast_snapshots_series_array_check
  CHECK (jsonb_typeof(series) = 'array');
