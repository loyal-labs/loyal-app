# ClickStack Telegram relay

A small Bun service that sits between ClickStack and Telegram:

```text
ClickStack -> relay -> Telegram Bot API
```

It sends the first non-`OK` state immediately and then holds that signature
quiet until the next daily recap, counting everything it holds back. An
incident that lasts all day is therefore announced once and its volume is
reported once, rather than being re-announced every hour. The window closes
silently; what it counted is reported in a single recap listing every distinct
error and how often it fired. `OK` recoveries are
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

| Icon | Kind          | When                                                                                                                     |
| ---- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 🚨   | alert         | First delivery for a signature. Opens a window. Notifies.                                                                |
| 📈   | escalation    | One evaluation's volume grew by `ESCALATION_MULTIPLIER` from the opening evaluation. At most twice per window. Notifies. |
| 📊   | daily recap   | Once a day at `DAILY_RECAP_AT`, if anything fired since the last one. Silent.                                            |
| ♻️   | restart recap | The grace period after a restart ended with alerts still firing. Silent.                                                 |

A window runs to the next recap rather than to the cooldown, so a signature
gets one 🚨 per reporting period. The cost is deliberate: an error that clears
and genuinely recurs later the same day is not announced again, and is seen
first in the recap. 📈 stays the mid-period signal for an incident that is
getting worse, since it is measured against the opening evaluation rather than
against the clock.

Windows never post anything when they close, so **silence after an alert means
nothing new is worth interrupting anyone for**. The daily recap is where volume
is reported: it lists each distinct error with its frequency, the service, and
the first and last time it was seen, above a header carrying the total events,
how many alerts were posted, and the cardinality counts.

A cardinality count is shown as `≥N` whenever it can only be a floor: either
ClickStack truncated the rows it sent, or the relay itself stopped retaining
distinct values for that column at its cap. Both are load-bearing now that a
period spans a day, since a cap that a one-hour window would never approach is
reachable across one.

The recap counts every signature, including ones that fired once and never
repeated — those never produce a second chat message, so the recap is the only
place they are ever tallied. Identical deliveries for one ClickStack evaluation
range count once; if that snapshot grows, only the increase is added.

There was previously a per-window recap on window close. It was removed because
it was mostly noise: measured against a week of production logs, half of those
recaps summarized a single suppressed delivery, restating what their own
opening alert had already said, and arriving up to an hour later. Use
`scripts/simulate.ts` to re-measure before changing this.

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
  - `STATE_FILE` — path on a mounted disk. Windows and the running daily tally
    are written there on every sweep and on `SIGTERM`, and restored on boot, so
    a deploy changes nothing an operator can see. Requires adding a `disk:` in
    [`../render.yaml`](../render.yaml); note that Render deploys a service with
    a disk by stopping the old instance first.
  - `RESTART_GRACE_SECONDS` — always on, default 120. For this long after boot
    the relay holds new alerts instead of posting them, then posts a single ♻️
    recap listing everything that was already firing. Without a state file this
    turns a post-deploy burst of ten messages into one.

Without `STATE_FILE`, each deploy restarts the daily tally, so the next recap
covers only the time since the last deploy. That costs counts in one recap,
never an alert. This is the main reason to mount a disk.

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
  Telegram delivery until the window expires. Delivery counts still increase,
  but matched lines are deduplicated by evaluation range.
- An exact delivery retry with the same `Idempotency-Key` also returns HTTP 200.
- Telegram delivery failure returns HTTP 502 and leaves no window behind, so
  ClickStack's retry is treated as a first delivery rather than a repeat.
- A closed period whose recap Telegram rejects is held separately from the live
  tally, so the retry re-sends the period that came due instead of a period that
  kept growing under it, and deliveries arriving mid-send are counted against
  the next period rather than dropped. `GET /healthz` reports it as
  `pendingRecapEvents`.
- A delivery is folded into the tally only once its alert has been accepted. A
  delivery whose alert Telegram rejected is not counted, because ClickStack
  will send it again under a fresh key and it would otherwise count twice.
- A snapshot whose recap deadline passed while the process was down still posts,
  late, on the first sweep after boot. Only snapshots older than a full period
  are discarded.
- A recap that Telegram rejects keeps its tally and its counters and is retried
  on the next sweep, up to five times before it is dropped with an
  `daily_recap_dropped` log.
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

That fallback covers a count mismatch only, and is not a safety net for the
column list in general. Values are read by position, so a `select` that renames
or reorders columns without changing how many there are is undetectable here:
the relay would attach every value to the wrong label, and — because the
service, severity and headline it keys windows on are picked out by column name
— derive signatures and cardinality counts from the wrong fields, all while
producing a message that looks well-formed. Treat a same-width edit to the
saved search as the dangerous one.

At most 8 rows are rendered, and fewer if they would exceed Telegram's 4096
character limit; the remainder is summarized as `and N more row(s)` above the
search link.

## Configuration

