CREATE TABLE IF NOT EXISTS loyal_yield.balance_sweep_policies (
  id BIGSERIAL PRIMARY KEY,
  settings TEXT NOT NULL,
  authority TEXT NOT NULL,
  policy_seed BIGINT NOT NULL,
  policy_account TEXT NOT NULL,
  policy_type TEXT NOT NULL DEFAULT 'subscription_sweep',
  vault_index SMALLINT NOT NULL,
  vault_pubkey TEXT NOT NULL,
  delegated_signers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  threshold INTEGER NOT NULL,
  liquidity_mint TEXT,
  subscription_authority TEXT,
  subscription_delegatee TEXT,
  wallet_usdc_ata TEXT,
  vault_usdc_ata TEXT,
  max_amount_per_period BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_slot BIGINT NOT NULL,
  last_seen_signature TEXT NOT NULL,
  closed_at TIMESTAMPTZ,
  close_signature TEXT,
  close_slot BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS balance_sweep_policies_policy_account_uidx
  ON loyal_yield.balance_sweep_policies (policy_account);

CREATE INDEX IF NOT EXISTS balance_sweep_policies_active_authority_idx
  ON loyal_yield.balance_sweep_policies (active, authority);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'balance_sweep_policies_policy_type_chk'
      AND conrelid = 'loyal_yield.balance_sweep_policies'::regclass
  ) THEN
    ALTER TABLE loyal_yield.balance_sweep_policies
      ADD CONSTRAINT balance_sweep_policies_policy_type_chk
      CHECK (policy_type IN ('subscription_sweep'));
  END IF;
END $$;

ALTER TABLE loyal_yield.balance_sweep_targets
  ADD COLUMN IF NOT EXISTS balance_sweep_policy_id BIGINT;

INSERT INTO loyal_yield.balance_sweep_policies (
  settings,
  authority,
  policy_seed,
  policy_account,
  policy_type,
  vault_index,
  vault_pubkey,
  delegated_signers,
  threshold,
  liquidity_mint,
  subscription_authority,
  subscription_delegatee,
  wallet_usdc_ata,
  vault_usdc_ata,
  max_amount_per_period,
  active,
  first_seen_at,
  last_seen_at,
  last_seen_slot,
  last_seen_signature,
  closed_at,
  close_signature,
  close_slot
)
SELECT
  target.settings,
  target.authority,
  target.policy_seed,
  target.policy_account,
  'subscription_sweep',
  target.vault_index,
  target.vault_pubkey,
  target.delegated_signers,
  target.threshold,
  NULL,
  target.subscription_authority,
  target.vault_pubkey,
  target.wallet_usdc_ata,
  target.vault_usdc_ata,
  target.max_amount_per_period,
  target.lifecycle_status <> 'closed',
  target.first_seen_at,
  target.last_seen_at,
  target.last_seen_slot,
  target.last_seen_signature,
  target.closed_at,
  target.close_signature,
  target.close_slot
FROM loyal_yield.balance_sweep_targets AS target
WHERE target.policy_account IS NOT NULL
ON CONFLICT (policy_account) DO UPDATE SET
  settings = EXCLUDED.settings,
  authority = EXCLUDED.authority,
  policy_seed = EXCLUDED.policy_seed,
  policy_type = EXCLUDED.policy_type,
  vault_index = EXCLUDED.vault_index,
  vault_pubkey = EXCLUDED.vault_pubkey,
  delegated_signers = EXCLUDED.delegated_signers,
  threshold = EXCLUDED.threshold,
  subscription_authority = EXCLUDED.subscription_authority,
  subscription_delegatee = EXCLUDED.subscription_delegatee,
  wallet_usdc_ata = EXCLUDED.wallet_usdc_ata,
  vault_usdc_ata = EXCLUDED.vault_usdc_ata,
  max_amount_per_period = EXCLUDED.max_amount_per_period,
  active = EXCLUDED.active,
  first_seen_at = LEAST(loyal_yield.balance_sweep_policies.first_seen_at, EXCLUDED.first_seen_at),
  last_seen_at = EXCLUDED.last_seen_at,
  last_seen_slot = EXCLUDED.last_seen_slot,
  last_seen_signature = EXCLUDED.last_seen_signature,
  closed_at = EXCLUDED.closed_at,
  close_signature = EXCLUDED.close_signature,
  close_slot = EXCLUDED.close_slot;

UPDATE loyal_yield.balance_sweep_targets AS target
SET balance_sweep_policy_id = policy.id
FROM loyal_yield.balance_sweep_policies AS policy
WHERE target.policy_account = policy.policy_account
  AND target.balance_sweep_policy_id IS DISTINCT FROM policy.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'balance_sweep_targets_policy_id_fkey'
      AND conrelid = 'loyal_yield.balance_sweep_targets'::regclass
  ) THEN
    ALTER TABLE loyal_yield.balance_sweep_targets
      ADD CONSTRAINT balance_sweep_targets_policy_id_fkey
      FOREIGN KEY (balance_sweep_policy_id)
      REFERENCES loyal_yield.balance_sweep_policies(id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE loyal_yield.balance_sweep_targets
  VALIDATE CONSTRAINT balance_sweep_targets_policy_id_fkey;

CREATE INDEX IF NOT EXISTS balance_sweep_targets_policy_id_idx
  ON loyal_yield.balance_sweep_targets (balance_sweep_policy_id);
