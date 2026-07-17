# Loyal observability

Self-hosted ClickStack for investigating Loyal production issues.

- Dashboard: <https://loyal-clickstack.onrender.com>
- Health: <https://loyal-clickstack.onrender.com/api/health>
- Render service: `loyal-clickstack`
- Blueprint: [`render.yaml`](./render.yaml)

## What we collect

The Loyal web frontend sends:

- uncaught browser, React, and Next.js errors;
- sign-in and smart-account provisioning progress;
- deposit, top-up, and withdrawal progress;
- Autodeposit setup, update, pause, resume, close, and Execute Now progress.

The public gateway also accepts authenticated OTLP metrics and traces from
trusted service exporters. This does not by itself instrument a service or
enable browser-direct telemetry. We do not yet collect mobile, extension,
service maps, session replay, or general console logs.

```text
Browser or Next.js
  -> frontend same-origin observability route
  -> authenticated exact POST /v1/logs
Trusted service exporter
  -> authenticated exact POST /v1/metrics or /v1/traces
  -> nginx
  -> OpenTelemetry Collector
  -> ClickHouse
  -> HyperDX
```

ClickHouse, MongoDB, and collector ports are private. The browser never receives
the ingestion key. Telemetry failure must not change product behavior.

## Public OTLP gateway

The nginx edge exposes exactly three OTLP/HTTP ingestion paths:

- `POST /v1/logs`
- `POST /v1/metrics`
- `POST /v1/traces`

All three use the collector's same `INGESTION_API_KEY` authentication, reject
query strings and non-`POST` methods, and limit each request body to 64 KiB.
They remain unavailable until the startup supervisor proves that the collector
rejects missing credentials on all three paths. `/v1/workflows` does not exist,
and every other `/v1/*` path returns `404`.

The collector remains on loopback and nginx strips collector CORS response
headers, so these endpoints are not browser APIs. Access logs include only the
method, path, protocol, status, and response size; they omit query strings,
authorization, referrers, and user agents. ClickHouse, MongoDB, and collector
ports remain private.

## Investigating a report

1. Ask when the issue happened and what the user was doing.
2. Open **Logs** and select that time range.
3. Filter `ServiceName` to `loyal-frontend`.
4. Open a matching event and copy `loyal.flow.id`.
5. Search that flow ID to see the complete attempt in time order.

Useful SQL-mode searches:

```sql
ServiceName = 'loyal-frontend'
AND SeverityText = 'error'
```

```sql
LogAttributes['loyal.flow.id'] = '<flow-id>'
```

```sql
LogAttributes['loyal.flow.name'] = 'earn.deposit'
AND LogAttributes['loyal.flow.outcome'] = 'failed'
```

Interpretation:

- `completed`: the flow finished.
- `failed`: Loyal or a dependency failed.
- `cancelled`: the user dismissed the flow or rejected a wallet prompt.
- no terminal event: the user may have left, closed, or crashed.
- `chain.state=confirmed` plus `persistence.state=failed`: the on-chain action
  succeeded but Loyal failed to record it. Investigate before asking for a
  retry.

Useful fields:

| Field                | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `loyal.flow.id`      | One attempt's tracking ID                            |
| `loyal.flow.name`    | Sign-in, deposit, withdrawal, Autodeposit, and so on |
| `loyal.flow.stage`   | Last recorded step                                   |
| `loyal.flow.outcome` | Started, observed, completed, failed, or cancelled   |
| `loyal.error.code`   | Stable failure category                              |
| `loyal.elapsed_ms`   | Total attempt duration                               |
| `service.version`    | Frontend release                                     |

## Wallets and actor IDs

Raw wallets are never sent to ClickStack. For an authenticated lifecycle event,
the frontend server creates a pseudonymous ID using the wallet, deployment
environment, and `OBSERVABILITY_ACTOR_HMAC_SECRET`:

```text
actor:v1:<64 lowercase hex characters>
```

It is stored on the event as `LogAttributes['loyal.actor.id']`. It is not stored
in a separate mapping table and cannot be reversed into a wallet.

Starting from a known wallet requires a trusted server-side tool to derive the
same actor ID before searching HyperDX. That tool does not exist yet. Do not
paste wallet addresses into HyperDX.

## Privacy rules

Never send wallet or account addresses, balances, amounts, signatures, Solana
slots, transactions, instructions, proofs, request/response bodies or headers,
cookies, tokens, query strings, chat content, or arbitrary context.

The frontend uses fixed schemas, strips query strings, redacts secret-like
values, rejects unknown lifecycle fields, rate-limits browser ingestion, and
keeps credentials server-only.

## Useful saved views

Start with:

- frontend errors;
- sign-in/provisioning failures;
- deposit/withdrawal failures;
- on-chain confirmed but persistence failed;
- Execute Now failures;
- lookup by flow ID or actor ID.

Create alerts only after observing normal traffic. The first high-confidence
alert should be `loyal.recovery.required=true`.

## Configuration

Render:

- `EXPRESS_SESSION_SECRET`
- `INGESTION_API_KEY`
- `CLICKSTACK_INTERNAL_SMOKE_ENABLED=true`
- `USAGE_STATS_ENABLED=false`

Vercel `loyal-frontend`, production and server-only:

- `OBSERVABILITY_OTLP_ENDPOINT`
- `OBSERVABILITY_INGESTION_API_KEY`
- `OBSERVABILITY_ACTOR_HMAC_SECRET`

Never print these values or use a `NEXT_PUBLIC_` prefix.

## Verify

Static checks and Render Blueprint validation:

```sh
./observability/scripts/verify.sh
```

Full disposable Docker security, logs/metrics/traces canary, and log-persistence
smoke:

```sh
./observability/scripts/verify.sh --local
```

Frontend checks:

```sh
bun frontend/scripts/verify-observability.ts
bun frontend/scripts/verify-observability-flows.ts
./node_modules/.bin/tsc --noEmit --project frontend/tsconfig.json --pretty false
bun run --cwd frontend lint
```

Never run a local frontend production build.

## Deploy and rollback

- `observability/**` changes deploy only `loyal-clickstack` on Render.
- `frontend/**` changes deploy only the Loyal frontend on Vercel.
- `observability/smoke-result.json` is ignored.

Before an observability deploy, run the verifier, review the diff for secrets,
wait for Render health, and confirm a synthetic event reaches HyperDX.

Rollback by reverting the commit. Do not delete or shrink the Render disk.
Before changing the pinned ClickStack image, run the full local smoke and take
an application-consistent export.

## Current limits

- One Render Pro service and one 10 GB persistent disk.
- ClickHouse, HyperDX, MongoDB, collector, and nginx share one failure boundary.
- No high availability or zero-downtime deploys.
- No tested backup/restore runbook or explicit retention TTL.
- No disk-capacity alert or ingestion SLO.

Add retention, capacity monitoring, and tested backups before materially
increasing ingestion. Extract a shared package or separate collector only when
another app or higher volume requires it.

Definitions of done:

- [`VERIFIER.md`](./VERIFIER.md)
- [`FRONTEND-ERRORS-VERIFIER.md`](./FRONTEND-ERRORS-VERIFIER.md)
- [`AUTH-REDIRECT-VERIFIER.md`](./AUTH-REDIRECT-VERIFIER.md)

Upstream: <https://clickhouse.com/docs/use-cases/observability/clickstack>
