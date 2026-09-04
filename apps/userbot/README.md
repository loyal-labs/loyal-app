# Userbot Worker (mtcute)

Standalone worker package for Telegram userbot foundations.

## What this package does

- Uses `@mtcute/bun`.
- Persists session state in local SQLite storage.
- Targets Render persistent disk (recommended mount: `/var/data/userbot`).
- Provides script-driven auth/bootstrap primitives.
- Runs a minimal long-lived worker with graceful shutdown.

## Required environment variables

- `TELEGRAM_USERBOT_API_ID`
- `TELEGRAM_USERBOT_API_HASH`
- `DATABASE_URL` (required for `sync:once`)

## Optional environment variables

- `TELEGRAM_USERBOT_ACCOUNT_KEY` (default: `primary`)
- `USERBOT_STORAGE_DIR` (default: `/var/data/userbot`)
- `TELEGRAM_USERBOT_PHONE` (used by `auth:bootstrap` as default phone)
- `TELEGRAM_USERBOT_BOT_TOKEN` (preferred bot auth token)
- `ASKLOYAL_TGBOT_KEY` (fallback bot auth token, compatible with app env)
- `TELEGRAM_SUMMARY_INLINE_BOT_USERNAME` (default: `askloyal_tgbot`)
- `TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM` + `TELEGRAM_SUMMARY_PEER_OVERRIDE_TO` (optional summary source peer remap; both must be set together)

## Commands

Run from `workers/userbot`.

```bash
bun install
bun run auth:bootstrap
bun run auth:status
bun run auth:clear
bun run sync:once
bun run summary:publish:once
bun run start
```

`auth:bootstrap` auto-selects login mode:

- If `TELEGRAM_USERBOT_BOT_TOKEN` (or `ASKLOYAL_TGBOT_KEY`) is set, it signs in as a bot without phone/code prompts.
- Otherwise, it uses interactive user login (phone/code/2FA).

`sync:once` supports optional recovery flags:

- `--parser-types=userbot` (default)
- `--parser-types=bot,userbot` (include activated bot-parser communities)
- `--lookback-days=2` (scan history for previous full UTC days)
- `--chat-ids=-100123,-100456` (scope to specific chat IDs)
- `--dialog-sync-only` (or `--dialogue-sync-only`) to run discovery/import only and skip message ingestion

`sync:once` also auto-discovers group/supergroup dialogs when running in user auth mode.
Missing chats are inserted into `communities` with `parserType=userbot` and inactive defaults:
`isActive=false`, `isPublic=false`, `summaryNotificationsEnabled=false`,
`summaryNotificationTimeHours=null`, `summaryNotificationMessageCount=null`.

`summary:publish:once` is delivery-only and reuses the existing bot inline query flow (`summary:<chatId>`):

- Targets activated `parserType=userbot` communities with summary notifications enabled
- Pulls inline summary results for each group and sends the latest result only
- Optional `--chat-ids=-100123,-100456` filter scopes delivery to specific groups for safe retries
- Requires user auth mode (not bot token mode)
- Runs sequentially per community and uses bounded transient retries (max `3` attempts, base backoff `250ms`)
- Records phase-specific failures with `scope="inline_query"` (fetch) or `scope="delivery"` (send)
- Uses a crypto-backed Telegram `randomId` for `messages.sendInlineBotResult`
- Returns exit code `1` when any delivery errors occur (`stats.errors > 0`), otherwise `0`

`summary:publish:once` completion logs include deterministic stats:

- `communitiesMatched`
- `communitiesProcessed`
- `deliveryAttempted` (incremented for every processed community)
- `deliverySucceeded`
- `deliveryFailed`
- `skippedNoInlineResults`
- `errors`
- `retryCount`
- `authMode`
- `botUsername`
- `chatIdFilterCount`

## Render operational flow

1. Mount persistent disk and set `USERBOT_STORAGE_DIR=/var/data/userbot`.
2. Run one-time `bun run auth:bootstrap` in the worker service environment.
3. Start service with `bun run start`.
4. Keep replicas at `1` per `TELEGRAM_USERBOT_ACCOUNT_KEY`.

## Systemd scheduling

See [`services/README.md`](services/README.md) for systemd timer setup (sync, summary publish).

## Notes

- Session files are account-scoped: `mtcute-<account-key>.sqlite`.
- `auth:clear` removes `sqlite`, `-wal`, `-shm`, and `-journal` files for the active account key.
