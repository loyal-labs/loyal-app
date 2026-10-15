# Critical journey observability

## Current verification and rollout — October 14

- [Datadog dashboard](https://us5.datadoghq.com/dashboard/yww-hgc-nev) is saved
  and read back with eight widgets. Observed RUM journey cardinalities and
  completion latency are exploratory; the admin dashboard owns exact ten-minute
  mature cohort denominators. RUM's server-verified traffic cohort is available
  after the latest preview; older actions without it are excluded by default.
- The synthetic preview is
  `https://loyal-frontend-rd7karwb9-loyal-team.vercel.app` (Vercel Ready).
  No production deployment or transaction broadcast was performed.
- A real browser fixture exported a successful journey and a simulated fresh-wallet
  failure followed by retry success through the preview exporter, ClickStack and
  Datadog. The admin login → User journeys → Synthetic path displayed 1/2
  first-attempt success, 2/2 eventual success and the retained failure using real
  ClickStack rows. Initial timestamps were deliberately backdated nine minutes in
  ClickStack to exercise maturity; these durations are not performance evidence.
- Telegram receipt was confirmed by the user. The temporary test alert evaluated
  OK → ALERT → OK, then was deleted to prevent repeated test pages. Recovery
  notification receipt was not verified. The saved search remains for evidence.
- The existing Telegram relay now supports a compact summary with a labelled
  evidence link; 72 relay tests cover delivery and HTML fallback. The formatter
  still requires deployment. Enable the summary templates only after deployment.
- An unauthenticated deposit-confirm probe returned 401 and produced backend
  spans with the supplied trace and parent-span IDs. It stopped before any money
  movement or persistence. Worker correlation currently joins the acknowledged
  scheduled-slot ID to existing worker logs; full worker W3C propagation is not
  implemented here.

Exact IDs, checks and boundaries are in
[`critical-journey-verification.json`](critical-journey-verification.json).
These observations supersede older progress notes below that say the canary or
Datadog search has not yet been verified.

### Repeatable no-funds canary

`apps/web/e2e/live-canary.cjs` starts and stops the dedicated browser fixture,
uses the real tracker and Datadog SDK, and forwards six deposit lifecycle events
to `JOURNEY_CANARY_URL`. The URL must be an HTTPS Vercel preview origin; the
receiver additionally requires a non-production synthetic environment through
`x-loyal-synthetic-probe: 1`. It never calls a transaction endpoint. Wallet,
simulation and chain outcomes are controlled fixture inputs.

Run from the repository with the existing Vercel login:

```sh
JOURNEY_CANARY_URL=https://YOUR-SYNTHETIC-PREVIEW.vercel.app \
JOURNEY_CANARY_EVIDENCE=/tmp/journey-canary.json \
vercel env run --scope loyal-team --project loyal-frontend -- \
node apps/web/e2e/live-canary.cjs
```

Install the existing Playwright dependency/browser first. An existing Chromium
can be selected with `JOURNEY_CHROMIUM_PATH`. Evidence contains only allowlisted
telemetry. Wait ten minutes for these unmodified timestamps to enter mature
admin denominators. The script checks HTTP acceptance and cohort classification;
query Datadog and ClickStack by the printed attempt IDs to verify ingestion.

The six-hour GitHub workflow runs deterministic browser/SDK checks plus read-only
web-entry and ClickStack-health requests. It activates only after merge and is
not a fifteen-minute outage pager. GitHub failure notifications are independent
of ClickStack; Telegram outage delivery still requires independent monitoring.
Datadog MCP exposes draft monitor creation and existing synthetic editing, but
no synthetic creation tool or monitor publication tool. No existing Datadog
synthetic tests were found. Production heartbeat absence alert activation also
waits for the first actual deployed heartbeat, avoiding a false outage page.

### Remaining boundaries

Production web/admin/relay rollout and CI activation are pending. This mixed
change does not qualify for the admin-only auto-merge rule. No new credential is
currently required for the implemented dashboard or canary. Missing terminal
client events remain unresolved; inferred abandonment is not currently reported.
Deposit `initial` means policy initialization, not a verified lifetime-first
customer deposit. The October 13 incident's exact wallet-specific cause remains
unproven; dependent fresh-wallet batch simulation and rejected-signature
classification are covered by deterministic SDK regressions.

## Existing infrastructure audit (2026-10-13)

ClickStack discovery returned Logs `6a58601284f8f1d4ff4d12a5`, Traces
`6a58601284f8f1d4ff4d12a8`, Metrics `6a58601284f8f1d4ff4d12ab`, and Sessions.
The existing Errors alert (`6a60c6b9dcc64beb0ded91c3`) evaluates every minute,
groups by ServiceName, has threshold 1 with comparison `above`, and sends to
TG Direct (`6a60b666dcc64beb0ded8d48`). Do not assume this pages on one event:
verify the threshold comparison with a controlled probe before changing it.
TG Alerts (`6a5fb650dcc64beb0ded6c1d`) is another configured destination.
Reuse these destinations; do not add a Telegram bot or parallel relay.

Worker warning, silence, NAV-staleness, restart-loop and mobile wire-contract
alerts already exist. The worker silence and NAV alerts were in ALERT at
discovery; this alone does not establish an active production incident.
Source schema, saved searches and live logs were subsequently accessible. The
seven-day frontend baseline had 81 sign-in starts (72 UI completions) and 43
deposit starts (17 UI completions, 14 prepare failures, one submit/confirm failure).
These are historical attempt counts, not retry-aware conversion rates, and
include traffic whose membership is unknown. Telegram receipt is unverified.
An OK alert state is not proof of ingestion health.

The webapp exports allowlisted lifecycle events through
`/api/observability/events` to OTLP. `x-loyal-flow-id` joins browser attempts to
backend provisioning/confirmation work. It is currently an **attempt ID**,
not a durable cross-retry journey ID. The new `loyal.journey.id` groups attempts;
`loyal.event.id` deduplicates aggregation and `loyal.attempt.number` preserves
first-attempt outcomes. Correlation headers propagate the journey to cooperating
Next API handlers. Instrumented requests also propagate W3C trace context into backend logs and spans. Loading metrics already measure dependency
latency. Admin `/metrics` uses the existing authenticated ClickStack series API.

The requested provider is **Datadog**, corrected by the user. Its browser SDK
already exists in the legacy Telegram app and its native SDK in mobile; the
current webapp previously used Mixpanel. This change adds allowlisted Datadog
custom actions to the webapp and preserves existing Mixpanel integrations.
`NEXT_PUBLIC_DATADOG_APPLICATION_ID` and `NEXT_PUBLIC_DATADOG_CLIENT_TOKEN`
are configured for web production and preview using the existing US5 RUM project.
The application changes still require deployment. Replay and automatic error/resource collection stay
off; raw wallet addresses, error strings, signing payloads and amounts are not
sent by the new RUM actions.

## Journey map and success contracts

Durations below are initial operational budgets, not measured percentiles.
Wallet prompts and approval screens can legitimately exceed these budgets.

| Journey / entry                        | Prerequisites and steps                                                                                                                                   | Authoritative success                                                                            | Budget / owner                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Sign in / Connect                      | Privy or wallet proof; wallet selection, proof, backend provisioning, session issue, refresh, signer match                                                | Backend session valid AND selected signer matches; separately observe first authenticated action | 30 s service work; 5 min user approval / web identity                      |
| Return or refresh / app load and focus | Session read, expiry/refresh decision, Privy readiness, adapter restore                                                                                   | Session valid; signing readiness is a distinct condition                                         | 15 s / web identity                                                        |
| First Earn deposit / Deposit           | Authenticated signer, eligible mint, source funds and SOL; prepare, review, policy/setup, simulation, signing, submit, confirm, persist, position refresh | Confirmed chain transaction, recorded deposit, authoritative position visible                    | 2 min service work; 10 min attribution / web Earn + SDK + RPC + Yield Neon |
| Subsequent deposit / Deposit           | Same signer/funds checks; existing policy reuse; prepare through visible position                                                                         | Same as first deposit                                                                            | 2 min; 10 min attribution / web Earn                                       |
| Partial withdrawal / Withdraw          | Position and authority; prepare, sign, confirm, persist, refreshed holdings                                                                               | Confirmed withdrawal and updated holdings                                                        | 2 min; 10 min attribution / web Earn                                       |
| Full exit / Withdraw all               | Close autodeposit when required; withdraw, verify exit, cleanup policies, confirm cleanup                                                                 | Confirmed withdrawal plus authoritative exit/cleanup                                             | 5 min service work; 10 min attribution / web Earn                          |
| Autodeposit setup/change / settings    | Position, authority, delegation; prepare, approval, policy, persist, bootstrap                                                                            | Backend configuration read reflects confirmed state                                              | 2 min / web Earn + yield workers                                           |
| Autodeposit execute / execute now      | Active configuration and scheduled slot; request, worker progress, confirmed result                                                                       | Worker confirmed completion; persistence independently recorded                                  | Existing worker deadline / yield workers                                   |
| Earn MAX / invite and vault            | Redeemed invitation, authority; deposit or request withdrawal, wait, claim, refresh                                                                       | Confirmed action and refreshed vault state; withdrawal request is not a completed withdrawal     | 2 min action, 600 s protocol wait / web Earn MAX + Voltr                   |
| Swap / Swap                            | Authenticated wallet, balance and quote; build, sign, submit, confirm, refresh                                                                            | Confirmed transaction and refreshed balance                                                      | 2 min / web wallet + Jupiter + RPC                                         |

## Regression findings

First-deposit ordering fix (ASK-2326): web Earn setup now uses
`sign-and-confirm-each`. Policy creation, policy finalization and deposit are
signed separately, after the preceding transaction confirms and its backend
recording succeeds. Top-ups without setup keep the single-transaction path.
The approval review lists every transaction and explains the separate prompts.
SDK regression fixtures reproduce missing-predecessor rejection under the old
batch ordering, verify compiled transaction signatures under sequential ordering,
and stop progression on rejection, unresolved confirmation or recording failure.
Wallet simulation and RPC are mocked; this is not a mainnet Kamino execution
test or proof of the exact historical user incident. Reserve-selection failures
(`no_eligible_reserve`) remain a separate diagnostic path.

The audit found the following pre-change behavior:

- Privy tracking starts inside the post-authentication handshake effect. Login
  cancellation and provider failures before that effect are unobserved.
- Privy completion ignores adapter connection rejection and can record
  `ui_commit` without a usable signer. Reload restoration silently ignores
  connection failures. These are code-level observability gaps, not proof of
  the October 13 incident's exact cause.
- First-deposit batch signing presents dependent policy/setup/deposit
  transactions together before predecessor accounts exist. Wallet simulation
  of a later transaction can therefore fail on missing accounts. The SDK has
  post-failure simulation and `SquadsMissingAccountSimulationError` diagnostics;
  the UI/executor boundary converts errors to display strings, losing typed
  attribution. Reproduce with a dedicated fresh fixture before changing the
  transaction sequence. Do not use a production wallet or send real funds.
- Deposit preparation silently retries `no_eligible_reserve` three times.
  Successful retries currently hide initial failures.
- Deposit UI completion can carry `persistenceState=failed`; it updates the
  position optimistically. This must not count as authoritative journey success.

## Metric and alert requirements

Count distinct journeys entering a versioned flow, not events or HTTP requests.
An attempt belongs to one journey; retries preserve the first failed attempt.
Report first-attempt success and eventual success within the attribution window
separately. Late confirmations are late recoveries, not retroactive first-pass
success. Include cancelled, validation, technical failure and unresolved counts.
Completion latency uses successful journeys; also show unresolved age and sample
count. Never replace an unavailable query with zero failures.

Missing client terminal events mean **unresolved**, not proven failure or
abandonment. Infer abandonment separately after the window, excluding known
pending chain operations. Sustained stalls need positive pending/server evidence.
Production-user cohorts must exclude positively tagged internal/synthetic events;
historical untagged traffic has unknown membership. Keep environments and client
release separate from the ingestion server release.

Reuse Errors for technical failures and the current TG destination for new
aggregate alerts. Calibrate thresholds against actual traffic before activating
rate alerts. At low volume show counts; avoid percentage paging without a minimum
denominator. Deduplicate by flow, step, release and incident window, and send one
recovery notification. Include owner, impacted journey/user count, release and
ClickStack evidence link. Heartbeat loss must have a separate alert and independent
delivery health check; an alert evaluated inside a dead ClickStack cannot detect
its own outage.

## Investigation runbook

1. Establish UTC window, environment, client release and flow/attempt ID. Open
   ClickStack and filter lifecycle logs by `loyal.flow.id`; follow browser and
   server stages in timestamp order. Check deployment version independently.
2. Check `loyal.chain.state` before recommending a retry. Submitted/unresolved
   requires signature reconciliation; confirmed plus persistence failure requires
   repair/read refresh, never another deposit.
3. For fresh-wallet failures distinguish insufficient SOL, policy missing-account
   simulation, user rejection, signing failure, RPC submission, confirmation and
   persistence. Do not export transactions, signatures, amounts, tokens or SDK
   logs containing sensitive payloads into product analytics.
4. For auth compare Privy state, session wallet and adapter readiness separately.
   A valid cookie does not prove the wallet can sign. Account switching must reset
   analytics identity before identifying the new wallet.
5. Check collector/export health when evidence is absent. Verify alert evaluation
   AND Telegram receipt; do not interpret silence as recovery.

## Implemented behavior and activation

- Authentication now starts tracking before Privy login, captures cancellation,
  checks the returned backend wallet, and refuses to report success without a
  connected matching signer. Session hydration, return/focus checks and refresh
  use a separate `auth.session_restore` flow. That flow proves backend validity,
  not signing capability. Wallet connection and Privy auth remain distinct.
- Deposit errors retain typed simulation/rejection/unconfirmed-submission
  attribution. Explicit wallet error code 4001 cannot be overwritten by SDK
  diagnostic simulation. The batch signing/submission sequence is unchanged.
- A recorded deposit updates the UI as before, but success is emitted only when
  a matching nonzero RPC holding is visible at or beyond the confirmed slot.
  Persistence failure is terminal failure, not success. An active browser still
  waiting after 60 seconds emits a nonterminal `timed_out` event; later success
  remains possible and never becomes first-attempt success.
- Retry context is retained for ten minutes in tab-scoped session storage. It
  contains journey IDs/counters and a hashed owner, never wallet/signing material.
  Reload restoration waits for a matching authenticated identity; logout/account
  switching clears it and suppresses stale trackers. Storage/hash failure falls
  back to page-only context. Actions started before identity restoration may start
  a new journey. Other tabs have separate contexts. Anonymous-to-authenticated RUM
  sessions remain continuous; logout/account switching ends the old RUM session.
- Admin `/journeys`, reachable in the Core sidebar, uses the existing server-side
  ClickStack API credentials (`LOYAL_CLICKSTACK_API_URL` (this deployment uses `/api/api/v2`), and
  `LOYAL_CLICKSTACK_API_KEY`; `CLICKSTACK_API_KEY` is also accepted). Its bounded seven-day search withholds rates on
  errors or 2,000-row truncation. A journey containing a verified internal event
  belongs to the internal cohort, including its anonymous entry. Unknown anonymous
  traffic otherwise remains in the production cohort. Maintain
  `OBSERVABILITY_INTERNAL_WALLETS` with all internal wallets; its default retains
  the existing Errors search's known exclusion. Synthetic tagging requires
  `OBSERVABILITY_TRAFFIC_KIND=synthetic` on a non-production deployment.
- `loyal.journey` Datadog actions carry flow, step, outcome, journey/attempt/event
  IDs, retry count, normalized category, provider, release and timing. Funnel
  filters should select `outcome=started, step=intent` and `outcome=completed`;
  group attempts by journey ID. Native per-user funnels alone cannot supply
  the same journey denominator as the admin aggregation. RUM startup buffers up to 100 allowlisted actions; browser blocking or a longer
  outage can still lose events. ClickStack coverage is independent.

The dashboard's first-attempt denominator is mature (at least ten-minute-old)
journeys with an observed attempt-1 start. Cancellations stay in the denominator;
first-attempt success excludes retries and observed timeouts. Eventual success
must occur within ten minutes of entry; later completion is shown as late recovery.
The failure count retains recovered failures; affected users counts unique
pseudonymous identified users with failures or observed timeouts. p95 uses successful mature journeys.
Missing start events and legacy unversioned events are excluded. Existing `initial`
deposit variants describe policy setup, not independently verified lifetime-first
user deposits. Other instrumented flows inherit IDs/retries but retain their
existing terminal success contracts; these have not all been tightened to
confirmed visible balances.

## Alerts

The checked-in configuration is [critical-journey-alerts.json](./critical-journey-alerts.json).
The existing **Errors** alert and TG Direct destination are retained. No second
technical-error relay or Telegram bot was created.

A new saved search, `6ace1464f1ee537a8e910b64`, and alert,
`6ace1471f1ee537a8e910b69`, cover confirmed recorded deposits still lacking visible
RPC state after 60 seconds. It evaluates every five minutes and triggers on any
matching event (`count > 0`), grouped by flow, step and client release. Each active
pending tracker emits one timeout. Low-volume single-user impact is actionable
because chain confirmation has already happened. The message names web Earn as
owner and links to matched journey/user rows and the admin dashboard. Evaluations
at 11:25 and 11:30 UTC on October 13 were OK with no query errors and zero matches;
this verifies evaluation, **not notification delivery or recovery**.

A live release-regression alert (`6ace5c09f1ee537a8e910e5b`) reuses TG Direct
and the ClickStack evaluator. It evaluates the latest release hourly over a
rolling six-hour window: at least ten mature journeys, at least three with a
first-attempt technical failure/stall, and at least 25% impact. With ten or more
older-release baseline journeys in the previous seven days, it also requires
at least twice the baseline rate and a 15 percentage-point increase. Below ten
journeys, the existing Errors and deposit-stall alerts supply coverage. Query:
`journey-release-regressions.sql`. The diagnostic dashboard intentionally uses
this fixed rolling window rather than its time picker. Live query returned zero;
read-only SQL fixtures produced regression=1, low-volume=0 and already-unhealthy
baseline=0. This does not verify notification delivery or native alert deduplication.

A production heartbeat
producer now uses the existing cron authentication and OTLP exporter every five
minutes. Its route returns 503 on exporter failure. The 15-minute absence alert
is specified in `pendingActivation` in the alert configuration; enable it only
after a deployed heartbeat is observed. This detects absent production/exporter
activity separately from healthy zero-error periods; if ClickStack itself is
down, its own alert evaluator cannot notify Telegram. Use a minimum ten mature journeys per release/window before
rate comparisons; below that show counts and use technical-error/stall alerts.
Do not enable the silence alert before the heartbeat producer is deployed.
The events route now returns 503 when the OTLP exporter cannot accept an event;
this prevents a future external probe mistaking disabled telemetry for success.

## Evidence and remaining verification

Historical live logs (old instrumentation, not proof of the new success contract):

- Successful top-up attempt `2a1f11c5-dab0-4565-a54f-b0834c1d07ec`, October 13,
  06:28:05.845–06:28:11.488 UTC, release
  `10eb3dd36371debfba6de47bca45871a5cece3f4`: intent, prepare, review, wallet
  submission, slot resolution, backend confirmation and UI completion.
- Failed resumed deposit `9794cf7d-6395-408c-9d0a-46ccbc4f8507`, October 11,
  19:44:30.178 UTC: `wallet_submit_confirm / unexpected_error`. No detailed
  simulation cause was retained. Two October 12 prepare failures also retained
  only `request_failed`. The October 13 meeting incident's exact cause remains
  unproven; do not equate a plausible mechanism with incident attribution.

Controlled evidence:

- Browser-contract coverage includes: injected fresh-wallet simulation
  failure then retry success; rejection/offline delivery/account-context reset;
  real session-provider returning-session restoration and expiry; and authenticated-action
  retry/deduplication, trace propagation and identity reset. The actual
  tracker posts browser events, and the real dashboard aggregator preserves a
  0/1 first-attempt rate alongside 1/1 eventual success and one affected user.
  Privy UI, wallet SDK prompts, RPC, chain and ClickStack transport are mocked.
  This is **not full product-route E2E coverage**.
- Two SDK regression tests pass: a dependent batch transaction exposes the missing
  setup-account simulation diagnostic before any send; explicit user rejection
  remains rejection without sending or simulating. These compile real transaction
  wire through the SDK with mocked wallet/RPC and no signing keys or funds.
- 86 focused observability tests pass, including reload-owner isolation, trace joins, strict traceparent
  validation, withdrawal visibility, retry preservation and authenticated heartbeat
  delivery failure/recovery. Two other SDK wallet tests fail identically
  on unchanged HEAD because their mock wallets return transactions without payer
  signatures; the new regression tests pass independently.
- Admin login → sidebar → `/journeys` was checked in Chromium. Unavailable
  telemetry is visibly distinguished from healthy zero failures. A local query
  fixture verifies the recovered-failure row and first/eventual rate display.
- Web typecheck passes after rebuilding stale db-core declarations with
  `build:db-packages` (package build, not a frontend production build).

Current browser verification (October 14): all fourteen scenarios pass, including
returning-session reload/expiry and delayed visibility timeout followed by recovery.
The reload failure was in the fixture: loading Bun's module bundle as a classic
script exposed Datadog's internal `addEventListener` globally, overwriting the
browser method. Loading it as a module fixes the collision. Every browser scenario
now also asserts that no uncaught page exceptions occurred. The delayed-visibility
case drives the tracker deadline explicitly; it does not exercise the product's
60-second watchdog or real chain confirmation. CI has not run remotely.

Run browser contracts with `cd apps/web && bun run test:journeys`. CI and a
six-hour schedule run the same isolated tests through `web-journeys.yml` once
merged. This schedule is a contract check, **not a production synthetic monitor**.
No frontend production builds, real transactions, commits, pushes or deployments
were performed. Datadog public project settings and the ClickStack release alert
were configured; those changes do not deploy application code.

Verification uses mainnet: the system does not support devnet testing. Reuse the
main checkout's existing environment configuration for read-only application and
telemetry probes. Keep injected wallet, simulation and confirmation failures in
isolated local fixtures; these do not move real funds. A new deployment environment
is not a prerequisite for this work. Mainnet transaction execution is not covered
by those fixtures.

Access verified on October 13: the default Vercel CLI authentication is Loyal
(`main-6502`, team `loyal-team`); the separate `~/.config/vercel-personal` context
is personal (`vladzima`). No reauthentication is required. The web deployment
already has OTLP endpoint/ingestion credentials; admin already has its API URL/key.
The working admin REST base is
`https://observability.5.161.121.229.sslip.io/api/api/v2` (the repeated `/api` is the
configured reverse-proxy path). A real log search and the actual `getJourneyData`
loader both succeeded against it using the supplied query key. Zero version-2
journeys is expected until the local changes deploy, not proof of healthy flows.

The existing Datadog browser application from the legacy frontend accepted a
synthetic local fresh-wallet simulation-failure action (HTTP 202). Its public
application ID/client token are now configured for the web project's Production
and Preview targets, without creating another Datadog application. A deployment
is required to activate the new SDK code. Intake acceptance does not prove that
the event is searchable in Datadog or that a funnel/dashboard is configured.

New browser attempts send W3C `traceparent` on instrumented API requests. Backend
request trackers inherit the trace and parent span and create their own span.
OTLP logs link to checkpoint spans; terminal events also export the complete
attempt/request span. Checkpoint latency is the interval since the prior
checkpoint, not an independently instrumented RPC span. `auth.authenticated_action`
tracks the first successful overview read per page/identity, separately from
wallet, Privy and backend-session validity. Failed attempts can retry; concurrent
readiness reads are deduplicated. Account switching resets that readiness state.

Earn MAX now waits for refreshed confirmed activity matching its transaction
before reporting visibility; a swallowed refresh failure no longer reports success.
Withdrawals with recording failures report a failure, and swap quote retries remain
visible. A proposed swap is not reported as confirmed completion. Withdrawals now require a committed RPC observation at or beyond the withdrawal
slot showing a reduced source holding or an empty full-exit position. An optimistic
position object cannot satisfy that check. Concurrent deposits or interest accrual
can conservatively prevent a partial-withdrawal visibility match; swap balance visibility now waits for a later portfolio snapshot.

Deployment/verification gaps: no new-code failure has traversed the complete
Datadog → ClickStack → admin → Telegram path, and alert firing/recovery remains
unverified. Full Privy/adapter product-route E2E,
async-worker trace propagation, authoritative balance visibility for remaining
flows remain unfinished. The heartbeat absence
alert awaits deployment and an observed heartbeat before activation.
Mixed web/admin changes require a requested PR/deployment under repository policy.

Deep links use the documented [ClickStack search parameters](https://clickhouse.com/docs/clickstack/url-parameters).

October 14 follow-up: recovered explicit timeouts remain in the admin diagnostic
list with their original stalled step and attempt link. “Had a timeout” is
separate from failure and unresolved counts. Affected users includes identified
users with either explicit failures or timeouts, deduplicated across the flow
cohort; missing events alone do not enter this count. The browser contract checks
that a recovered timeout keeps first-attempt success at zero while eventual
success becomes one. The actual admin login → sidebar → journeys path was checked
with a local query fixture, including the recovered timeout row.

The visibility review found `use-swap.ts` completing at `ui_commit`
before `SwapPane` called `refreshWallet`; the swap follow-up below fixes this.
Earn MAX now returns the confirmed RPC snapshot slot and the confirmed activity
transaction slot. Completion requires the matching signature and a snapshot at or
after that transaction. Missing slot evidence or stale snapshots remain pending;
legacy responses cannot produce false completion. Two regression tests cover stale,
matching, newer and missing evidence. The existing four Voltr instruction wire
tests still pass. Swap balance visibility is covered by the follow-up below.

Swap visibility follow-up (October 14): executed swaps now emit `balance_visible`
only after a later committed portfolio snapshot for the same owner shows the input
balance decrease and output balance increase. Both personal-wallet surfaces and
the smart-account sidebar supply their existing portfolio data; sidebar success
callbacks refresh that data. No new polling or transaction sends were added.
The 60-second watchdog emits an explicit timeout and leaves room for later recovery.
Proposed transactions do not complete, and switching accounts or unmounting clears
pending observers. The dashboard rejects old swap `ui_commit` completions. Legacy
Mixpanel completion is also delayed until visibility is established.

The Playwright swap scenario mounts the real swap hook, builds an unsigned
transaction wire, replaces wallet/RPC calls with dedicated fixtures and intercepts
Jupiter HTTP. It verifies confirmation alone, a real watchdog deadline, an input-only
change, both rendered balance changes, and completion deduplication. It does not
exercise a wallet extension or broadcast funds. Display precision and concurrent
transfers can conservatively leave a swap unresolved; closing the pane before the
balance update also leaves coverage incomplete rather than proving failure.

Authentication follow-up (October 14): browser coverage now mounts the real
PrivyAuthController, SignInModalProvider and AuthSessionProvider. The Connect
button follows the registered sign-in handler. Dedicated fixtures replace Privy
SDK and wallet-adapter boundaries; session exchange/refresh HTTP is intercepted.
Cases cover existing linked-wallet success, fresh embedded-wallet creation, a
failed exchange followed by retry without a second wallet, cancellation, backend
wallet mismatch, signer mismatch, connection failure and a delayed connection.
Tests verify the ordered Privy/backend/signer milestones, correlation headers and
absence of the fixture identity token from telemetry. These are component journey
regressions, not tests of real Privy infrastructure or wallet extensions.

Interactive sign-in now has a two-minute nonterminal watchdog. It records the
current waiting step (wallet approval, wallet creation/connection, backend exchange
or session refresh), without cancelling authentication or claiming abandonment.
Success, error callbacks and unmount clear the timer. The browser test advances
the actual watchdog and then completes the delayed connection, retaining the timeout.
This timeout is a diagnostic dwell threshold, not proof that a provider failed.

## Return-visit signer restoration

`auth.signer_restore` separately tracks the valid backend session, wallet selection, connection and matching signer. Missing wallets, account mismatch and connection errors are explicit outcomes; rejected approval is cancellation. A 30-second watchdog records a nonterminal timeout, allowing late recovery without restoring first-attempt success. Stable rerenders do not create new attempts; account changes invalidate pending completions. Browser contracts use the real controller and session provider with mocked wallet/Privy/HTTP boundaries; no funds move.

Authentication recovery follow-up (October 15): dismissing Privy or denying OAuth
closes sign-in without opening the account/legacy modal. Provider and exchange
failures show a dismissible retry notice; provider error codes are retained in
sanitized lifecycle diagnostics. Ledger and mobile wallet entry points remain
explicit choices. Interactive and return-visit sign-in share signer restoration:
success requires the wallet context to render the authenticated address. A matching
adapter ahead of React state waits; a different address still fails. Missing wallet
registration waits for the existing deadline (120 seconds interactive, 30 seconds
returning) before reporting unavailable. Connected-wallet stalls still emit a
nonterminal timeout. Privy embedded wallet registration waits until WalletProvider has subscribed,
then stays stable across wallet-list updates.
Do not unregister/re-register in effect cleanup: the installed adapter retains
removed adapters. Browser regressions use the actual WalletConnectionProvider,
Wallet Standard adapter, bridge, signer restoration and reconnect prompt to check
repeated updates, account changes, reconnect and offline signing. Separate controller
contracts cover cancellation, retry and missing-wallet deadlines. Privy services and
wallet-provider responses remain controlled; no network transactions are signed.
