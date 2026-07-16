# Loyal observability

This folder owns Loyal's self-hosted ClickStack deployment and the operational
contract used by applications that send it telemetry. It is both a deployment
project and the maintainer runbook.

ClickStack is Loyal's shared incident recorder. It helps the team answer:

- What failed?
- Which step did the user reach?
- Did the user cancel, or did the system fail?
- Did the on-chain action succeed while Loyal's bookkeeping failed?
- Is the problem isolated or affecting many attempts?
- Did it begin with a particular frontend release?

## Quick links

- HyperDX dashboard: <https://loyal-clickstack.onrender.com>
- Health check: <https://loyal-clickstack.onrender.com/api/health>
- Render service: `loyal-clickstack`
- Render project/environment: `loyal-observability / test`
- Render Blueprint: [`render.yaml`](./render.yaml)
- Deployment and proxy image: [`Dockerfile`](./Dockerfile)
- Static verifier: [`scripts/verify.sh`](./scripts/verify.sh)

Do not place credentials, wallet addresses, transaction data, or production
event payloads in issues, screenshots, docs, or verification artifacts.

## What is collected today

The Loyal web frontend sends two kinds of structured logs:

1. Uncaught browser, React, and Next.js server errors.
2. Lifecycle events for important user flows:
   - sign-in;
   - smart-account provisioning;
   - deposits and top-ups;
   - partial and full withdrawals;
   - Autodeposit setup, floor updates, pause, resume, and close;
   - Autodeposit Execute Now.

Mobile, the browser extension, metrics, distributed traces, service maps,
browser session replay, and general console logs are not collected yet. Their
presence in the HyperDX navigation does not mean they are configured.

Telemetry is best-effort. A ClickStack outage must not change a transaction
result, API response, wallet prompt, navigation, or UI state.

## The parts of the system

- **ClickHouse** stores and queries telemetry.
- **HyperDX** provides search, saved searches, charts, dashboards, and alerts.
- **OpenTelemetry Collector** accepts the structured log records.
- **MongoDB** stores HyperDX users and application configuration.
- **nginx** exposes the HyperDX UI and one authenticated log-ingestion path.

All five processes currently share one Render service and one failure boundary.

```text
Browser lifecycle/error
  -> same-origin POST /api/observability/events or /api/observability/errors
  -> Loyal frontend server validates, redacts, and enriches the record
  -> authenticated POST /v1/logs
  -> nginx on loyal-clickstack
  -> OpenTelemetry Collector on loopback :4318
  -> ClickHouse
  -> HyperDX

Next.js lifecycle/error
  -> Loyal frontend server validates and schedules a non-blocking export
  -> the same authenticated /v1/logs path
```

Render exposes only nginx on public `PORT=8080`. HyperDX listens on loopback
`:8081`. ClickHouse, MongoDB, and the collector ports are not public. The
browser never receives an ingestion credential.

## How to investigate an incident

### 1. Start with time and action

Ask approximately when the problem occurred and what the user was doing. Open
HyperDX **Logs**, choose that time range, and filter `ServiceName` to
`loyal-frontend`.

Broad SQL-mode searches:

```sql
ServiceName = 'loyal-frontend'
AND SeverityText = 'error'
```

```sql
LogAttributes['loyal.flow.name'] = 'earn.deposit'
AND LogAttributes['loyal.flow.outcome'] = 'failed'
```

### 2. Follow the flow ID

Every instrumented attempt has a `loyal.flow.id`. Copy it from an event and
search for the complete timeline:

```sql
LogAttributes['loyal.flow.id'] = '<flow-id>'
```

Sort the matching events chronologically. The last stored stage shows how far
the attempt progressed. A flow with no terminal event may represent a closed
tab, navigation, browser crash, or abandonment; the client does not invent an
unload failure.

### 3. Interpret the outcome

- `completed`: the instrumented flow finished.
- `failed`: Loyal or a dependency returned a handled failure.
- `cancelled`: the user dismissed the flow or rejected a wallet prompt.
- `started` or `observed`: progress, not a final result.
- ERROR severity: a failed event or a recovery-required incident.
- INFO severity: ordinary progress, completion, or cancellation.

For deposit and withdrawal incidents, inspect chain and persistence separately:

