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

Web `/earn-state` and `/position`, and the public wallet-keyed mobile `/state`,
read the inactive **current** policy generation
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
cannot repopulate either position cache. Scope changes isolate that watermark and
invalidate responses from the previous scope. Web closure evidence is stored separately
from positive caches and does not expire with their balance TTL; remount and refresh
read that scoped fence, including a closure written by another tab. Ordinary RPC
refresh is fenced by the displayed position slot even before any closure. Cleanup
callbacks request reconciliation instead of unconditionally clearing a possibly newer
deposit. Later deposits remain visible; no persistent projection or database writes
are added.

### Mobile read and client boundaries

The mobile state adapter loads all active product rows once. A whole-vault closure
proof uses the newest observation across **all** those rows and returns an empty
aggregate only after complete zero inventory and closed-policy proof. Positive
funds or an open policy prevent closure; unknown, incomplete or failed evidence
cannot authorize reducing the aggregate. There is no second unguarded query that
can sum closed rows back into that response. Fallback
position lookups constrain each row through its own policy's wallet/settings/vault
and yield-owned cluster metadata, including inactive policy generations.

Mobile state adds optional `closedPositionObservedSlot`, position
`currentObservedSlot`, policy-account identities, and wallet/cluster/vault scope fields. Holdings adds the same
scope fields. No-policy holdings still has null observations: its zero is a
placeholder, not a verified balance. Positional account RPC responses must have one
explicit account/null per requested key and a valid slot meeting each request's floor.

The mobile position hook owns the accepted balance and details for both Earn and
wallet tabs. It retains closure fences across owner remounts, invalidates old requests
on identity or mutation changes, preserves funds on missing account mapping or
HTTP/RPC failure, and rejects stale positive/empty responses. Deposit execution now
returns the already confirmed slot; the Earn screen passes that slot and its optimistic
amount to the owning hook from both Earn-tab and wallet-card deposit entrypoints,
instead of independently clearing/overriding balance after a delayed transaction. Pending-deposit metadata is shared between hook instances;
source selections are invalidated on scope changes, local mutations, accepted policy
generation changes, or accepted emptiness. Existing
focus, AppState, polling and mutation refreshes continue through that owner.

For mixed accounting rows, supported products/venues use a complete funded vault
snapshot as the display total instead of adding old and replacement lifecycle rows.
The shared full-exit reader scans all supported product ATAs and Safe-market
obligations, requires complete reserve reads, and checks both token inventories.
Unknown positive inventory, inventory/holdings disagreement, unsupported accounting
products/venues, or failed reads prevent this replacement. A zero snapshot still
cannot close the position without the separate closed-policy proof. Neither rows nor
principal accounting are rewritten, and policy closure alone never removes a product.
The mobile holdings endpoint uses this same complete all-product reader when policy
metadata exists; its no-policy placeholder is unchanged. Funded snapshots advertise
only the common requested context floor, not the newest chunk.

After local deposit confirmation, fresh scoped holdings at or after that confirmed
slot may replace a lagging aggregate even during the mutation grace period; pending
or unfenced mutations retain the grace safeguard. Balance changes invalidate cached
withdrawal sources, and a changed total cannot retain old detail amounts when its
independent holdings read failed. Ordinary read failures retain the last valid balance.

Server changes are additive for released mobile clients, but those clients do not
consume the new ordering metadata. Updated hook/source/pending-deposit behavior needs
an approved compatible mobile JS rollout (OTA only for the appropriate runtime/channel,
otherwise a binary). Deploy compatible server code first. Browser/device canaries and
the resulting Vercel deployment are separate gates; no deployed incident resolution is
implied by local hook simulations. Routing PR #232 remains a separate, unmerged and
undeployed prerequisite at this review; verify its actual rollout and processing health
before claiming durable backend convergence.

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
