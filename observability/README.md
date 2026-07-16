# Loyal observability pilot

This project runs Loyal's self-hosted ClickStack on Render and provides the
first production signal: structured frontend errors from the Loyal web app.
It deliberately optimizes for the smallest useful system before adding full
tracing, metrics, replay, mobile, or extension instrumentation.

## Architecture

```text
Browser exception
  -> same-origin POST /api/observability/errors
  -> Loyal frontend server (validate, redact, normalize)
  -> authenticated POST /v1/logs
  -> nginx on the existing loyal-clickstack Render service
  -> ClickStack collector on loopback :4318
  -> ClickHouse -> HyperDX

Next.js server exception
  -> Loyal frontend server (redact, normalize)
  -> the same authenticated /v1/logs path
```

Render exposes one public HTTP port. nginx owns public `PORT=8080`, sends
normal UI/API/WebSocket traffic to HyperDX on loopback `:8081`, and sends only
exact `POST /v1/logs` to the loopback ClickStack collector. ClickHouse,
MongoDB, and collector ports are not public. On a brand-new installation the
UI remains available for account/team bootstrap, while `/v1/logs` returns 503
until the collector proves that unauthenticated ingestion is rejected.

This is the easiest first slice because it reuses the collector already inside
ClickStack and adds no Render service, database, queue, paid SDK, or additional
secret. A separate Collector gateway is cleaner when ingestion must scale or
deploy independently, but today it would add cost and another failure path.
Likewise, the browser does not use a HyperDX replay/RUM SDK: direct collection
would expose an ingestion credential and would broaden the privacy surface
before a replay/network-capture policy exists.

Frontend code remains in `frontend/src/features/observability`. A shared
workspace package would make every package-watching app a deployment consumer
before an API is proven. Extract a shared package only when mobile or extension
is ready to adopt the same stable event contract and platform-specific
transport behavior.

## Deployed components

- One `loyal-clickstack` Render Pro web service in the dedicated
  `loyal-observability / test` environment.
- One 10 GB persistent disk at `/var/lib/clickhouse` for ClickHouse plus
  MongoDB state.
- ClickStack all-in-one image pinned by version and digest.
- nginx in the same container for UI and authenticated OTLP/HTTP multiplexing.
- An in-container boot smoke that writes a unique marker once and verifies it
  again after later restarts.
- A frontend-local error facade, same-origin intake route, server exporter,
  Next.js server/client instrumentation, React boundaries, and focused Earn
  deposit reporting.

## Configuration

Names below are configuration contracts, not values. Never put their values in
Git, command arguments that will be logged, screenshots, or verification
artifacts.

Render `loyal-clickstack`:

- `EXPRESS_SESSION_SECRET` — generated secret for HyperDX sessions.
- `INGESTION_API_KEY` — generated collector credential.
- `PORT=8080` — public nginx listener.
- `HYPERDX_APP_PORT=8081` and
  `HYPERDX_APP_LISTEN_HOSTNAME=127.0.0.1` — internal HyperDX listener.
- `CLICKSTACK_INTERNAL_SMOKE_ENABLED=true` — boot/persistence proof.
- `USAGE_STATS_ENABLED=false` — disables upstream usage telemetry.

Vercel Loyal frontend, server-only:

- `OBSERVABILITY_OTLP_ENDPOINT` — the ClickStack HTTPS origin. The exporter
  normalizes it to `/v1/logs`.
- `OBSERVABILITY_INGESTION_API_KEY` — the same secret value as Render's
  `INGESTION_API_KEY`.

Neither frontend variable uses the `NEXT_PUBLIC_` prefix. Browser JavaScript
knows only its same-origin `/api/observability/errors` route.

## Error contract and privacy

The first slice accepts only a fixed error envelope and emits fixed OTLP
resource/log attributes: service, release, environment, runtime, operation,
pathname, severity, exception type/message/stack, and timestamp.

