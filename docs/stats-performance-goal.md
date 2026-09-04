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
