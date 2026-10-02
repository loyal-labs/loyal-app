# Earn realized APY

The Earn headline annualizes observed Kamino reserve share-price growth over
seven days when that window is complete. Without a full seven-day window, it
uses a six- to 24-hour live window. Each return interval uses the fleet's
recorded allocation at that time, including zero-return idle capital. The
historical chart uses the same measured returns; it never substitutes a
forecast line.

The hourly share-price cron also records the fleet allocation in
`loyal_yield.earn_fleet_allocations_hourly`: redeemable liquidity per reserve
and idle capital, summed from each active Earn vault's latest
`complete_product_vault` snapshot. The APY reader loads those rows, one per
hour, so its cost depends on the window length and not on fleet size or
snapshot history. A rebalance between two samples takes effect at the next
sample, so the historical value is an hourly approximation, not a
transaction-exact accounting return. Reserve and idle balances are compared as
nominal raw units because the supported Earn stablecoins all have six
decimals. This calculation does not infer FX rates or depegs.

The cron records forward and never reconstructs a missed hour. History from
2026-08-25 14:00 UTC to 2026-10-02 17:00 UTC was backfilled once, on
2026-10-02, from the stored snapshot history: allocations from each vault's
latest sweep-written complete snapshot as of five minutes past each hour, and
share prices from the same snapshots. Backfilled allocation rows have
`observed_at` exactly five minutes past the hour.

Only explicit redeemable-liquidity amounts are accepted. A collateral-unit
position needs a recorded redeemable amount. Idle capital is the snapshot's
own context value; a snapshot without one uses the vault's idle balance rows,
and only while every one of them is still at the snapshot's slot. Each sample
counts the vaults it leaves out: no complete snapshot yet, unknown units or
idle, or a funded vault whose snapshot is more than six hours old. It also
keeps the last-known amount of the invalid and stale vaults. A sample is
measurable while that excluded amount is at most 1% of the capital it covers;
vaults with no complete snapshot have no known capital and do not count
against it. A sample over that limit, a gap of more than six hours between
samples, or inadequate share-price coverage makes the measured APY unavailable
for the hours involved. A recent measurement may be displayed as stale for at
most three hours after its source timestamp. After that, the UI shows an
unavailable state rather than a simulated percentage.

Share prices come from two sources, and for one reserve and hour the row with
the newer slot is kept. The on-chain probe reads each reserve account and
skips one that was last refreshed more than three hours ago. The allocation
step prices each reserve the fleet holds from its largest recent position of
at least 1,000 collateral units: redeemable liquidity per collateral unit,
which includes interest accrued up to the snapshot. This keeps a fresh price
for reserves that hold Earn capital but are refreshed on chain only every few
hours.

This serving path depends on the share-price recorder (PR #794, routing
migration 0084) and the fleet allocation recorder (routing migration 0086).
The allocation recorder reads one latest complete snapshot per vault through
the partial index on `(vault_id, observed_at DESC, observed_slot DESC, id
DESC)` for `complete_product_vault` snapshots (routing migration 0085), under
a database-enforced 30-second limit: the read takes under 100 ms on cached
pages and several seconds on a cold cache. A failed allocation sample is
logged and leaves that hour without a row; it does not stop the hour's share
prices.
