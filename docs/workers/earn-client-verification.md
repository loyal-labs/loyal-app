# PR #708 implementation verification — 2026-09-08

This evidence belongs to the implementation update carrying this note, not the
previous green PR head. Work was based on app `main`
`0d7e44a1b2721eeed4a2c964a53a0609561497b5`; routing fixtures used unchanged production
code at `9b3e375347da0c78c745c083610d8088a13cfc2c`. Fixture logs printed the app parent
`d89ff25` while the implementation edits were uncommitted. Require Vercel/checks
on the newly published implementation head before merging.

## Passing local checks

- Mobile: 24 Jest suites / 167 tests; full `tsc --noEmit`; scoped Expo lint.
- Web: 116 tests across 16 separately executed suites (realtime, policy/client
  flows, RPC, confirmation, repository/history and formatter contracts); scoped
  lint and focused modified-code typecheck. Whole-package web typecheck has
  independently observed pre-existing failures, so it is not claimed passing.
- Ownership/persistence verifiers, shell syntax, Python compilation,
  hostile fixture DB URL rejection, and `git diff --check`.
- App-owned Autoswap classic/Token-2022 setup/close/pause fixture and Autodeposit
  setup/close, same-slot wakeup, recovery/reconciliation and SSE fixtures.
- Web SDK and production mobile action drivers: initial deposit, top-up,
  partial/full withdrawal, conserved wallet balances, projection/SSE; mobile
  separately confirms cleanup and verifies both policy accounts are absent.
- Real HTTP history resolves immutable `positionId` and **exact** `transactionSlot`;
  the latter is checked against actual chain status, not later observation slots.

Reproduce from the app root with local prerequisites installed:

```sh
bun apps/web/scripts/verify-earn-confirm-single-writer.ts
bun scripts/verify-earn-autodeposit-persistence.ts
LOCAL_E2E_SCHEMA_FIXTURE=1 bash scripts/verify-earn-local-e2e.sh \
  --routing-root ../loyal-yield-routing --suite all
```

The ownership command also runs the checked-in inert read/recovery and mobile
realtime verifiers. They execute real hooks/providers/readers with controlled
I/O boundaries, checking cursor acknowledgement, silent/explicit session renewal,
per-row/per-stage accounting, unknown-slot no-RPC behavior, failed/superseded
refreshes, durable reload/full-exit protection, duplicate callbacks and scope
changes. They do not mount an installed native UI.

The schema accommodations and exact suite limits are documented in
[the release guide](./earn-client-release.md). Local Kamino/swap programs and
market reads are fixtures; native MMKV can warn and use the headless fallback.
Neither migration 71's production-data conversion nor the historical app policy
backfill is certified by these runs. All orchestration ships in this app PR;
no companion routing PR or routing service deployment is needed for these tools.

## Remaining release gates

No new production transfers, merge, deployment or OTA were performed. Actual
Autoswap swaps, Autodeposit sweeps, full authenticated floor/toggle flows,
cancel/resume UI, installed-old-client compatibility, device approvals,
background/reconnect UX, and matching-runtime OTA preview remain unverified.
The configured production 1Password app/routing files were absent and EAS was
not authenticated during review; restore access before those release checks.

ClickStack showed fresh fleet/ATA/Autodeposit telemetry through 18:59 UTC. Latest
reconciliation gauges were 0 failed-pending, 2 pending, oldest pending age 1;
no matching ERROR/FATAL logs appeared in the bounded preceding hour. These are
liveness/backlog observations, **not** proof of successful money-moving sweeps.
Follow the web-before-mobile rollout and rollback gates in the release guide.
