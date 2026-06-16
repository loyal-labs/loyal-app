ALTER TABLE loyal_yield.managed_vaults
  ADD COLUMN IF NOT EXISTS setup_policy_id BIGINT REFERENCES loyal_yield.route_policies(id);

CREATE INDEX IF NOT EXISTS managed_vaults_setup_policy_idx
  ON loyal_yield.managed_vaults (setup_policy_id)
  WHERE setup_policy_id IS NOT NULL;
