ALTER TABLE loyal_yield.balance_sweep_targets
  DROP CONSTRAINT IF EXISTS balance_sweep_targets_lifecycle_status_chk;

ALTER TABLE loyal_yield.balance_sweep_targets
  ADD CONSTRAINT balance_sweep_targets_lifecycle_status_chk
  CHECK (lifecycle_status IN (
    'pending_delegation',
    'pending_policy',
    'active',
    'closing',
    'closed'
  ));
