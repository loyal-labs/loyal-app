# Loyal observability

Self-hosted ClickStack for investigating Loyal production issues.

- Dashboard: <https://loyal-clickstack.onrender.com>
- Health: <https://loyal-clickstack.onrender.com/api/health>
- Render services: `loyal-clickstack`, and `loyal-clickstack-telegram-relay`
  for alert delivery ([`telegram-relay/README.md`](./telegram-relay/README.md))
- Blueprint: [`render.yaml`](./render.yaml)

## What we collect

The Loyal web frontend sends:

- first-party uncaught browser, React, and Next.js errors;
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

| Field                | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `loyal.flow.id`      | One attempt's tracking ID                            |
| `loyal.flow.name`    | Sign-in, deposit, withdrawal, Autodeposit, and so on |
| `loyal.flow.stage`   | Last recorded step                                   |
| `loyal.flow.outcome` | Started, observed, completed, failed, or cancelled   |
| `loyal.wallet.address` | Wallet address (authenticated events)              |
| `loyal.error.code`   | Stable failure category                              |
| `loyal.elapsed_ms`   | Total attempt duration                               |
| `service.version`    | Frontend release                                     |

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

## Alerting

One alert is live. The `Errors` saved search selects `SeverityText = 'error'`
together with the fields worth reading in a chat message, and the `Errors`
alert evaluates it every minute, grouped by `ServiceName`, firing on one or
more matched rows. It delivers to a generic webhook pointing at
`loyal-clickstack-telegram-relay` over the private network, which posts to
Telegram.

The relay, not ClickStack, decides what the chat sees. The first delivery for a
signature is posted immediately; repeats of it are held until the next daily
recap at 06:00 UTC, which lists every distinct error with how often it fired.
A lasting incident is therefore announced once and counted once a day rather
than re-announced every hour, and silence after an alert means nothing new is
worth interrupting anyone for. Volume that grows sharply mid-period still
breaks through as an escalation. See
[`telegram-relay/README.md`](./telegram-relay/README.md).

The saved search `select` and the relay's `ALERT_COLUMNS` are one contract
written in two places: ClickStack sends matched rows as a headerless CSV block,
so the column list and its order are all the relay has to label them by, and
drift is expensive in both directions.

A change in the **number** of columns is detected, but detection only means the
relay stops trusting the rows. Alerts still reach Telegram as the raw
ClickStack block, and everything downstream of parsing degrades: windows fall
back to keying on `eventId`, so one incident posts several alerts instead of
one, cardinality counts disappear, and the daily recap is skipped entirely
because it has no signatures to list.

A rename or reorder that keeps the count is not detected at all. Every value is
read by position, so the relay labels fields with the wrong names and derives
its signatures and cardinality counts from the wrong fields, while the message
still looks well-formed.

Change the two together, in the same order.

Add an alert only after watching normal traffic for that signal, and re-measure
the resulting chat volume against real logs with
[`telegram-relay/scripts/simulate.ts`](./telegram-relay/scripts/simulate.ts)
before changing any noise-related default.

## Configuration

Render, `loyal-clickstack`:

- `EXPRESS_SESSION_SECRET`
- `INGESTION_API_KEY`
- `CLICKSTACK_INTERNAL_SMOKE_ENABLED=true`
- `USAGE_STATS_ENABLED=false`

Render, `loyal-clickstack-telegram-relay`:

- `CLICKSTACK_WEBHOOK_SECRET` — generated by Render; read it from the dashboard
  and paste it into the ClickStack webhook's `Authorization` header
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` — set by an operator, never
  stored in ClickStack

The rest of the relay's settings are declared in the Blueprint and documented in
[`telegram-relay/README.md`](./telegram-relay/README.md).

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

Telegram relay checks (typecheck, tests, build):

```sh
bun run --cwd observability/telegram-relay check
```

That package sits outside the root Bun workspace and no CI workflow covers it,
so run this whenever the relay changes.

Frontend checks:

```sh
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
- `observability/render.yaml` reaches both services through Blueprint sync,
  which applies configuration changes regardless of either build filter. An
  env-var edit therefore restarts the relay even though its build filter does
  not match that file.
- `frontend/**` changes deploy only the Loyal frontend on Vercel.
- `observability/smoke-result.json` is ignored by the ClickStack build filter,
  and falls outside the relay's entirely.

Before an observability deploy, run the verifier, review the diff for secrets,
and wait for the affected service to become healthy. For ClickStack, confirm a
synthetic event reaches HyperDX. For the relay, run its `check` script and curl
`GET /healthz` over the private network from a shell on the ClickStack service;
Render supports health checks on web services only, so nothing does this for
you.

Rollback by reverting the commit. Restarting the relay is cheap but not free:
its counters are in memory, so the next daily recap covers only the time since
the restart. Do not delete or shrink the Render disk.
Before changing the pinned ClickStack image, run the full local smoke and take
an application-consistent export.

## Current limits

- One Render Pro ClickStack service, one Starter private Telegram relay service,
  and one 10 GB persistent disk.
- ClickHouse, HyperDX, MongoDB, collector, and nginx share one failure boundary.
- The relay runs one instance and keeps window and recap state in memory, with
  no mounted disk. A restart loses the running daily tally; a 120-second grace
  period after boot collapses the alert burst ClickStack replays into a single
  message.
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
