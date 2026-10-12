# Stats Performance Goal

## Standing verifier

Run this verifier cold against the repository and deployed production. Report
PASS or FAIL for every required condition and an overall PASS only when all
required conditions pass.

1. Public stats are snapshot-only on the request path.

   - The dashboard page and `/api/earn/stats` read the same singleton row from
     the app database.
   - Neither request path connects to Yield Neon or executes the historical AUM,
     reserve-position, or rebalance-volume aggregates.
   - The snapshot includes headline AUM, optimized volume, total users, weekly
     AUM series, and `refreshedAt`.

   - Headline AUM and the current UTC chart week include the pooled Earn MAX
     vault's net asset value (`totalValue` in raw USDC from Voltr's public
     `/vault/HXtk15EA5pBg3rSKxBm8sWPExScPkTknSRp37fXNHgNA/share-price`).
     Count the pool once, including pending withdrawals until claimed; do not
     add its underlying leveraged collateral or individual LP balances again.
   - Completed chart weeks remain unchanged; there is no historical backfill.
     Total users still counts app accounts and optimization volume still counts
     confirmed rebalances. Principal and policy/user counts remain Earn routing
     metrics, not pooled Earn MAX metrics.
   - Voltr reads have a three-second timeout and reject failed or invalid
     valuations. They run only during refresh; a failed read leaves the last
     good snapshot intact. The initial inclusion can trigger the existing AUM
     increase alert and is reflected in the change versus the prior week.

2. The snapshot is refreshed safely every minute.

   - One authenticated cron owns refresh work; no second cron or cache service is
     introduced.
   - Concurrent invocations cannot run the canonical aggregation at the same
     time.
   - A failed refresh preserves the last good snapshot.
   - Production evidence shows at least three consecutive refreshes completing
     successfully in under 60 seconds and the snapshot age staying below five
     minutes.

3. Admin has a fast initial response.

   - Its headline data uses the shared snapshot.
   - Slow funding, position-detail, and diagnostics work does not block the
     headline shell from rendering.
   - Detailed data remains canonical and visibly reports failure/staleness rather
     than silently substituting snapshot data where live truth is required.

4. The Yield database bottleneck is removed.

   - No `LISTEN` backend holds `backend_xmin` for more than ten minutes.
   - `loyal_yield.vault_reserve_positions_current` is compacted from its bloated
     state and has no abnormal dead-tuple accumulation.
   - The canonical stats aggregation finishes within the cron budget after
     recovery.

5. Repository checks pass without a prohibited local frontend build.
   - Targeted typecheck/lint/verifier commands for changed app, dashboard,
     frontend, admin, shared-schema, and migration code pass.
   - Migration ordering supports migration-first deployment and old readers
     during rollout.
   - Existing unrelated worktree changes remain untouched.

Production worker restart, database extension installation/repack, migration,
or deployment require an explicit live-operations approval after the exact
targets and commands are presented.

## Earn MAX aggregation verifier

From `apps/telegram`, run:

```sh
bun run scripts/telegram/verify-stats-earn-max.ts
```

This offline verifier runs the real stats loader and cron with mocked source
transports. It checks combined AUM, unchanged history, repeat refreshes, zero
NAV, and rejection before persistence for unavailable or malformed NAV.
