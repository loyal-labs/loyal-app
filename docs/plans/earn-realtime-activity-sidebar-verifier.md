# Earn Realtime Activity Sidebar Verifier

Run cold against `loyal-apps` and `loyal-yield-routing`. Return `PASS` only when
every Required check passes; otherwise return `FAIL` with evidence and the
smallest correction. Never expose credentials, tokens, wallet material, or DB
URLs. Production deployment is required; do not fabricate user activity or
mutate production data merely to prove latency.

## Required

1. **Immediate local feedback.** Starting user-initiated allowance creation or
   removal synchronously renders an in-progress state before network completion.
   Failure restores the prior state. Once confirmation recording succeeds, the
   Earn activity cache is invalidated and the right pane refreshes immediately;
   it does not wait for SSE or a broad account refresh.

2. **Complete canonical history.** The authenticated Earn-transactions response
   keeps separate stable entries for allowance creation and removal after a
   target closes, and includes deposits, withdrawals, balance sweeps, and each
   confirmed rebalance exactly once. Creation uses its original confirmed proof,
   not mutable `last_seen_*` close/update fields. Focused tests prove close does
   not erase create and rebalance projection remains idempotent.

3. **Producer wakeups.** Routing-owned ordered migrations emit durable,
   identity-scoped invalidations for (a) an allowance becoming active or closed
   and (b) a rebalance first becoming confirmed with its post-snapshot. The
   rebalance wakeup occurs from the confirmation write path, so no prior
   `/earn-transactions` GET is needed. Unrelated target updates and idempotent
   confirmed writes emit no duplicate activity wakeup. Migration verification
   proves functions/triggers are installed on the canonical tables.

4. **Targeted client reaction.** The existing single Earn SSE connection accepts
   the new versioned event types. Allowance events refresh Earn state plus the
   activity feed; rebalance/transaction events refresh the feed, position, and
   earnings as required. Events are coalesced, invalidate canonical REST caches,
   and never trigger `smartAccountData.refresh()` or a second SSE connection.
   Focused tests cover the event-to-refresh decision matrix.

5. **Safe data boundary.** SSE remains invalidation-only: no displayed balances,
   amounts, signatures, raw evidence, claims, secrets, or canonical transaction
   rows are added to envelopes. REST/Yield Neon and existing chain-confirmation
   checks remain authoritative. Web routes stay non-custodial and no browser RPC
   subscription or permanent polling loop is added.

6. **Verification.** Preserve unrelated work. Run formatter/diff checks, focused
   app tests for history and dispatch, frontend lint or targeted typecheck, and
   routing migration/Rust format-check plus focused tests. Never run a local
   frontend build. Record a static migration verifier or disposable-DB proof.

7. **Production rollout.** Commit and push only the verified app and routing
   slices. Record both commit SHAs. The Loyal frontend production deployment is
   `READY` on Vercel for the app SHA. Build an immutable
   `light-workers:sha-<routing-sha>` image, apply the ordered migration, and
   prove by production DB readback that its ledger row, two functions, and two
   triggers exist. Deploy only `loyal-yield-realtime` to that image; require a
   healthy `/healthz` and bounded logs without startup, listener, or migration
   errors. Prove other workers, especially same-mint execution, were unchanged.
   Report an authenticated activity latency canary separately as `NOT RUN`,
   `PASS`, or `FAIL` when genuine user activity is available.

## Verdict

Report checks 1-7 individually with commands and code/runtime evidence. Overall
`PASS` requires every Required check, including production rollout. The
authenticated activity canary is reported separately and does not change the
verdict when no genuine user action is available.
