# ClickStack Telegram relay

A small Bun service that sits between ClickStack and Telegram:

```text
ClickStack -> relay -> Telegram Bot API
```

It sends the first non-`OK` state immediately and then holds that signature
quiet for 60 minutes by default, counting everything it holds back. When the
window closes it posts one recap of what was suppressed, so a chat message
never stands for an unknown number of failures. `OK` recoveries are
acknowledged and otherwise ignored, so the chat only carries live failures and
a flapping alert stays capped at one message per window. ClickStack test and
transitional states such as `INSUFFICIENT_DATA` are accepted and use the normal
window path.

- Render service: `loyal-clickstack-telegram-relay` (private service)
- Blueprint: [`../render.yaml`](../render.yaml)
- Deployed alongside `loyal-clickstack` in the `loyal-observability` project

Render supports health checks on web services only, so the Blueprint declares no
`healthCheckPath`. `GET /healthz` still works and is the quickest liveness probe
from a shell on the ClickStack service.

## Message types

The relay posts four kinds of message, each with its own icon so the type is
readable at a glance.

| Icon | Kind | When |
| --- | --- | --- |
| 🚨 | alert | First delivery for a signature. Opens a window. Notifies. |
| 📈 | escalation | Volume inside an open window grew by `ESCALATION_MULTIPLIER`. At most twice per window. Notifies. |
| 🔕 | recap | The window closed having suppressed at least one delivery. Silent. |
| ♻️ | restart recap | The grace period after a restart ended with alerts still firing. Silent. |

A window that suppressed nothing closes without a message, so **silence after
an alert means it happened once**. The alert and the recap both carry the
matched-line count, and the recap adds the number of suppressed deliveries, the
first and last timestamps, a per-bucket sparkline and the peak bucket.

## Counting distinct values

`CARDINALITY_COLUMNS` names columns whose distinct values are worth counting
rather than listing — `wallet` is the useful one, because 50 errors from one
wallet is a stuck user and 50 errors from 50 wallets is an outage.

```text
ALERT_COLUMNS=Timestamp,ServiceName,SeverityText,Body,env,flow,stage,error_code,wallet
CARDINALITY_COLUMNS=wallet
```

The column must also appear in `ALERT_COLUMNS`, since that is what names the
CSV positions. Counts render as `4 unique wallets`, or `≥4 unique wallets` when
ClickStack truncated the row block: the relay can only count the rows it was
sent, and the matched-line count in the title is usually larger. The prefix is
not decoration — treat the number as a floor.

## One incident, one message

ClickStack groups alerts by service but sends a row block that is **not**
filtered to the group, so a single worker crash arrives as several deliveries
with different `eventId`s and identical rows. The relay therefore keys windows
on the normalized row signatures (service, severity, and the message with
addresses, hashes and numbers collapsed) rather than on `eventId`. Deliveries
that describe the same rows share one window and produce one message.

A delivery with no readable row block falls back to keying on `eventId`, which
is exactly the previous behavior.

## State is in-process, so this runs one instance

Window and idempotency state lives in memory (`src/relay.ts`). There is no
Redis and no database.

- **`numInstances` must stay at `1`.** Two instances do not share windows and
  would double-post every alert. The Blueprint pins this.
- **A restart clears windows.** Render redeploys several times a day, and
  ClickStack replays every live alert within seconds of each one. Two
  mechanisms cover this, in order of preference:
  - `STATE_FILE` — path on a mounted disk. Windows are written there on every
    sweep and on `SIGTERM`, and restored on boot, so a deploy changes nothing
    an operator can see. Requires adding a `disk:` to the service in
    [`../render.yaml`](../render.yaml); note that Render deploys a service with
    a disk by stopping the old instance first.
  - `RESTART_GRACE_SECONDS` — always on, default 120. For this long after boot
    the relay holds new alerts instead of posting them, then posts a single ♻️
    recap listing everything that was already firing. Without a state file this
    turns a post-deploy burst of ten messages into one.

Pending recaps are lost if the process is killed without draining. That costs a
recap, never an alert.

A third option, rebuilding windows by querying ClickStack for signatures that
were already firing before boot, is deliberately **not** implemented: the relay
has no working query credential today (`HYPERDX_ACCESS_KEY` is ingest-only),
and the alerting path must not depend on the system it alerts about. If it is
added later it has to fail open — on a query error, start with empty state and
accept the duplicate messages.

## Runtime behavior

- Exact `OK` returns HTTP 200 with outcome `resolved` and does nothing else.
  Nothing is posted to Telegram, and the window is left running: a flapping
  alert resolves and re-fires on every evaluation interval, so closing the
  window on recovery would post that event on every cycle.
