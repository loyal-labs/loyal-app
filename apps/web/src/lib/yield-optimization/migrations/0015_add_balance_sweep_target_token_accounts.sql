ALTER TABLE loyal_yield.balance_sweep_targets
  ADD COLUMN IF NOT EXISTS token_mint TEXT,
  ADD COLUMN IF NOT EXISTS wallet_token_ata TEXT,
  ADD COLUMN IF NOT EXISTS vault_token_ata TEXT;

UPDATE loyal_yield.balance_sweep_targets
SET
  token_mint = COALESCE(token_mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  wallet_token_ata = COALESCE(wallet_token_ata, wallet_usdc_ata),
  vault_token_ata = COALESCE(vault_token_ata, vault_usdc_ata)
WHERE token_mint IS NULL
   OR wallet_token_ata IS NULL
   OR vault_token_ata IS NULL;

ALTER TABLE loyal_yield.balance_sweep_targets
  ALTER COLUMN token_mint SET NOT NULL,
  ALTER COLUMN wallet_token_ata SET NOT NULL,
  ALTER COLUMN vault_token_ata SET NOT NULL;

CREATE INDEX IF NOT EXISTS balance_sweep_targets_active_wallet_token_ata_idx
  ON loyal_yield.balance_sweep_targets (active, token_mint, wallet_token_ata);

CREATE INDEX IF NOT EXISTS balance_sweep_targets_wallet_token_idx
  ON loyal_yield.balance_sweep_targets (wallet, token_mint, active);

ALTER TABLE loyal_yield.balance_sweep_wallet_balances_current
  ADD COLUMN IF NOT EXISTS wallet_token_ata TEXT;

UPDATE loyal_yield.balance_sweep_wallet_balances_current
SET wallet_token_ata = COALESCE(wallet_token_ata, wallet_usdc_ata)
WHERE wallet_token_ata IS NULL;

ALTER TABLE loyal_yield.balance_sweep_wallet_balances_current
  ALTER COLUMN wallet_token_ata SET NOT NULL;

DO $$
DECLARE
  current_pkey_columns TEXT[];
  current_pkey_name TEXT;
BEGIN
  SELECT c.conname, ARRAY_AGG(a.attname ORDER BY cols.ordinality)
  INTO current_pkey_name, current_pkey_columns
  FROM pg_constraint c
  CROSS JOIN LATERAL UNNEST(c.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid
   AND a.attnum = cols.attnum
  WHERE c.conrelid = 'loyal_yield.balance_sweep_wallet_balances_current'::regclass
    AND c.contype = 'p'
  GROUP BY c.conname;

  IF current_pkey_columns IS DISTINCT FROM ARRAY['target_id', 'mint']::TEXT[] THEN
    IF EXISTS (
      SELECT 1
      FROM loyal_yield.balance_sweep_wallet_balances_current
      GROUP BY target_id, mint
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION
        'cannot add balance_sweep_wallet_balances_current primary key (target_id, mint): duplicate rows exist';
    END IF;

    IF current_pkey_name IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE loyal_yield.balance_sweep_wallet_balances_current DROP CONSTRAINT %I',
        current_pkey_name
      );
    END IF;

    ALTER TABLE loyal_yield.balance_sweep_wallet_balances_current
      ADD PRIMARY KEY (target_id, mint);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS balance_sweep_wallet_balances_wallet_token_idx
  ON loyal_yield.balance_sweep_wallet_balances_current (wallet, mint, updated_at DESC);

ALTER TABLE loyal_yield.balance_sweep_wallet_balance_events
  ADD COLUMN IF NOT EXISTS wallet_token_ata TEXT,
  ADD COLUMN IF NOT EXISTS mint TEXT;

UPDATE loyal_yield.balance_sweep_wallet_balance_events
SET
  wallet_token_ata = COALESCE(wallet_token_ata, wallet_usdc_ata),
  mint = COALESCE(mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
WHERE wallet_token_ata IS NULL
   OR mint IS NULL;

ALTER TABLE loyal_yield.balance_sweep_wallet_balance_events
  ALTER COLUMN wallet_token_ata SET NOT NULL,
  ALTER COLUMN mint SET NOT NULL;

CREATE INDEX IF NOT EXISTS balance_sweep_wallet_balance_events_target_mint_event_idx
  ON loyal_yield.balance_sweep_wallet_balance_events (target_id, mint, event_id DESC);

ALTER TABLE loyal_yield.balance_sweep_executions
  ADD COLUMN IF NOT EXISTS token_mint TEXT,
  ADD COLUMN IF NOT EXISTS source_token_ata TEXT,
  ADD COLUMN IF NOT EXISTS destination_token_ata TEXT;

UPDATE loyal_yield.balance_sweep_executions
SET
  token_mint = COALESCE(token_mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  source_token_ata = COALESCE(source_token_ata, source_wallet_ata),
  destination_token_ata = COALESCE(destination_token_ata, destination_vault_ata)
WHERE token_mint IS NULL
   OR source_token_ata IS NULL
   OR destination_token_ata IS NULL;

ALTER TABLE loyal_yield.balance_sweep_executions
  ALTER COLUMN token_mint SET NOT NULL,
  ALTER COLUMN source_token_ata SET NOT NULL,
  ALTER COLUMN destination_token_ata SET NOT NULL;

CREATE INDEX IF NOT EXISTS balance_sweep_executions_target_mint_slot_idx
  ON loyal_yield.balance_sweep_executions (target_id, token_mint, slot DESC, id DESC);
