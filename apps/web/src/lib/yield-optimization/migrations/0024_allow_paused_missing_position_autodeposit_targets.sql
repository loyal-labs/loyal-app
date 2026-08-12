-- The position-pause reconcile (earn-autodeposit-position-pause.server.ts)
-- writes lifecycle_status = 'paused_missing_position' for autodeposit targets
-- whose Earn route policy pair is gone; without this value the CHECK
-- constraint rejects the write and both Earn state reads 502 for every
-- affected wallet.
ALTER TABLE loyal_yield.balance_sweep_targets
  DROP CONSTRAINT IF EXISTS balance_sweep_targets_lifecycle_status_chk;

ALTER TABLE loyal_yield.balance_sweep_targets
  ADD CONSTRAINT balance_sweep_targets_lifecycle_status_chk
  CHECK (lifecycle_status IN (
    'pending_delegation',
    'pending_policy',
    'active',
    'closing',
    'closed',
    'paused_missing_position'
  ));
