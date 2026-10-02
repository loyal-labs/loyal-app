# Earn realized APY

The Earn headline annualizes observed Kamino reserve share-price growth over
seven days when that window is complete. During the first seven days, it uses a
six- to 24-hour live window. Each return interval uses the fleet's recorded
allocation at that time, including zero-return idle capital. The historical
chart uses the same measured returns; it never substitutes a forecast line.

The allocation reader samples each `complete_product_vault` snapshot as of
each UTC hour, plus the current time. A rebalance between two hourly samples
affects the next sample, so the historical value is an hourly approximation,
not a transaction-exact accounting return. Reserve and idle balances are
compared as nominal raw units because the supported Earn stablecoins all have
six decimals. This calculation does not infer FX rates or depegs.

Only explicit redeemable-liquidity amounts are accepted. A collateral-unit
snapshot needs a recorded redeemable amount; unknown units, missing opening
snapshots, stale funded allocations, inconsistent current idle balance, or
inadequate share-price coverage make the measured APY unavailable. A recent
measurement may be displayed as stale for at most three hours after its source
timestamp. After that, the UI shows an unavailable state rather than a
simulated percentage.

This serving path depends on the recorder in PR #794 and the share-price table
migration in loyal-yield-routing PR #261. It also requires existing complete
fleet snapshot data with the idle and redeemable-liquidity metadata above.
Enablement requires those dependencies, their migrations, representative data,
and a read-only production query plan for the allocation aggregation. The local
environment does not establish database execution cost or historical coverage.
