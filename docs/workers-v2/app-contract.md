# Workers-v2 app contract (Earn reads)

Status: reviewed inactive implementation increment. The workers-v2 observer and
retail-engine replacements for the writers listed below are NOT live; this file
records the app side of the boundary so root can integrate each owner before the
opt-in gate is ever enabled in a deployment.

Scope of this document: the Earn yield-optimization GET surfaces in `apps/web`
(web session routes and the mobile wallet-keyed twins), the read-service and
repository functions behind them, and the exact repair writers they stop
performing under the opt-in gate.

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
- `1` / `true` → read-only GET mode for the Earn surfaces listed here.
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
(deposit, withdraw, autodeposit setup/toggle/close, sweeps execute,
`position/reconcile` POST, policy-refunds scan). These are desired controls and
receipt verification, which remain app-owned; their internal writes are out of
scope for this gate and must be re-owned per family contract before the engine
takes them over.

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

- The observer does not yet own any of the removed writers; enabling the gate
  before those replacements are live only degrades freshness (no repair, no
  lifecycle progression, no sweep scheduling). It is an opt-in for integrated
  environments, not a migration step.
- Legacy `paused_missing_position` rows must be drained (via the legacy resume
  path or a deliberate migration) before read mode is enabled; read mode
  reports them as `legacy_pause_unrepaired` and never clears them.
- Scheduled read-model work still owned by app crons: hourly Earn reserve
  share-price recording, hourly fleet-allocation recording, public simulation
  refresh (routing branch `docs/workers-v2/audit.md`, "Transfer scheduled read-model
  work"). These writers keep running; transferring them to bounded observer
  loops is a separate increment.
- Routing telemetry is a later increment after the observer contract
  stabilizes; nothing here instruments routing.
- `getEarningsCoverage` (the older path-event coverage variant in
  `earnings-read-service.server.ts`) is untouched; it is not on the live read
  path and should be deleted once its callers are gone.

Review verification (2026-10-02): 51 financial/configuration tests and 16 repository tests pass in separate Bun processes (portfolio tests mock the repository module, so combining those suites pollutes it). The new unit/flag modules pass Biome 2.4.0; the locked Biome 2.3.2 cannot load the locked Ultracite configuration. Whole-web typechecking has the same 85 baseline diagnostics and no new diagnostics at the reviewed checkpoint; it is not a whole-web typecheck PASS. Frontend build and deployment were not run. Read-only position projection resolves collateral from the snapshot's recorded conversion and rejects missing evidence; it never substitutes principal for liquidity exposure. Two mobile Autodeposit GET tests execute the actual handler and pause derivation with Earn repair/RPC writers forbidden; both pass. Identity lookups are mocked in those tests: the existing smart-account lookup may still mark a stale account failed, so this is not proof of zero SQL writes across authentication. Other GET surfaces still need equivalent route coverage and replacement-writer acceptance before enabling the opt-in.
