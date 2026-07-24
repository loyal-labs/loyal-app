# Loyal observability

Self-hosted ClickStack for investigating Loyal production issues.

- Dashboard: <https://loyal-clickstack.onrender.com>
- Health: <https://loyal-clickstack.onrender.com/api/health>
- Render service: `loyal-clickstack`
- Blueprint: [`render.yaml`](./render.yaml)

## What we collect

The Loyal web frontend sends:

- first-party uncaught browser, React, and Next.js errors;
- first-party chunk-load failures with bounded build, page-session, network, and
  resource diagnostics;
- sign-in and smart-account provisioning progress;
- deposit, top-up, and withdrawal progress;
- Autodeposit setup, update, pause, resume, close, and Execute Now progress.

Ambient browser errors with extension-scheme stack frames and no first-party
frame are discarded before ingestion. Explicit operation reports, including
wallet-provider failures surfaced through Loyal call sites, remain eligible for
collection.

The public gateway also accepts authenticated OTLP metrics and traces from
trusted service exporters. We do not yet collect mobile, extension, service
maps, session replay, or general console logs.

```text
Browser or Next.js
  -> frontend same-origin observability route
  -> authenticated POST /v1/logs
Trusted service exporter
  -> authenticated POST /v1/metrics or /v1/traces
  -> nginx
  -> OpenTelemetry Collector
  -> ClickHouse
  -> HyperDX
```

ClickHouse, MongoDB, and collector ports are private. The browser never receives
the ingestion key. Telemetry failure must not change product behavior.

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

| Field                               | Purpose                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `loyal.flow.id`                     | One attempt's tracking ID                                |
| `loyal.flow.name`                   | Sign-in, deposit, withdrawal, Autodeposit, and so on     |
| `loyal.flow.stage`                  | Last recorded step                                       |
| `loyal.flow.outcome`                | Started, observed, completed, failed, or cancelled       |
| `loyal.wallet.address`              | Wallet address (authenticated events)                    |
| `loyal.error.code`                  | Stable failure category                                  |
| `loyal.elapsed_ms`                  | Total attempt duration                                   |
| `service.version`                   | Server-side Vercel deployment that ingested the event    |
| `loyal.client.build_id`             | Full Git SHA compiled into the reporting browser bundle  |
| `loyal.page_session.id`             | Random UUID scoped to one browser tab session            |
| `loyal.chunk.url`                   | Same-origin Next.js chunk URL, without query or fragment |
| `network.online`                    | Browser online state when the chunk failure was observed |
| `network.connection.effective_type` | Browser-reported connection class, when available        |
| `network.connection.rtt_ms`         | Browser-reported round-trip time, when available         |
| `loyal.resource.response_status`    | Resource Timing response status, when available          |
| `loyal.resource.duration_ms`        | Resource Timing duration, when available                 |
| `loyal.resource.transfer_size`      | Resource Timing transfer size, when available            |

`service.version` remains server-authoritative. Use
`loyal.client.build_id` to distinguish a stale browser bundle from the Vercel
deployment that received its report. The page-session UUID is random and
contains no user identifier.

## Wallet addresses

Authenticated lifecycle events carry the user's wallet address in plaintext as
`LogAttributes['loyal.wallet.address']`. Search HyperDX for a known wallet
directly:

```sql
LogAttributes['loyal.wallet.address'] = '<wallet>'
```

On the web the address comes from the verified session on the server, never
from the request body, so a caller cannot attribute events to someone else's
wallet. Mobile clients send their own address in the envelope, validated as
base58 before export.

Because wallet addresses are public on-chain identifiers, anyone with HyperDX
access can now link a stored event to an on-chain identity and to that wallet's
full transaction history. Treat dashboard access accordingly.

## Privacy rules

Never send balances, amounts, signatures, Solana slots, transactions,
instructions, proofs, request/response bodies or headers, cookies, tokens,
query strings, chat content, or arbitrary context. Wallet addresses are the one
deliberate exception.

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
- lookup by flow ID or wallet address.

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

Never print these values or use a `NEXT_PUBLIC_` prefix.

## Verify

Static checks and Render Blueprint validation:

```sh
./observability/scripts/verify.sh
```

Full disposable Docker startup, logs/metrics/traces canary, and log-persistence
smoke:

```sh
./observability/scripts/verify.sh --local
```

Frontend checks:

```sh
bun run --cwd frontend verify:chunk-load-recovery
bun frontend/scripts/verify-observability.ts
bun frontend/scripts/verify-observability-flows.ts
./node_modules/.bin/tsc --noEmit --project frontend/tsconfig.json --pretty false
bun run --cwd frontend lint
```

Never run a local frontend production build.

## Deploy and rollback

- `observability/**` changes deploy `loyal-clickstack` on Render, except for
  `observability/telegram-relay/**`, which the ClickStack service's build filter
  ignores.
- `observability/telegram-relay/**` changes deploy only
  `loyal-clickstack-telegram-relay` on Render.
- `frontend/**` changes deploy only the Loyal frontend on Vercel.
- `observability/smoke-result.json` is ignored.

Before an observability deploy, run the verifier, review the diff for secrets,
wait for Render health, and confirm a synthetic event reaches HyperDX.

Rollback by reverting the commit. Do not delete or shrink the Render disk.
Before changing the pinned ClickStack image, run the full local smoke and take
an application-consistent export.

## Current limits

- One Render Pro ClickStack service, one Starter Telegram relay service, and one
  10 GB persistent disk.
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
