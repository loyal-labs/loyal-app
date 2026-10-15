# Earn principal history

Web and mobile Earned charts share the earnings read service. Cash events must
have unambiguous holding-event links and replay to the stored active principal.
A mismatch remains unavailable; do not remove this check to hide accounting bugs.

Read complete vault snapshots in the covering index's timestamp/slot/id order,
then restore slot/id order in memory. Sorting the entire history by slot in
Postgres can exceed the read timeout for long-lived wallets. Load reserve
exposures in batches of 1,000 snapshot IDs so each indexed read stays bounded.

Web and mobile reads reuse persisted verified charts for five minutes, within
the same local calendar day, while the source revision is unchanged. The
revision covers every scoped position's ID, status, principal, latest holding
event and update timestamp. Older charts return immediately as stale; Next.js
`after` refreshes them after responding. A transaction-scoped PostgreSQL advisory
lock coalesces refreshes across server instances by cluster, wallet, settings,
vault index and timezone. Failed refreshes preserve the saved chart. A wallet
with no saved chart still needs its first verified calculation.

The source revision is stored privately in the snapshot JSON and removed from
API responses. Capture it before and after calculation: concurrent source changes
must not produce a reusable cache revision. Older calculations cannot overwrite
newer snapshots. Bump the revision's calculation version when semantics change.

Replay principal per position, preserving independent stablecoin positions and
reused position lifecycles. For legacy reserve/idle withdrawals, use the linked
principal delta: withdrawing idle funds may reduce no invested principal, while a
full exit may settle rounding dust beyond the cash amount. Deposits also preserve
their recorded principal delta. For `chain_snapshot` withdrawals, subtract the
confirmed cash amount with a zero floor; historical observers could persist a
negative principal even though their holding delta was capped.

A zero holding reconciliation settles principal only when backed by a cleanup
signature or an empty `complete_product_vault` snapshot, with no positive reserve
position or idle balance. Legacy per-reserve preview snapshots do not establish a
vault closure. Include settlement events and principal deltas in the history
revision so cached charts invalidate when accounting history changes.

Historical repairs must preserve confirmed cash flows. Verify missing events on
finalized chain history, including any separate wallet-to-vault funding step.
Deploy the observer's zero-floor fix before correcting stored principal. Apply
repairs atomically with guards on the audited positions, cash-event links,
withdrawal source semantics and closure evidence. Re-audit if any guard changes;
never infer new principal solely from a reserve deposit or overwrite a mismatch
without explaining it. Test the repair and rollback against a disposable database
before applying it, then verify fresh web/mobile earnings responses after rollout.
History repairs must update the affected position's `updated_at` even when its
principal stays unchanged, so previously verified charts are invalidated.
