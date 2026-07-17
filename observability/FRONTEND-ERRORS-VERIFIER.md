# Verifier: Loyal frontend error observability

Run this verifier cold from `/Users/taequn/loyal/loyal-apps`. Treat this file as the immutable definition of done for the first frontend observability slice. Report PASS or FAIL for every Required section, cite commands and live evidence, and return overall PASS only when every Required section passes. Do not weaken a condition because implementation or deployment is difficult.

## Required

### 1. Scope and lowest-overhead architecture

- The implementation extends the existing single `loyal-clickstack` Render service. It does not add another Render service, database, queue, paid vendor SDK, browser replay SDK, or workspace package.
- Error collection is frontend-owned under `frontend/` until mobile or extension becomes a proven second consumer. No runtime file under `app/`, `mobile/`, `extension/`, `admin/`, or `dashboard/` changes.
- The repository documents why the pilot uses the existing ClickStack collector plus a same-container HTTP proxy, why direct browser-to-OTLP is rejected, and when a separate gateway/shared package becomes justified.
- The final diff contains no plaintext credential, telemetry sample containing real user data, dependency/lockfile change, or unrelated edit. Pre-existing unrelated work is named and preserved.

### 2. Public ingestion boundary

- Render still publishes only `0.0.0.0:$PORT` on the existing ClickStack service. HyperDX runs on a loopback-only internal port; ClickHouse, MongoDB, and collector ports remain non-public.
- Normal HyperDX UI/API/WebSocket traffic and `/api/health` still work through the proxy. Only exact `POST /v1/logs`, `POST /v1/metrics`, and `POST /v1/traces` are proxied to the local collector. `/v1/workflows`, every other `/v1/*` path, query-bearing requests, and non-POST methods are rejected.
- All three public OTLP paths fail closed until the collector demonstrably rejects unauthenticated requests on all three. Missing and wrong credentials receive `401` or `403`; the configured credential is accepted. The proxy removes collector CORS response headers, applies a request-body limit no greater than 64 KiB per endpoint, and uses bounded connect/read/send timeouts.
- A local Docker smoke proves UI health; missing/wrong/correct credential behavior; method, query, unsupported-path, and oversized-body rejection; absence of permissive CORS; valid OTLP metrics and traces canaries; a unique OTLP log queryable in `default.otel_logs`; and persistence of that same log after container recreation against the same volume.

### 3. Frontend error contract and privacy

- Browser code sends a small same-origin JSON envelope to `/api/observability/errors`; it never receives an ingestion key or collector URL. The route accepts JSON `POST` only, enforces same-origin, actual byte size, strict allowlisted fields/values, and a bounded per-source rate limit before forwarding with server-only credentials.
- The normalized event has stable `service.name`, release, deployment environment, runtime, operation, route pathname without query/hash, severity, exception type/message/stack, and an event timestamp. No request/response body, headers, cookies, auth token, wallet address, transaction signature, signed transaction, chat content, or arbitrary context object is accepted or emitted.
- Message, name, route, and stack are length-bounded and redact URL query values, bearer/secret-like values, and long base58/hex identifiers. Unknown and malformed inputs are rejected. Duplicate browser reports are suppressed for a short bounded window.
- Reporting is best-effort: client capture never throws; the server exporter has a timeout no greater than 1500 ms; disabled/misconfigured/down telemetry cannot change an app route status, transaction result, error-boundary reset, or other user flow. Upstream errors and secret values are never returned to the browser.
- No tracked source contains `NEXT_PUBLIC` ingestion credentials. A checked-in focused verifier uses synthetic forbidden markers to prove normalization, redaction, truncation, schema rejection, deduplication, OTLP shape, timeout/failure behavior, and absence of forbidden marker values from emitted payloads. It is a verifier script, not a new TypeScript unit-test suite.

### 4. Automatic capture surfaces

- `frontend/src/instrumentation.ts` uses stable Next.js `onRequestError` to report uncaught server errors with method and route template/path only; it never serializes request headers, body, URL query, or cookies.
- `frontend/src/instrumentation-client.ts` installs early `error` and `unhandledrejection` listeners exactly once and cannot recursively create an unhandled rejection.
- App-level and global React error boundaries report errors once, retain a usable retry action, and the global boundary supplies its own `<html>` and `<body>` without modifying the root provider tree.
- The asynchronous Earn deposit backend-confirmation failure and the outer Earn deposit failure report explicit, low-cardinality operation names while preserving existing behavior. They do not attach amount, wallet, signature, transaction, or response data.
- Focused verification exercises the two browser listeners, server hook adapter, both boundary capture calls, and both Earn seams. TypeScript and frontend lint pass. A local frontend production build is not run.

### 5. Live deployed end state

- The latest Render deploy and Loyal frontend Vercel production deploy are live from the tested commit. Unrelated projects are not deployed by an observability-only change.
- `https://loyal-clickstack.onrender.com/api/health` is healthy through the proxy; HyperDX signup/login redirects remain on the hosted origin; recent logs show no proxy or ClickStack crash loop.
- Live missing/wrong credential, method/query/unsupported-path, oversized-body, and CORS probes have the same safe results as local probes for logs, metrics, and traces. Valid authenticated canaries are accepted on exactly those three paths. Direct public connections to `4318`, ClickHouse, and MongoDB remain unavailable.
- A unique synthetic event sent through the deployed same-origin frontend route returns the documented non-blocking success status and becomes queryable in ClickHouse/HyperDX within 60 seconds with the required service/release/environment/runtime/operation/exception fields. A planted forbidden marker does not appear in stored attributes or body.
- A second unique server-format event sent through the authenticated hosted OTLP path is queryable within 60 seconds. After one controlled ClickStack restart, an existing marker remains queryable and the frontend error route resumes without configuration changes.
- No secret value appears in Git diff, built client references, HTTP responses, verification artifacts, Render/Vercel logs captured for evidence, or the final report.

### 6. Handoff and operational clarity

- `observability/README.md` documents the architecture, env-var names without values, local/static/live verification commands, deploy and rollback steps, data/privacy rules, current limitations, retention/backup follow-ups, and the exact criteria for later extracting a shared package or separate gateway.
- The final report includes the tested commit, Render service/deploy identity, Vercel deployment identity, public URLs, commands run, PASS/FAIL evidence, and remaining limitations without printing secrets.

## Nice to have

- A saved HyperDX view groups errors by `service.name`, deployment environment, release, operation, and exception type.
- An alert is configured only after initial traffic establishes a useful threshold.

## Verdict

Overall PASS only if all six Required sections pass. Otherwise return overall FAIL, enumerate every false condition, leave this verifier unchanged, and continue the plan-do-verify loop unless blocked by user-only authentication, billing approval, or an unavailable external service.