- Every other string state is accepted and uses the alert window path.
- ClickStack's `TEST WEBHOOK` currently uses `INSUFFICIENT_DATA`; it is accepted.
- The first delivery for a signature is sent immediately.
- Further non-`OK` deliveries for that signature return HTTP 200 without
  Telegram delivery until the window expires, and increment its counters.
- An exact delivery retry with the same `Idempotency-Key` also returns HTTP 200.
- Telegram delivery failure returns HTTP 502 and leaves no window behind, so
  ClickStack's retry is treated as a first delivery rather than a repeat.
- A recap that Telegram rejects keeps its window and its counters and is retried
  on the next sweep, up to five times before it is dropped with an
  `alert_digest_dropped` log.
- An escalation that Telegram rejects is logged as `alert_escalation_failed` and
  does not fail the webhook. The delivery is already counted, and ClickStack's
  retry carries the same `Idempotency-Key`, so bubbling the failure would be
  answered as a duplicate without resending. The escalation slot is left unused
  instead, so the next over-threshold delivery retries it.
- A Telegram `429` with a short `retry_after` is waited out and retried once
  in-process; a long `retry_after` returns HTTP 502 for ClickStack to retry.
- `title` must contain non-whitespace text, so a delivered message is never
  empty. `body` is capped at 8192 characters, comfortably inside
  `MAX_BODY_BYTES` even for multi-byte text.

## Alert formatting

ClickStack renders an alert body as a short preamble plus a fenced CSV block of
matched rows. That block has no header line: it is exactly the saved search
`select`, in order, one quoted field per column. The relay parses it and renders
labelled Telegram HTML instead of forwarding the raw CSV.

Because the CSV carries no column names, `ALERT_COLUMNS` must list the same
columns in the same order as the saved search `select`. For a search selecting

```text
Timestamp, ServiceName, SeverityText,
ResourceAttributes['deployment.environment.name'] AS env,
LogAttributes['loyal.flow.name'] AS flow,
LogAttributes['loyal.flow.stage'] AS stage,
LogAttributes['loyal.error.code'] AS error_code,
LogAttributes['exception.message'] AS message
```

set:

```text
ALERT_COLUMNS=Timestamp,ServiceName,SeverityText,env,flow,stage,error_code,message
```

`Timestamp`, `ServiceName`, `SeverityText`, and `Body` are recognized by name
and rendered as the row headline; every other column becomes a `name: value`
line. Empty fields are dropped, so a column that is null for one event costs
nothing. Timestamps render as `HH:MM:SS UTC`.

Formatting is best-effort and never blocks delivery. The relay falls back to the
verbatim ClickStack text when the body has no CSV block, when the CSV is
malformed, or when the field count disagrees with `ALERT_COLUMNS`. If Telegram
rejects the HTML with a `400`, the relay logs `telegram_formatting_rejected` and
resends the same alert as plain text.

At most 8 rows are rendered, and fewer if they would exceed Telegram's 4096
character limit; the remainder is summarized as `and N more row(s)` above the
search link.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `CLICKSTACK_WEBHOOK_SECRET` | yes | - | Bearer token accepted from ClickStack |
| `TELEGRAM_BOT_TOKEN` | yes | - | Telegram Bot API token, stored only by this relay |
| `TELEGRAM_CHAT_ID` | yes | - | Destination chat or channel ID |
| `HOST` | no | `127.0.0.1` | Listen address. Must be `0.0.0.0` on Render |
| `PORT` | no | `3000` | Listen port |
| `COOLDOWN_SECONDS` | no | `3600` | Length of the window a signature is held quiet |
| `IDEMPOTENCY_TTL_SECONDS` | no | `86400` | Exact delivery deduplication interval |
| `MAX_CACHE_ENTRIES` | no | `10000` | Per-cache memory bound |
| `MAX_BODY_BYTES` | no | `65536` | Maximum request body accepted by Bun |
| `ALERT_COLUMNS` | no | `Timestamp,ServiceName,SeverityText,Body` | Saved search `select` columns, in order, used to label alert rows |
| `CARDINALITY_COLUMNS` | no | empty | Columns counted as `N unique <column>` instead of listed |
| `DIGEST_ENABLED` | no | `true` | Post a recap when a window closes having suppressed something |
| `DIGEST_SILENT` | no | `true` | Deliver recaps with `disable_notification` |
| `ESCALATION_MULTIPLIER` | no | `10` | Break the window when volume grows this many times. `0` disables |
| `RESTART_GRACE_SECONDS` | no | `120` | Hold alerts this long after boot and post one restart recap. `0` disables |
| `SWEEP_INTERVAL_SECONDS` | no | `60` | How often closed windows are checked for recaps |
| `STATE_FILE` | no | empty | Path to persist windows across restarts. Needs a mounted disk |
| `TRACE_LOGS` | no | `false` | Structured request and validation diagnostics |

