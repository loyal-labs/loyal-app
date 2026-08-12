# Userbot Worker on Render

This guide explains how to run the mtcute userbot worker with persistent SQLite session storage on Render.

## Scope

- Session storage is file-based (`SQLite`) on Render persistent disk.
- No database session storage is used.
- Single account per worker instance (`TELEGRAM_USERBOT_ACCOUNT_KEY`, default `primary`).

## Prerequisites

- Render Worker service pointing to this repository
- Persistent disk attached to the worker service
- Telegram API credentials (`api_id`, `api_hash`)

## Required Environment Variables

- `TELEGRAM_USERBOT_API_ID`
- `TELEGRAM_USERBOT_API_HASH`
- `DATABASE_URL` (required for `sync:once`)

## Optional Environment Variables

- `TELEGRAM_USERBOT_ACCOUNT_KEY` (default: `primary`)
- `USERBOT_STORAGE_DIR` (default: `/var/data/userbot`)
- `TELEGRAM_USERBOT_PHONE` (used as default phone in bootstrap flow)
- `TELEGRAM_USERBOT_BOT_TOKEN` (preferred bot auth token)
- `ASKLOYAL_TGBOT_KEY` (fallback bot auth token, compatible with app env)
- `TELEGRAM_SUMMARY_INLINE_BOT_USERNAME` (default: `askloyal_tgbot`)
- `TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM` + `TELEGRAM_SUMMARY_PEER_OVERRIDE_TO` (optional summary source peer remap; both must be set together)

## Render Service Setup

1. Create a Render **Worker** service.
2. Mount persistent disk to `/var/data/userbot`.
3. Set environment variables above.
4. Use start command:

```bash
cd apps/userbot && bun install && bun run start
```

## One-Time Authentication Bootstrap

Open Render Shell for the worker service and run:

```bash
cd apps/userbot
bun install
bun run auth:bootstrap
```

Then complete Telegram login prompts (code + 2FA if enabled).

If bot token auth is configured (`TELEGRAM_USERBOT_BOT_TOKEN` or `ASKLOYAL_TGBOT_KEY`),
`auth:bootstrap` logs in non-interactively as a bot and does not prompt for phone/code.

## Validate Session

```bash
cd apps/userbot
bun run auth:status
```

- Exit code `0`: session is valid
- Exit code `1`: session missing/invalid (re-bootstrap needed)

## Cron Sync (One-shot)

Configure a Render cron job with:

```bash
cd apps/userbot && bun install && bun run sync:once
```

In user auth mode, `sync:once` first discovers active group/supergroup dialogs from
the Telegram session and inserts missing communities as `parserType=userbot` with
inactive defaults (`isActive=false`, `isPublic=false`, notifications disabled) so they
can be configured manually in admin.

Optional recovery flags for targeted backfill:

```bash
cd apps/userbot && bun install && bun run sync:once --parser-types=bot,userbot --lookback-days=2
```

To only sync dialogs into communities (no message ingestion), run:

```bash
cd apps/userbot && bun install && bun run sync:once --dialog-sync-only
```

## Cron Summary Publishing (Delivery-only)

Configure a Render cron job with:

```bash
cd apps/userbot && bun install && bun run summary:publish:once
```

This command:

- Targets active `parserType=userbot` communities with `summaryNotificationsEnabled=true`
- Queries the Telegram bot inline endpoint with `summary:<chatId>`
- Sends only the latest inline summary result into each group
- Processes communities sequentially (rate-limit safe) with bounded transient retries (max `3` attempts, base backoff `250ms`)
- Classifies failures as `inline_query` (inline fetch phase) or `delivery` (send phase)
- Skips groups with empty inline results (`skippedNoInlineResults`) without treating them as hard errors

For targeted retries, scope to specific groups:

```bash
cd apps/userbot && bun install && bun run summary:publish:once --chat-ids=-100123,-100456
```

Note: this command requires user auth mode (session login), not bot token mode.

Cron exit semantics:

- Exit code `0`: no delivery errors (`stats.errors = 0`)
- Exit code `1`: one or more delivery errors (`stats.errors > 0`) or command-level failure

Operational logging for each run includes:

- `communitiesMatched`
- `communitiesProcessed`
- `deliveryAttempted`
- `deliverySucceeded`
- `deliveryFailed`
- `skippedNoInlineResults`
- `retryCount`
- `errors`

## Session Recovery Flow

If the session becomes invalid:

```bash
cd apps/userbot
bun run auth:clear
bun run auth:bootstrap
```

Then restart the Render worker.

## Operational Rules

- Keep worker replicas at `1` per `TELEGRAM_USERBOT_ACCOUNT_KEY`.
- Use a different `TELEGRAM_USERBOT_ACCOUNT_KEY` if you intentionally run multiple accounts.
- Keep `USERBOT_STORAGE_DIR` on persistent disk (not ephemeral filesystem).