| Variable                    | Required | Default                                   | Purpose                                                                                                                                                          |
| --------------------------- | -------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLICKSTACK_WEBHOOK_SECRET` | yes      | -                                         | Bearer token accepted from ClickStack                                                                                                                            |
| `TELEGRAM_BOT_TOKEN`        | yes      | -                                         | Telegram Bot API token, stored only by this relay                                                                                                                |
| `TELEGRAM_CHAT_ID`          | yes      | -                                         | Destination chat or channel ID                                                                                                                                   |
| `HOST`                      | no       | `127.0.0.1`                               | Listen address. Must be `0.0.0.0` on Render                                                                                                                      |
| `PORT`                      | no       | `3000`                                    | Listen port                                                                                                                                                      |
| `COOLDOWN_SECONDS`          | no       | `3600`                                    | Minimum length of the quiet window. A signature is held until the next recap; this floor stops an alert that fires just before one from re-firing right after it |
| `IDEMPOTENCY_TTL_SECONDS`   | no       | `86400`                                   | Exact delivery deduplication interval                                                                                                                            |
| `MAX_CACHE_ENTRIES`         | no       | `10000`                                   | Per-cache memory bound                                                                                                                                           |
| `MAX_BODY_BYTES`            | no       | `65536`                                   | Maximum request body accepted by Bun                                                                                                                             |
| `ALERT_COLUMNS`             | no       | `Timestamp,ServiceName,SeverityText,Body` | Saved search `select` columns, in order, used to label alert rows                                                                                                |
| `CARDINALITY_COLUMNS`       | no       | empty                                     | Columns counted as `N unique <column>` instead of listed                                                                                                         |
| `DAILY_RECAP_ENABLED`       | no       | `true`                                    | Post the once-a-day recap                                                                                                                                        |
| `DAILY_RECAP_AT`            | no       | `06:00`                                   | UTC time of day, `HH:MM`, at which the recap is posted                                                                                                           |
| `RECAP_SILENT`              | no       | `true`                                    | Deliver recaps with `disable_notification`                                                                                                                       |
| `ESCALATION_MULTIPLIER`     | no       | `10`                                      | Break the window when volume grows this many times. `0` disables                                                                                                 |
| `RESTART_GRACE_SECONDS`     | no       | `120`                                     | Hold alerts this long after boot and post one restart recap. `0` disables                                                                                        |
| `SWEEP_INTERVAL_SECONDS`    | no       | `60`                                      | How often windows are closed and the recap schedule is checked                                                                                                   |
| `STATE_FILE`                | no       | empty                                     | Path to persist windows across restarts. Needs a mounted disk                                                                                                    |
| `TRACE_LOGS`                | no       | `false`                                   | Structured request and validation diagnostics                                                                                                                    |

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

[`src/e2e.test.ts`](./src/e2e.test.ts) is the one to keep green when changing
behavior. It drives real webhook requests through the HTTP handler, the real
analyzer, formatter and Telegram sender, and captures the result at the
Telegram Bot API boundary, asserting the exact message text. Everything is
driven by an injected clock and a no-op `sleep`, so window boundaries, the
restart grace period and the `retry_after` backoff are exercised without a
real timer.

Two properties there are easy to break silently and are covered deliberately:
twenty concurrent deliveries for one signature must produce exactly one
message, and sweeps racing each other must not double-post the daily recap.
The second one is not theoretical — it caught a real double-post while the
recap was being written, because `nextRecapAt` only advances once the send
resolves. The `verifyInvariants` helper additionally checks every message the
relay emitted in a run for balanced HTML, escaped ampersands, the
4096-character limit and send ordering against the fake clock.

## Measuring against production

[`scripts/simulate.ts`](./scripts/simulate.ts) replays real ClickStack error
logs through the real relay and prints the messages the chat would have
received. Nothing is reimplemented: it reconstructs ClickStack's per-minute
evaluations and webhook bodies, then feeds them to `AlertRelay` with the
production analyzer, formatter and sender, capturing at the Telegram boundary.

```sh
bun scripts/simulate.ts                                  # last 24h
bun scripts/simulate.ts --hours 168 --quiet              # a week, counts only
bun scripts/simulate.ts --cooldown 21600                 # try a 6h window
bun scripts/simulate.ts --recap-at 09:00                 # move the recap
```

It reads ClickStack through the MCP endpoint configured for Claude Code
(`~/.claude.json`), or `CLICKSTACK_MCP_URL` and `CLICKSTACK_MCP_TOKEN`. That
endpoint silently trims large results, so the script checks the trim flag and
halves the range until each slice comes back whole — an untrimmed fetch is the
difference between a reality check and an unrepresentative sample.

Use it before changing any noise-related default. The removal of the per-window
recap was decided this way.

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
  `windows`, `idempotencyKeys`, `dailySignatures`, `dailyEvents` and
  `nextRecapAt`. Unauthenticated, so the
  counts are read without sweeping the caches and may briefly include expired
  entries that the sweep has not yet reclaimed.
