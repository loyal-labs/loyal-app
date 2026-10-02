# Earn realized APY

The Earn headline annualizes observed Kamino reserve share-price growth over
seven days when that window is complete. During the first seven days, it uses a
six- to 24-hour live window. Each return interval uses the fleet's recorded
allocation at that time, including zero-return idle capital. The historical
chart uses the same measured returns; it never substitutes a forecast line.

The hourly share-price cron also records the fleet allocation in
`loyal_yield.earn_fleet_allocations_hourly`: redeemable liquidity per reserve
and idle capital, summed from each Earn vault's latest `complete_product_vault`
snapshot. The APY reader loads those rows, one per hour, so its cost depends
on the window length and not on fleet size or snapshot history. A rebalance
between two samples takes effect at the next sample, so the historical value
is an hourly approximation, not a transaction-exact accounting return.
Recording is forward only: hours before the recorder started have no
allocation and are never reconstructed. Reserve and idle balances are compared
as nominal raw units because the supported Earn stablecoins all have six
decimals. This calculation does not infer FX rates or depegs.

Only explicit redeemable-liquidity amounts are accepted. A collateral-unit
position needs a recorded redeemable amount. Idle capital comes from the idle
balances written with the snapshot, or from the snapshot's own context once a
later partial observation has replaced them. Each sample counts the vaults it
leaves out: no complete snapshot yet, unknown units or idle, or a funded vault
whose snapshot is more than six hours old. A sample that leaves any vault out,
a gap of more than six hours between samples, or inadequate share-price
coverage makes the measured APY unavailable for the hours involved. A recent
measurement may be displayed as stale for at most three hours after its source
timestamp. After that, the UI shows an unavailable state rather than a
simulated percentage.

This serving path depends on the share-price recorder (PR #794, routing
migration 0084) and the fleet allocation recorder (routing migration 0086).
The allocation recorder reads one latest complete snapshot per vault through
the partial index on `(vault_id, observed_at DESC, observed_slot DESC, id
DESC)` for `complete_product_vault` snapshots (routing migration 0085), under
a database-enforced 10-second limit. A failed allocation sample is logged and
leaves that hour without a row; it does not stop the hour's share prices.
