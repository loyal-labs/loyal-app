# Workers-v2 app contract (Earn reads and desired controls)

Status: reviewed inactive implementation increment. The workers-v2 observer and
retail-engine replacements for the writers listed below are NOT live; this file
records the app side of the boundary so root can integrate each owner before the
opt-in gate is ever enabled in a deployment.

Scope of this document: the Earn yield-optimization GET surfaces in `apps/web`
(web session routes and the mobile wallet-keyed twins), the read-service and
repository functions behind them, and the exact repair writers they stop
performing under the opt-in gate. The same gate also transfers floor-change and
pause/resume scheduling to the retail engine, through desired-control revisions.

## Authority boundary

Per the routing branch contracts at `loyal-yield-routing/docs/workers-v2/contracts.md` ("Writers and authority"):

- Observer owns confirmed financial projections and verified market facts
  (holding events, reconciled position rows, complete exposure snapshots,
  APY/reserve samples, hourly share prices and fleet allocations).
- Retail engine owns Autodeposit/fleet/Multiply autonomous operations, including
  lifecycle progression (pending → active → closed), initial sweep scheduling,
  stale-sweep release, and admission-time eligibility checks.
- Apps own authenticated desired controls/revisions and receipt verification for
  user-signed flows. An Earn GET must not write autonomous financial progress. Existing identity/session validation remains outside this financial ownership gate.

## Opt-in gate

`WORKERS_V2_APP_READ_ONLY_GETS` (`workers-v2-app-contract.server.ts`,
`isWorkersV2AppReadOnlyEarnGetsEnabled`):

- unset / `""` / `0` / `false` → legacy repair ownership. This is the
  default; the unit and APY corrections below apply in both modes.
- `1` / `true` → read-only GET mode for the Earn surfaces listed here, plus
  intent-only floor and enablement changes described below.
- anything else → throws `invalid_workers_v2_app_read_only_gets` so a typo
  cannot silently pick an authority boundary.

## Removed repair writers (v2 read mode) and replacement owners

| App writer (legacy) | Where it ran | What it wrote | Replacement owner under v2 | App behavior when gated |
| --- | --- | --- | --- | --- |
| `reconcileAutodepositArtifacts` (`markAutodepositTargetClosedFromChain`, `markAutodepositTargetPendingDelegation`, `markAutodepositTargetActiveFromArtifacts`, `healPendingEarnAutodepositArtifactProofs`) | web `yield-optimization/earn-state` GET; `mobile/earn/autodeposit/state` GET | target lifecycle progression and chain-proof backfill on `balance_sweep_targets` | observer confirms chain artifacts; retail engine progresses lifecycle | skipped; state served exactly as persisted |
| `reconcileEarnAutodepositPositionPause` (`markAutodepositTargetPausedMissingPosition` + `suppressEarnAutodepositScheduledSweepsForMissingPosition`, `resumeAutodepositTargetFromMissingPosition`) | same two GETs | `desired_active=false` + `chain_status='paused_missing_position'` (the Apps `lifecycleStatus` property maps to `chain_status`; Rust 0059 permits only `pending/active/closed/inconsistent`, despite historical Apps 0024 extending the old column), lot suppression/cancellation, and resume writes | temporary ineligibility is derived per read (app, read-only); admission refusal is owned by the retail engine at sweep time | `deriveEarnAutodepositPositionPause` derives the effective pause with no write; `pauseReason` reports why |
| bootstrap scheduling on GET (`scheduleBootstrapEarnAutodepositSweep` after a pending→active or resumed transition) | same two GETs | scheduled sweep rows from a fresh wallet balance snapshot | retail engine schedules the first sweep on activation | skipped (`activatedFromPending` is never true in read mode) |
| `reconcileStaleEarnAutodepositScheduledSweeps` on GET | same two GETs | cancels scheduled slots / suppresses surplus lots the wallet can no longer back | retail engine revalidates lots/slots before each admission | skipped |
| reconciled-position repairs on position reads (`applyHoldingEventToPosition`, `recordConfirmedYieldRebalance`, `recordSnapshotReconciledYieldHolding` via `findReconciledActiveYieldPositionForVault`) | web `yield-optimization/earn-state` + `position` GET; `mobile/earn/state` GET | position current-holding projection rows / holding events | observer owns the projection | `projectOnly: true` returns the projected position without any write |
| `syncConfirmedRebalanceHoldingEventsForVault` on GET | web `smart-accounts/earn-transactions` GET; `mobile/earn/transactions` GET | backfills rebalance holding events | observer owns holding-event capture | skipped; the read serves whatever the observer has persisted |
| earnings snapshot cache repair (`saveSnapshot` via `readEarnEarningsRangeSet` default deps) | web `yield-optimization/earnings` GET; `mobile/earn/earnings` GET | earnings snapshot cache rows | observer owns scheduled projection/recording | `createEarnEarningsReadDependencies(true)` skips snapshot load/save; earnings recompute per request |

Not gated (still legacy in both modes): the user-signed prepare/confirm flows
(deposit, withdraw, autodeposit setup/close, sweeps execute,
`position/reconcile` POST, policy-refunds scan). These are desired controls and
receipt verification, which remain app-owned; their internal writes are out of
scope for this gate and must be re-owned per family contract before the engine
takes them over.

## Floor and enablement intents

With the gate enabled, `updateAutodepositWalletBalanceFloor` and
`updateAutodepositTargetActive` perform one authenticated, identity-bound
target update. They do not create balance events, lots, scheduled slots or
transaction attempts, or fetch a wallet balance from RPC. Yield migration
`0091_autodeposit_desired_control_revisions.sql` atomically increments the desired
revision and enqueues its reconciliation demand. Both updates reference
`desired_revision`, so a missing migration fails before mutating the target.
Repeating the same desired values does not create another revision.