```text
loyal.chain.state = confirmed
loyal.persistence.state = failed
loyal.recovery.required = true
```

This means the on-chain action succeeded but Loyal failed to record it. Treat
it as urgent and do not tell the user to repeat the transaction without further
investigation.

### 4. Compare release and source

- `service.version` identifies the frontend Git release.
- `deployment.environment.name` separates production and other environments.
- `loyal.flow.source` distinguishes browser, Next.js API, SSE, and fallback
  observations.
- `loyal.error.code` is the stable failure category. Lifecycle logs never use
  raw exception messages as error categories.

## Important lifecycle fields

| Field                | Meaning                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `loyal.flow.id`      | Tracking number for one attempt                                         |
| `loyal.flow.name`    | Sign-in, provisioning, deposit, withdrawal, Autodeposit, or Execute Now |
| `loyal.flow.variant` | Initial/top-up, partial/full, setup/pause/close, and similar branches   |
| `loyal.flow.stage`   | The step reached when the event was recorded                            |
| `loyal.flow.outcome` | Started, observed, completed, failed, or cancelled                      |
| `loyal.flow.source`  | Browser, Next.js API, SSE, or fallback                                  |
| `loyal.elapsed_ms`   | Total elapsed time since the attempt began                              |
| `loyal.duration_ms`  | Time associated with the current stage                                  |
| `loyal.error.code`   | Stable, privacy-safe failure category                                   |
| `loyal.actor.id`     | Pseudonymous authenticated-user correlation ID                          |
| `service.version`    | Frontend release that emitted the event                                 |

The full binding lifecycle contract and allowlists live in
`frontend/src/features/observability/lifecycle-contract.ts`.

## Actor IDs and wallet lookup

Raw wallet addresses are never sent to ClickStack. After the frontend server
has a verified authenticated principal, it derives:

```text
actor:v1:HMAC-SHA-256("v1|<environment>|<wallet>")
```

The HMAC uses the server-only `OBSERVABILITY_ACTOR_HMAC_SECRET`. The result is
stored on each eligible lifecycle record as:

```text
LogAttributes['loyal.actor.id']
```

The actor ID is not stored in a separate mapping table and cannot be reversed
into a wallet address. It is deterministic only for the same wallet,
environment, and secret.

If support starts with a known wallet, HyperDX cannot calculate its actor ID.
A future staff-only lookup tool should accept the wallet, derive the actor ID
on a trusted server, and open the matching HyperDX search without logging or
persisting the wallet. Until that exists, do not paste wallets into HyperDX.

Only authenticated lifecycle events can carry actor IDs today. General error
logs and anonymous/pre-proof lifecycle events do not.

## Privacy and security contract

Observability records must never contain:

- wallet, smart-account, or other account addresses;
- balances or transaction amounts;
- transaction signatures or Solana confirmation slots;
- serialized transactions or instructions;
- wallet proofs, signed messages, or challenges;
- request or response bodies and headers;
- cookies, auth/session tokens, Turnstile values, or ingestion credentials;
- URL query strings;
- chat or other user-generated content;
- arbitrary context objects.

The frontend accepts only fixed, bounded schemas. It removes query strings,
redacts secret-like values and long identifiers from error text, rejects
unknown lifecycle fields, and rate-limits browser ingestion. Browser reporting
is non-throwing and bounded to 1.25 seconds.

The public proxy accepts only exact authenticated `POST /v1/logs`. It rejects
other `/v1/*` paths, other methods, oversized bodies, and browser-style CORS
access. Never expose the collector, ClickHouse, or MongoDB ports publicly.

## Saved searches and dashboards

Recommended saved searches:

- Production frontend errors
- Sign-in and provisioning failures
- Deposit and withdrawal failures
- Confirmed on-chain but persistence failed
- Autodeposit configuration failures
- Execute Now failures or released attempts
- Lookup by flow ID
- Lookup by actor ID

Recommended first dashboard, **Frontend Critical Flows**:

- attempts by flow and outcome;
- completion, failure, and cancellation rates;
- last observed stage for non-terminal attempts;
- errors grouped by `loyal.error.code`;
- p50 and p95 `loyal.elapsed_ms`;
- failures grouped by `service.version`;
- recovery-required deposit/withdrawal count;
- Execute Now states;
- SSE versus fallback observations.

