# Withdrawal preparation and inactive policies

Withdrawal preparation retries the active route-policy projection five times
(over 1.85 seconds of backoff). If no active pair appears, it checks the requested
vault's current policy pointer, scoped to authenticated authority, cluster,
settings, vault index, and vault address—not historical policy generations.

- An inactive vault or current route policy returns HTTP 409 with
  `earn_policy_inactive`, without a `Retry-After` header or transaction preparation.
  The web withdrawal handler invalidates Earn state, position, transactions, and
  earnings so another tab/device's completed cleanup does not leave stale state.
  It does not optimistically clear holdings or assume there is no newer deposit.
- Missing projection without evidence of inactivity retains HTTP 503 with
  `earn_policy_projection_pending` and `Retry-After: 1`.
- A policy that becomes active during backoff proceeds using live RPC holdings.

This classification is shared by web and mobile preparation routes. Inactivity
is a read-model observation, not proof that the vault has no on-chain funds.
No database repair, policy reactivation, or fund movement is performed.

Regression check:

```sh
cd apps/web
bun test src/app/api/smart-accounts/yield-optimization/withdrawals/prepare/route.test.ts
```

## Stale position after confirmed cleanup

The original fix only changed the error to “This Earn policy is no longer active.
Refresh Earn before withdrawing.” Refresh alone cannot repair a stale active
position left behind by the worker.

Web `/earn-state` and `/position` now read the inactive **current** policy generation
and verify full-exit zero holdings (including complete reserve reads and both token
programs) plus closed policy accounts on-chain. Proof is fenced at the position's
observed slot and the policies' last-seen slots. Positive reserve holdings, positive
unknown assets, and canonical idle balances at or above the existing 10,000-raw
unit dust threshold block closure, even when a separate token inventory is empty.
The closure watermark is the requested minimum context slot shared by **all**
proof reads, not the newest holdings chunk or inventory response; this conservative
floor cannot supersede an intervening deposit observed above it. Only successful proof returns
`position: null` with `closedPositionObservedSlot`; inactive metadata, remaining
funds, missing projection, and RPC failures do not clear a position. These reads
do not repair the database.

The position hook accepts this closure proof over older cached/RPC holdings, but
retains a deposit observed after the proof slot. A plain null without proof keeps
its existing conservative behavior. Explicit refresh now queries `/position` when
no policy is available for a direct RPC read; local mutations and accepted closure
proofs invalidate outstanding reads. The hook retains a wallet/cluster/settings-scoped
closure watermark for subsequent refreshes: RPC reads are fenced strictly after
closure (and at least at any newer displayed deposit), and stale RPC/HTTP responses
cannot repopulate either position cache. Scope changes reset that watermark and
invalidate responses from the previous scope. Later deposits remain visible; no
persistent projection or database writes are added.

Focused checks (also run scoped lint and web typecheck):

```sh
cd apps/web
# Separate processes isolate Bun module mocks.
bun test src/lib/yield-optimization/earn-position-read.server.test.ts
bun test src/hooks/use-active-earn-position.test.ts
bun test src/hooks/use-active-earn-position-races.test.ts
bun test src/lib/yield-optimization/earn-full-exit-zero-proof.server.test.ts
```

After deployment, test both a fresh load and an already-open stale tab after full
exit: the inactive-policy alert must refresh into the empty Earn view. Verify a
fresh deposit remains visible and can withdraw after projection catches up; an
RPC outage or nonzero holding must not produce a closure proof.

### Worker deployment and separately approved repair

The worker must also deploy the already-merged closed-obligation withdrawal and
refund-cleanup replay fixes (routing PR #141 and its ancestors), plus the follow-up
policy-deletion job fix. Monitor successful reconciliation and rebalance/autodeposit
heartbeats; a running container alone does not prove services are processing.

For the September 9 incident, audit settings
`27Un5R5iXs5sLtMMCJDSUzjts7RAEvdax2iWMoqP1FWr`, vault index 1, slots
`445608294`–`445608350`. Recover missing withdrawals first, then audit refund-only
cleanup using `loyal-yield-routing/docs/earn-laserstream-gap-reconciliation.md`.
Do not resend on-chain transactions or delete refund history. Execution requires
separate production-write approval; review later deposits and settlement history,
then verify completed jobs, immutable withdrawal/cleanup records, and position
closure. The app read guard is not a substitute for repairing accounting or
Autodeposit's database-backed position gate.