The floor response retains `status: "skipped"` and adds
`reason: "worker_reconciliation_pending"`. This acknowledges the stored intent;
it does not report successful scheduling. The engine must apply the captured
revision against fresh account and eligibility evidence before admitting a new
unsigned sweep. Existing signed work retains its recovery and custody rules.
User setup, external receipt confirmation and withdrawal cleanup remain app-owned.

The disposable PostgreSQL test
`workers-v2-control-intents.server.test.ts` exercises the concrete Drizzle SQL
adapter and actual trigger: changed floor, repeated floor, pause and wrong-wallet
rejection pass with no financial/scheduling rows created (14 assertions). Its
fixture applies the registered Yield schema and hash-pinned historical Apps
0006 DDL. It excludes that old migration's historical data backfill; this is
application SQL proof, not database migration acceptance. The legacy state suite
also passes independently (34 tests, 78 assertions).

## Desired intent vs. effective eligibility

`serializeAutodepositState` now emits an additive `pauseReason` field (web
payload; the mobile autodeposit state payload gains the same field):

- `null` — effectively eligible.
- `missing_position` — desired enablement is on, but no active Earn route
  policy pair exists to sweep into; sweeps would perma-fail. Derived from the
  route-policy pair check; never written to the target row.
- `legacy_pause_unrepaired` — the row still carries the legacy persisted
  `paused_missing_position` status while the pair exists again. Read mode never
  clears it; the value surfaces the row so it can be drained deliberately.

Desired enablement (`desired_active`) and persisted chain status are returned
exactly as stored in read mode. An unavailable position blocks effective
eligibility only.

## Read corrections shipped with this increment

- Complete exposure snapshots (personal earnings/coverage path) now interpret
  amount units: `kamino_redeemable_liquidity` rows pass through; collateral-unit
  rows (`kamino_obligation_collateral_deposited_amount`) convert with the
  conversion recorded on the same snapshot's planning metadata
  (`yield-vault-exposure-units.shared.ts`). Missing/unknown units, missing,
  malformed, contradictory-alias, or BIGINT-overflow conversion evidence rejects
  the read with `history_incomplete` / `detailCode: "exposure_units_unknown"`
  instead of reading collateral raw as USDC liquidity or silently zeroing it.
- `getPortfolioEarningsCoverage` measures APY-sample gaps only inside merged
  funded spans per reserve, carries the actual last sample across consecutive
  funded snapshots, ignores holes where the reserve is unfunded, and rejects a
  resumed/newly-funded span whose carried seed sample is older than 36h at the
  span boundary (the previously hidden stale-seed case).
- Route-policy/position lookups performed by GETs can run `projectOnly` so the
  same reader cannot write while the gate is on.

## Honest remaining work (not done here)

- Replacement observer/engine owners are implemented on the separate routing
  rewrite branch and are not deployed. Gate activation requires their reviewed
  acceptance and migration writer handoff. This branch does not enable the gate.
- Legacy `paused_missing_position` rows must be drained (via the legacy resume
  path or a deliberate migration) before read mode is enabled; read mode
  reports them as `legacy_pause_unrepaired` and never clears them.
- Scheduled read-model replacements are implemented in bounded observer loops
  on the routing branch. Existing app crons continue running until the eventual
  writer handoff; no cron retirement occurs in this implementation branch.
- Routing telemetry is a later increment after the observer contract
  stabilizes; nothing here instruments routing.
- `getEarningsCoverage` (the older path-event coverage variant in
  `earnings-read-service.server.ts`) is untouched; it is not on the live read
  path and should be deleted once its callers are gone.

Review verification (2026-10-02): 51 financial/configuration tests and 16 repository tests passed in separate Bun processes (portfolio tests mock the repository module, so combining those suites pollutes it). The new unit/flag modules passed Biome 2.4.0. Whole-web typechecking had 85 diagnostics at that checkpoint; it was not a whole-web PASS. Two mobile Autodeposit GET tests executed the actual handler and pause derivation with Earn repair/RPC writers forbidden.

Additional review (2026-10-03): three new ownership suites cover seven GET
handlers, with 18 tests and 132 assertions passing in isolated Bun processes.
They execute actual JWT and mobile wallet authentication branches; actual
position projection and composite Earn-state serialization; and the actual
earnings read service, dependency factory and calculator. Financial repair
writers, cache IO and financial RPC are counted or forbidden. Legacy negative
controls demonstrate that these detectors reach the corresponding writer.
History/provider and identity lookup IO remains a fixture boundary. These tests
do not prove zero identity SQL writes, live provider behavior, or transfer of
user-signed POST ownership. The actual smart-account lookup may mark a stale
account failed.

The source auth mapper rejects a signed mismatched wallet principal before
financial reads, but existing web handlers resolve it outside their error
catches. That baseline rejection lacks a handler HTTP error envelope; the
rewrite does not change it. Whole-web typechecking currently reports 74
diagnostics, with none in the new ownership/intent tests or changed intent
repository. This is not baseline parity or a whole-web PASS. The installed
Biome 2.3.2 cannot load the locked Ultracite configuration; all four new tests
pass a standalone compatible configuration. Frontend builds and deployments
were not run. After command-runner `os24` recovery, all three ownership suites
were rerun successfully with automatic environment-file loading disabled.
Replacement-writer acceptance and migration handoff still gate activation.