Start with a narrow time range and low-cardinality groupings. Save the search or
dashboard only after checking the underlying matching events.

## Alerts

Create alerts only after observing enough traffic to establish a useful
baseline. Good first alerts are:

- any recovery-required deposit or withdrawal;
- a sustained increase in sign-in failures;
- a sustained increase in deposit or withdrawal failures;
- starts continuing while successful completions disappear;
- sustained Execute Now failures.

Prefer a generic webhook for this self-hosted deployment. Confirm integrations
available in the pinned ClickStack version before promising Slack API or
PagerDuty behavior. Avoid alerting on every individual ordinary error; noisy
alerts will quickly be ignored.

## Deployed components

- One `loyal-clickstack` Render Pro web service.
- Dedicated `loyal-observability / test` Render environment.
- One 10 GB persistent disk mounted at `/var/lib/clickhouse`.
- ClickStack all-in-one image pinned by version and immutable digest.
- nginx in the same container for UI and authenticated OTLP/HTTP multiplexing.
- An in-container boot smoke that writes a unique marker once and verifies it
  again after later restarts.

The disk holds ClickHouse data plus the linked MongoDB state. Do not delete,
shrink, or replace the disk during an ordinary deploy or rollback.

## Configuration contracts

These are variable names, not values. Never print their values.

Render `loyal-clickstack`:

- `EXPRESS_SESSION_SECRET`: HyperDX session secret.
- `INGESTION_API_KEY`: collector credential.
- `PORT=8080`: public nginx listener.
- `HYPERDX_APP_PORT=8081`: internal HyperDX listener.
- `HYPERDX_APP_LISTEN_HOSTNAME=127.0.0.1`: loopback-only HyperDX binding.
- `CLICKSTACK_INTERNAL_SMOKE_ENABLED=true`: boot and persistence proof.
- `USAGE_STATS_ENABLED=false`: disables upstream usage telemetry.

Vercel `loyal-frontend`, server-only production variables:

- `OBSERVABILITY_OTLP_ENDPOINT`: ClickStack HTTPS origin; the exporter fixes
  the path to `/v1/logs`.
- `OBSERVABILITY_INGESTION_API_KEY`: same secret value as Render's
  `INGESTION_API_KEY`.
- `OBSERVABILITY_ACTOR_HMAC_SECRET`: dedicated secret of at least 32 characters
  for pseudonymous actor IDs. It must not reuse the ingestion key.

None of these Vercel variables may use the `NEXT_PUBLIC_` prefix.

## Health and verification

The basic external health check is:

```sh
curl -fsS https://loyal-clickstack.onrender.com/api/health
```

Static deployment, isolation, privacy, shell, frontend-error, and Render
Blueprint checks:

```sh
./observability/scripts/verify.sh
```

Full disposable local ClickStack smoke test:

```sh
./observability/scripts/verify.sh --local
```

The full smoke builds the pinned image, creates a synthetic HyperDX team,
checks the UI and ingestion security, writes a unique log, queries it in
ClickHouse, recreates the container against the same volume, and verifies that
the log remains. Its non-secret result is written to the Git-ignored
`observability/smoke-result.json`.

Focused frontend checks:

```sh
bun frontend/scripts/verify-observability.ts
bun frontend/scripts/verify-observability-flows.ts
./node_modules/.bin/tsc --noEmit --project frontend/tsconfig.json --pretty false
bun run --cwd frontend lint
```

Never run a local frontend production build in this repository.

Acceptance criteria live in:

- [`VERIFIER.md`](./VERIFIER.md): initial ClickStack deployment;
- [`AUTH-REDIRECT-VERIFIER.md`](./AUTH-REDIRECT-VERIFIER.md): hosted login and
  redirect behavior;
- [`FRONTEND-ERRORS-VERIFIER.md`](./FRONTEND-ERRORS-VERIFIER.md): frontend error
  ingestion.

The local critical-flow verifier under `docs/plans/` is intentionally untracked.

## Deployment behavior

`render.yaml` is the source of truth for ClickStack infrastructure.

- A commit changing only `observability/**` triggers Render ClickStack and is
  ignored by the app, frontend, admin, and dashboard Vercel projects.
