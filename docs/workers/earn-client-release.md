# Earn client transactions and release gates

## Ownership contract

| Surface                               | Responsibility                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Web / current mobile                  | SDK transaction preparation, wallet signing, confirmed RPC submission, local pending-mutation state                               |
| Render / `loyal-yield-routing`        | LaserStream observation, durable reconciliation, canonical chain accounting/projection, SSE invalidations                         |
| State, history, and context APIs      | Authenticated reads of projected state and public RPC inputs; no Yield projection repair on reads                                 |
| Floor, pause/resume, Execute Now APIs | Authenticated user intent/configuration; retain these writes                                                                      |
| Legacy mobile prepare/confirm APIs    | Compatibility for installed clients awaiting OTA; retain existing authentication, ownership, idempotency, and confirmation checks |

The client still refetches REST/RPC data after SSE events. SSE is not a balance
payload and RPC confirmation is not proof that Render's accounting has caught
up. Retain local confirmed mutations until the relevant projected row covers the
transaction slot; a slot from another mint/position is not a vault-wide watermark.
Keep zero/full-withdrawal tombstones so lag cannot resurrect exited balances.
Post-confirm RPC snapshots must be fenced at the confirmed slot. Stale or failed
refreshes must not acknowledge the replay cursor. Cross-request RPC evidence uses
the **minimum** observed slot across every complete account batch, never MAX.

Both web position responses and mobile state include closed `projectedPositions`.
Deposits match initial reserve/mint; withdrawals bind current source rows before
submission, retaining each stage's own slot. Web/mobile immutable history adds
`positionId` and `transactionSlot` from deposit/withdrawal records so idle debits,
rebalance races, and successful WS confirmations lacking exact status metadata
can converge without guessing. The legacy history `confirmedSlot` is a holding
observation, potentially later than landing; it is NOT exact transaction evidence.
A WS context is only an RPC fence, not an exact accounting slot. Both clients
persist scoped pending proofs/full-exit tombstones across reload and retry missing
evidence while mounted, without expiring optimism or resending transactions.
Web blocks RPC replacements until pending transactions have a safe fence.
Unrelated old rows neither acknowledge nor pin a mutation.

Web transaction prepare/confirm/reconcile routes are retired. Legacy mobile
routes remain under `/api/smart-accounts/mobile/earn/`; do not delete shared
legacy internals merely because a web wrapper no longer exists. New mobile
`deposit/context`, `withdraw/context`, and cleanup context requests are reads,
not server-prepared transaction fallbacks.

## Local verification

