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
