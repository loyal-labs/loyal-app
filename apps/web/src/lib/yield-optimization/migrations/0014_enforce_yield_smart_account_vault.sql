ALTER TABLE loyal_yield.user_yield_positions
  ADD CONSTRAINT user_yield_positions_smart_account_is_vault
  CHECK (smart_account_address = vault_pubkey);

ALTER TABLE loyal_yield.user_yield_position_deposits
  ADD CONSTRAINT user_yield_position_deposits_smart_account_is_vault
  CHECK (smart_account_address = vault_pubkey);

ALTER TABLE loyal_yield.user_yield_position_withdrawals
  ADD CONSTRAINT user_yield_position_withdrawals_smart_account_is_vault
  CHECK (smart_account_address = vault_pubkey);