See [PR #708 verification evidence](./earn-client-verification.md) for the
reviewed revisions, passing checks, fixture accommodations and outstanding gates.

Use an isolated loopback validator and PostgreSQL database, never a funded
production wallet. Do not run frontend production builds locally. Next **dev**
may serve the local HTTP API for a verifier; this does not require starting Expo.
Protocol fixtures exercise real Solana transactions with test Kamino/swap
programs; they do not establish live market execution or native wallet UX.
The runner preflights TCP/UDP port blocks without stopping existing services;
a concurrent port-allocation race still fails closed rather than killing them.

This PR owns the cross-repository orchestration in `scripts/earn-local-e2e/`;
no companion routing PR is required. Routing supplies its existing production
Rust code and SBF fixtures. From the app root:

```sh
LOCAL_E2E_SCHEMA_FIXTURE=1 bash scripts/verify-earn-local-e2e.sh \
  --routing-root ../loyal-yield-routing --suite all
```

Individual suites are `autoswap`, `autodeposit`, `earn-client` (web SDK driver),
and `mobile` (production mobile deposit/withdraw modules, real authenticated
HTTP context/state/history, separate cleanup and projection/SSE). `all` runs
all four. Set `LOCAL_E2E_EVIDENCE_DIR` to retain routing evidence and
`LOCAL_E2E_MOBILE_REPORT` for the mobile JSON report. Headless mobile replaces
native storage/analytics/RPC platform adapters, not the money-moving actions.
The ordinary SDK driver does not cover cleanup; the mobile driver does.

The Python schema helper first attempts normal migrations. Only explicit
`LOCAL_E2E_SCHEMA_FIXTURE=1`, migration 71's exact known cardinality failure,
and an empty route table permit applying its schema prefix plus registered
72/73 schema. It excludes the production Backyard-row conversion, creates no
fake migration-ledger entries, and does **not** certify production migrations.
Only passwordless `127.0.0.1` PostgreSQL URLs with the three exact fixture DB
names and no query/fragment overrides are accepted. The Autodeposit fixture
also deactivates only its synthetic seed-999 legacy observation before the
independent real policy close assertion. The mobile HTTP fixture applies app
migration 0006's policy schema to empty sweep targets without its obsolete
lifecycle backfill; this is likewise schema accommodation, not migration validation.

Use the actual reviewed worktree paths rather than these sibling examples when
working in a separate worktree. App drivers live in `apps/web/scripts/` and
`apps/mobile/scripts/`. Record the routing revision, client revision, fixture
accommodations, exact commands, and assertions in the release evidence. A
production-data migration requiring exact existing rows must not be weakened for
a test database; any local fixture exclusion must be explicit and local-only.

Required acceptance scenarios:

- Initial deposit and top-up; real signing/submission, balance conservation, no
  supported-client prepare/confirm/reconcile POSTs, and projection/SSE handoff.
- Partial and full withdrawal, including Autodeposit closure and policy cleanup;
  confirmed withdrawals cannot be retried merely because projection is delayed.
- Autodeposit staged setup, resumed setup after cancellation, inbound execution,
  floor changes, pause/resume, and deletion.
- Autoswap classic/Token-2022 policy setup, execution, pause/resume, and removal;
  policy creation alone is not execution coverage.
- Delayed projection, failed refresh/replay, cursorless reconnect, expired
  sessions, wallet switching, and both mobile unlocked wallet modes.
- One installed-release compatibility flow against the new backend.

`bun apps/web/scripts/verify-earn-confirm-single-writer.ts` checks retired web
routes, installed-mobile compatibility, confirmation/no-write contracts, and
zero/slot proofs. `bun scripts/verify-earn-autodeposit-persistence.ts` adds the
Autodeposit persistence contracts; its old source-string and `--live` modes are
retired. Historical `verify-earn-{mainnet,devnet}-flow.ts` live paths are disabled
because they could submit funds before calling removed APIs; the mainnet script
retains its explicit offline policy mode only.

Run scoped lint, mobile typecheck/Jest, and existing relevant web contract suites
in addition to E2E. Record failures and untested scenarios explicitly. Passing
SDK fixtures or typechecks alone is not a web/mobile UI E2E result.

## Web then mobile rollout

1. Verify the PR head passes Vercel for `apps/web` (Root Directory `apps/web`).
   Merge with squash only after review and successful checks. Deploy the backend
   before publishing mobile OTA so the new read contracts exist first.
2. Confirm Render workers and LaserStream are healthy: fresh workflow telemetry,
   advancing stream progress, no stuck reconciliation backlog, and realtime
   `/readyz` reporting its database listener ready. Service liveness and absence
   of alerts alone do not prove money-moving jobs execute correctly.
3. Smoke-test the deployed web and legacy mobile routes. Keep legacy mobile
   compatibility throughout OTA rollout and rollback.
4. Check EAS authentication, the installed binary runtime versions, and channel
   mappings. This app uses project `7ecfef22-fa74-4fc9-b2f1-bf80acb81401`, app
   version `0.1.2`, and `runtimeVersion: { policy: "appVersion" }`. The migration
   does not introduce a native dependency, plugin, or runtime-version change;
   that alone does **not** prove every installed binary is compatible.
5. Publish/test an OTA preview on the matching native runtimes before production.
   Production iOS/Play Store use the `production` channel; dApp Store Android
   uses `dapp-store`. Match the build variant when exporting/publishing:
   `PLAY_STORE_BUILD=true` for Play Store Android, `DAPP_STORE_BUILD=true` for
   dApp Store, and neither flag for production iOS. Do not combine differently
   configured Android variants into one update.
6. For OTA, use the intended EAS environment and explicitly verify embedded
   `EXPO_PUBLIC_*` values: Earn API `https://askloyal.com`, Solana `mainnet`, and
   the correct chat/auth endpoints. EAS Build profile `env` values are not a
   guarantee that an independently invoked `eas update` uses the same values.
   Never embed server secrets in the update or write plaintext env files.
7. Record update group IDs and the previous known-good groups. Canary all four
   flows on device, then expand rollout. Roll back to the known-good compatible
   group if needed; keep the backward-compatible web deployment in place.

Publishing an OTA, merging a PR, and moving production funds are separate
release actions. Preparing this PR does not perform those actions implicitly.