It does not collect request or response bodies, headers, cookies, auth tokens,
wallets, transaction signatures, signed transactions, amounts, chat content,
or arbitrary context objects. URL query strings are removed. Text is bounded
and redacts query values, secret-like values, and long base58/hex identifiers.
The browser endpoint checks same-origin, content type, actual byte size, strict
schema, and a bounded per-source rate limit. Client duplicates are suppressed
briefly.

The initial per-source browser rate limit is in-memory and intentionally
best-effort across Vercel instances; use a platform/WAF or stateless gateway
limit before accepting materially higher or untrusted ingestion volume.

Telemetry is best-effort. Client capture never throws; server export is bounded
to at most 1.5 seconds; invalid configuration or an unavailable ClickStack
cannot alter the user's transaction result, route response, or error-boundary
retry behavior.

## Verify

Requirements: Docker, `curl`, Node.js, Bun, `rg`, Git, and an authenticated
Render CLI for Blueprint validation.

Static deployment/isolation checks:

```sh
./observability/scripts/verify.sh
```

Full local ClickStack proof:

```sh
./observability/scripts/verify.sh --local
```

The local proof builds the pinned image; bootstraps a synthetic HyperDX team in
its disposable volume; checks UI health plus accepted/rejected OTLP paths,
methods, credentials, body size, and CORS; writes a unique log; queries it in
ClickHouse; recreates the container with the same volume; and queries the same
log again. Its non-secret result is written to the Git-ignored
`observability/smoke-result.json`.

Focused frontend contract/wiring proof:

```sh
bun frontend/scripts/verify-observability.ts
cd frontend && bunx tsc --noEmit
cd frontend && bun run lint
```

Never run a local frontend production build for this repository.

The binding acceptance criteria are in
`observability/FRONTEND-ERRORS-VERIFIER.md`. Live acceptance additionally
checks the deployed frontend relay, authenticated OTLP intake, ClickHouse data,
forbidden-marker absence, hosted HyperDX redirects, and restart persistence.

## Deploy and roll back

`observability/render.yaml` is the source of truth. Render watches only
`observability/**`; existing Vercel projects watch their own app/package paths.
After a verified commit reaches `main`:

1. Validate `observability/render.yaml`.
2. Push the tested commit. Render rebuilds only `loyal-clickstack`; Vercel
   rebuilds the Loyal frontend because `frontend/**` changed.
3. Set the two server-only Vercel variables for production without exposing
   their values. Keep the ingestion secret identical to Render.
4. Wait for both deployments to be live, then run the live probes in the
   verifier and confirm markers in ClickHouse/HyperDX.
5. Restart ClickStack once and prove an existing marker persists and intake
   recovers.

To roll back code, revert the deployment commit and let each platform deploy
the previous source. Do not delete or shrink the Render disk. If the new proxy
fails health checks, Render keeps the prior live revision. Before an image
downgrade or schema-changing ClickStack upgrade, take an
application-consistent export; a disk snapshot alone is not a database-safe
backup.

## Current limitations and next gates

This remains a non-production-grade all-in-one observability pilot. ClickHouse,
MongoDB, collector, HyperDX, and nginx share one instance and failure boundary.
The disk forces a single instance and prevents zero-downtime deployments.
There is not yet a tested database backup/restore runbook, explicit retention
TTL, capacity alert, ingestion SLO, full tracing, metrics, replay, or automatic
open-source source-map symbolication.

Before broadening collection:

1. Observe real error volume and tune low-cardinality dashboards/alerts.
2. Define ClickHouse retention, disk-capacity thresholds, and backup/restore
   drills.
3. Add trace correlation only where it shortens triage; do not bulk-convert
   every console call.
4. Extract a shared package when a second platform is ready and the contract is
   stable.
5. Split out a stateless Collector gateway when ingestion needs independent
   scaling, buffering/backpressure, deploy isolation, or when ClickStack itself
   is split into production components.

References:

- https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/all-in-one
- https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/overview
- https://nextjs.org/docs/pages/api-reference/file-conventions/instrumentation
- https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
- https://render.com/docs/web-services
- https://render.com/docs/disks