`CLICKSTACK_WEBHOOK_SECRET` uses `generateValue: true` in the Blueprint, so
Render generates it. Read it from the Render dashboard and paste it into the
ClickStack webhook header; it never needs to exist anywhere else.
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are `sync: false` and must be set by
an operator.

## ClickStack webhook

Configure a generic webhook destination pointing at the relay's private address
inside the `loyal-observability` environment:

Do not guess the hostname. Render generates a suffix for private-service
hostnames (their own example is `elasticsearch-2j3e:9200`), so copy the real
value from the relay service's **Connect -> Internal** panel in the Render
dashboard. It looks like:

```text
http://loyal-clickstack-telegram-relay:10000/webhooks/clickstack
```

The relay listens on Render's default port `10000` specifically so the address
copied from that panel works as-is. Render reserves only `18012`, `18013` and
`19099`.

Set these headers:

```json
{
  "Authorization": "Bearer YOUR_CLICKSTACK_WEBHOOK_SECRET",
  "Content-Type": "application/json"
}
```

ClickStack adds its own `Idempotency-Key` header. The relay requires it and uses
it to acknowledge an exact webhook retry without posting twice.

Use this body:

```json
{
  "eventId": "{{eventId}}",
  "state": "{{state}}",
  "title": "{{title}}",
  "body": "{{body}}",
  "link": "{{link}}",
  "startTime": {{startTime}},
  "endTime": {{endTime}}
}
```

The relay responds with HTTP 200 for suppressed alerts, exact duplicates and
alerts held during the restart grace period (outcomes `suppressed`, `duplicate`
and `deferred`). A Telegram delivery failure returns HTTP 502 without opening a
window or recording an idempotency entry, allowing ClickStack to retry safely.

## Local development

```sh
bun install
op run --env-file=/path/to/your.1password.env -- bun run dev
curl http://127.0.0.1:3000/healthz
```

`.env.example` contains placeholders only. Do not save real secrets in the
project. Generate a webhook secret for local use with:

```sh
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

To exercise the real ClickStack webhook path from a laptop, expose the local
port with a tunnel (`ngrok http 3000`) and point a scratch webhook destination
at `https://YOUR-TUNNEL.example/webhooks/clickstack`.

## Validation

```sh
bun run check          # typecheck + tests + build
```

This package sits outside the root Bun workspace and is not covered by any CI
workflow, so run `bun run check` here when changing the relay. Root
`bun run lint` (prettier) does cover these files.

## Trace logging

Trace logs are disabled by default. Enable them temporarily when diagnosing a
rejected ClickStack webhook by setting `TRACE_LOGS=true`. Each request then
emits structured JSON diagnostics:

```json
{
  "event": "clickstack_webhook_trace",
  "traceEvent": "request_rejected",
  "reason": "invalid_payload",
  "issues": [
    "startTime must be a finite number (received string)",
    "endTime must be a finite number (received string)"
  ]
}
```

Trace logs never include authorization headers, Telegram tokens, idempotency key
values, or the webhook body. Disable them again after debugging.

Common HTTP 400 causes are a missing `Idempotency-Key`, invalid JSON, quoted
numeric timestamps, or a field with the wrong JSON type. Arbitrary string values
for `state`, including `INSUFFICIENT_DATA`, are valid.

## Security notes

- Never put the Telegram bot token in ClickStack; only this relay needs it.
- Use a separate random `CLICKSTACK_WEBHOOK_SECRET` for the relay Bearer header.
- The relay emits plain JSON logs to stdout and does not export to ClickStack.
  Its own failures are visible only in Render logs — deliberately, so the
  alerting path does not depend on the system it alerts about.
- Trace logs contain field names, validation reasons, `eventId`, state, and
  timestamps, but never request bodies or authentication values.

## Routes

- `POST /webhooks/clickstack` - authenticated ClickStack webhook
- `GET /healthz` - process and in-memory cache health, reporting open
  `windows`, `idempotencyKeys` and `pendingDigests`. Unauthenticated, so the
  counts are read without sweeping the caches and may briefly include expired
  entries that the sweep has not yet reclaimed.
