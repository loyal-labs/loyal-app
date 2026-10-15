# Earn principal history

Web and mobile Earned charts share the earnings read service. Cash events must
have unambiguous holding-event links and replay to the stored active principal.
A mismatch remains unavailable; do not remove this check to hide accounting bugs.

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
