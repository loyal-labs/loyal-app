# Frontend Realtime Sync and Request Efficiency Verifier

Run cold against `/Users/taequn/loyal/loyal-apps`. Return `PASS` only when
every Required check passes; otherwise return `FAIL` with concrete evidence and
the smallest correction. Never expose credentials, bearer tokens, wallet
material, authorization headers, or database URLs. Do not run a local frontend
build. A browser/devnet canary is reported separately and is not permission to
submit transactions or mutate production state.

## Required

1. **Gap-free SSE lifecycle.** A cursorless connection is admitted before one
   canonical reconciliation is accepted, including after `resync_required`; a
   replay connection with a cursor does not add that reconciliation. A batch
   advances its identity-scoped cursor only after the sync coordinator accepts
   the complete refresh plan. Teardown cannot discard work whose cursor was
   acknowledged. Focused tests prove stream-before-reconcile ordering, replay,
   batching, acknowledgement, abort, and identity reset.

2. **Resilient recovery.** Denied browser storage falls back to an in-memory,
   identity-scoped cursor without a reconnect loop. SSE 401/403 rejection clears
   the cached token before bounded reconnect; ordinary network/5xx failure does
   not discard a still-valid token. Heartbeat traffic prevents false timeout, a
   silent stream is restarted, and `online`/visible resume interrupts pending
   backoff without creating a second healthy connection. Timers and listeners
   are removed on abort. Unknown schema-v1 event types cause one conservative
   reconciliation and safe telemetry before acknowledgement, never a poison
   replay loop.

3. **One centralized resource coordinator.** The persistent `/app` shell owns
   one coordinator and at most one authenticated Earn stream per identity.
   Feature code maps events to named resources; it does not own ad-hoc retry
   timers or duplicate cache-key orchestration. For each resource, bursty
   invalidations coalesce, concurrent callers share one in-flight refresh, and
   invalidation during that refresh causes exactly one trailing rerun. Identity
   change cancels or makes old work unable to commit. A deterministic verifier
   proves these observable request-count and ordering invariants.

4. **Canonical and targeted Earn sync.** SSE stays progress/invalidation-only:
   REST/Yield Neon and Solana RPC subscriptions remain authoritative for
   displayed state and balances. Known allowance, execution, transaction,
   position, rebalance, and onboarding events retain their exact targeted
   resource mapping. Initial load and true resync may reconcile all Earn
   resources; healthy events must not call broad `smartAccountData.refresh()`.
   The disconnected Execute-now fallback remains operation-scoped, stops on
   reconnect/terminal/identity change/unmount, and may continue a slow bounded
   terminal check rather than restoring permanent polling.

5. **One mutation reconciliation.** Autodeposit floor, pause/resume, setup,
   close, deposit, withdrawal, and cleanup paths apply safe response/local state
   immediately and register any expected operation/signature. A matching SSE
   invalidation converges with that mutation instead of duplicating its resource
   request. The UI does not wait on an unrelated full overview refresh. Reads
   required to construct or resume the next signing stage remain allowed, and a
   disconnected/missed-event path performs one targeted fallback.

6. **Targeted smart-account refresh.** Smart-account refresh exposes explicit
   `base`, `policies`, `proposals`, `vaults`, `activity`, `earn`, and wallet
   balance groups. Approve/reject refreshes proposals; settings execution
   refreshes proposals/base/policies; policy execution and spending-limit
   changes refresh policies plus proposals when applicable; transfer/swap
   refreshes the affected proposal, vault/activity, and balances. Confirmed
   actions release pending UI before background reconciliation. The forced
   all-groups `refreshAfterTx` path and blind `[800, 2000]` broad refresh sequence
   are absent. Full refresh remains only for cold load, identity change, manual
   recovery, or cursor resync.

7. **Passive request cleanup.** Feature flags no longer use a permanent
   60-second `cache: "no-store"` loop; they retain last-known state and use
   cache-aware startup plus bounded focus/visibility revalidation. The LOYAL
   ticker no longer makes a direct Jupiter request from every tab every minute;
   it uses a same-origin, validated, cacheable server read with stale client
   fallback and bounded retry. Neither concern is added to the private Earn SSE.
   No new permanent network polling is introduced.

8. **Boundaries and follow-up readiness.** Existing Solana account
   subscriptions, auth focus refresh, transaction confirmation/finality,
   user-driven quotes, and local countdown/animation timers are preserved. Web
   routes remain non-custodial. A future cross-signer smart-account event source
   can target the coordinator's groups, but this app-only change does not invent
   client-authored SSE events or claim to implement the routing/on-chain producer,
   cross-tab leader election, mobile streaming, or richer rebalance producers.

9. **Verification.** Preserve unrelated work. `git diff --check`, focused
   realtime contract tests, the deterministic coordinator verifier, targeted
   frontend TypeScript, and lint for every changed frontend file pass. Tests are
   added only after behavior exists and only for replay/auth/storage/ordering or
   observable request-count invariants scoring at least 2 under `AGENTS.md`.
   Negative searches show one mounted `useEarnRealtime` consumer, no blind
   spending-limit delay sequence, and no forced broad post-transaction refresh.
   Never run `frontend:build` or another local frontend production build.

## Verification commands

```sh
git diff --check
bun test apps/web/src/features/earn-realtime/stream.test.ts \
  apps/web/src/features/earn-realtime/invalidation.test.ts \
  apps/web/src/features/earn-realtime/server/token.server.test.ts \
  apps/web/src/app/api/smart-accounts/yield-optimization/realtime/token/route.test.ts
bun run --cwd frontend scripts/verify-realtime-sync.ts
./node_modules/.bin/tsc --noEmit --incremental false \
  --project apps/web/tsconfig.json --pretty false
bun run frontend:lint
rg -n 'const delays = \[800, 2000\]' \
  apps/web/src/components/wallet-workspace/app-wallet-workspace.tsx
rg -n 'await refresh\(\{ invalidateAddresses, readCache: false \}\)' \
  apps/web/src/hooks/use-smart-account-sidebar-data.ts
rg -n 'useEarnRealtime\(' apps/web/src --glob '*.ts' --glob '*.tsx'
```

The first two `rg` commands must return no match. The last must show the hook
definition and exactly one mounted consumer. If full-repo lint/typecheck fails
only in untouched baseline code, record the exact baseline failure and run
focused checks that cover every changed file; do not call that evidence PASS
without the qualification.

## Verdict

Report checks 1-9 individually with commands and code/runtime evidence. Overall
`PASS` requires every Required check. Report an authenticated browser/network
canary separately as `PASS`, `FAIL`, or `NOT RUN`; it does not change the local
verdict when no safe authenticated session is available.