- A commit changing only `frontend/**` triggers Loyal frontend and is ignored
  by Render ClickStack.
- A commit changing both areas may trigger both deployments.
- `observability/smoke-result.json` is ignored by Render and Git.

Before deploying an observability change:

1. Run `./observability/scripts/verify.sh`.
2. Review the diff for secrets and unexpected paths.
3. Push the tested commit.
4. Wait for Render health to become green.
5. Confirm HyperDX login and UI behavior.
6. Confirm a unique synthetic event reaches ClickHouse.
7. Confirm an older persistence marker still exists after a controlled restart
   when the change affects startup, storage, or the base image.

For frontend-only instrumentation, run the focused frontend verifiers and
confirm the production Vercel deployment SHA before checking the resulting
records in HyperDX.

## Rollback and upgrades

To roll back code, revert the deployment commit and let Render or Vercel deploy
the previous source. Do not delete or shrink the Render disk. If a new proxy or
container fails health checks, Render should retain the prior healthy revision.

Before changing the pinned ClickStack version:

1. Read the upstream release and migration notes.
2. Run the full local smoke.
3. Take an application-consistent export.
4. Deploy during a controlled window.
5. Verify old data, new ingestion, HyperDX login, saved searches, dashboards,
   and alerts.

A disk snapshot alone is not assumed to be a database-safe backup.

## Current reliability limits

This is a low-overhead pilot, not a highly available observability cluster:

- ClickHouse, MongoDB, the collector, HyperDX, and nginx share one instance.
- The persistent disk forces one instance and prevents zero-downtime deploys.
- There is no tested backup/restore runbook.
- There is no explicit retention TTL.
- There is no disk-capacity alert or ingestion SLO.
- There is no full tracing, metrics, replay, or automatic open-source source-map
  symbolication.
- The browser rate limit is in memory and best-effort across Vercel instances.

Before substantially increasing ingestion volume:

1. Define retention and disk-capacity thresholds.
2. Add a tested backup/restore procedure.
3. Establish ingestion-health monitoring.
4. Review CPU, memory, disk, and query performance.
5. Decide whether the all-in-one failure boundary is still acceptable.

## When to expand the architecture

Keep application instrumentation frontend-owned until a second platform is
ready to use the same stable event contract. Extract a shared package only
when mobile or extension work is scheduled and platform-specific transports
are understood.

Add trace correlation only where it materially shortens incident triage. Do
not forward every console statement or enable browser replay without an
explicit data-capture and privacy policy.

Split out a stateless Collector gateway when ingestion needs independent
scaling, buffering/backpressure, deploy isolation, or multiple ClickStack
instances. Split ClickHouse, HyperDX, MongoDB, and the collector when the
all-in-one failure boundary no longer meets the required reliability.

## Folder map

| Path                             | Purpose                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `Dockerfile`                     | Pinned ClickStack image and nginx installation           |
| `render.yaml`                    | Render project, service, disk, health, and path filters  |
| `nginx.conf`                     | Public UI proxy and authenticated `/v1/logs` boundary    |
| `scripts/entrypoint.sh`          | Persistent paths, readiness, smoke, and process startup  |
| `scripts/smoke-live.sh`          | In-container security and ingestion proof                |
| `scripts/smoke-local.sh`         | Disposable local persistence and security smoke          |
| `scripts/smoke-auth-redirect.sh` | Hosted-origin login/redirect smoke                       |
| `scripts/verify.sh`              | Static verifier and optional full local smoke entrypoint |
| `VERIFIER.md`                    | Initial deployment definition of done                    |
| `FRONTEND-ERRORS-VERIFIER.md`    | Frontend error ingestion definition of done              |
| `AUTH-REDIRECT-VERIFIER.md`      | Hosted authentication definition of done                 |

## Upstream references

- <https://clickhouse.com/docs/use-cases/observability/clickstack/search>
- <https://clickhouse.com/docs/use-cases/observability/clickstack/dashboards>
- <https://clickhouse.com/docs/use-cases/observability/clickstack/alerts>
- <https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/all-in-one>
- <https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/overview>
- <https://nextjs.org/docs/pages/api-reference/file-conventions/instrumentation>
- <https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client>
- <https://render.com/docs/web-services>
- <https://render.com/docs/disks>
