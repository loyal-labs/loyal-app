# Telegram Mini-App Deep Links (`startapp` / `start_param`)

## Purpose

This document is the canonical reference for contextual mini-app links attached to summary messages.  
It is intended for developers working on forwarding/routing behavior and Telegram bot integrations.

## Where the Link Is Created

Webhook wiring lives in `/apps/telegram/src/app/api/telegram/webhook/route.ts`.

- `bot.command("summary", ...)` enters the summary delivery flow.
- `bot.callbackQuery(SUMMARY_VOTE_CALLBACK_DATA_REGEX, ...)` handles vote button callbacks that also rebuild the same keyboard.
- `bot.on("my_chat_member", ...)` handles bot add/remove lifecycle updates for community state. This does not create deep links, but it does affect whether a community is active/public.

Deep-link generation path:

```text
handleSummaryCommand
  -> sendLatestSummary / sendSummaryById
    -> buildSummaryVoteKeyboard
      -> buildSummaryFeedMiniAppUrl
```

## Start Param Contract

Format:

```text
sf1_<groupChatId>_<summaryId>
```

Fields:

- `sf1`: payload version prefix.
- `groupChatId`: Telegram numeric chat id (`-?\d+`, can be negative).
- `summaryId`: UUID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

Envelope constraints (`start-param.ts`):

- max length: `64`
- allowed chars: `[A-Za-z0-9_-]`
- invalid input during build throws (for example, bad chat id, bad UUID, or oversized payload)

Examples:

- Valid: `sf1_-1002981429221_123e4567-e89b-12d3-a456-426614174000`
- Invalid (prefix): `wrong_-1002981429221_123e4567-e89b-12d3-a456-426614174000`
- Invalid (summary id): `sf1_-1002981429221_invalid`

## Mini-App URL Shape

Generated URL:

```text
https://t.me/askloyal_tgbot/app?startapp=<encoded_param>
```

`buildSummaryFeedMiniAppUrl()` builds `startapp` using `encodeURIComponent(startParam)`.

## Where Contextual vs Non-Contextual Buttons Exist

| Location | Button | URL behavior |
|---|---|---|
| `summary-votes.ts` | `Open` | Contextual URL with `?startapp=...` via `buildSummaryFeedMiniAppUrl()` |
| `start-carousel.ts` | `Go Loyal` | Base mini-app link only (`MINI_APP_LINK`) |
| `inline.ts` | `Loyal Wallet` (`web_app`) | Base mini-app link only (`MINI_APP_LINK`) |

## How the Mini-App Consumes the Param

Raw sources:

- Telegram init data: `start_param` (parsed into `startParamRaw` in `init-data-transform.ts`)
- URL payload used for routing: `tgWebAppStartParam` from hash/query (`useStartParam.ts`)

Routing flow:

```text
parseSummaryFeedStartParam(startParam)
  -> getStartParamRoute()
    -> /telegram/summaries/feed?groupChatId=...&summaryId=...
```

Failure behavior:

- `parseSummaryFeedStartParam()` returns `null` for invalid/unparseable payloads.
- `getStartParamRoute()` returns `undefined` when mapping fails.
- App falls back to the default entry path (no crash).

## Forwarding-Relevant Cases

| Case | Result |
|---|---|
| Valid contextual open from summary message | Navigates to `/telegram/summaries/feed` with both `groupChatId` and `summaryId` |
| Invalid prefix / invalid UUID / invalid chat id | Parser rejects payload; no forwarding context is applied |
| Oversized payload at build time | Builder throws; contextual link is not generated |
| Non-contextual entry (`/start` carousel or inline query) | Opens mini app without summary forwarding context |

## Public Interfaces Referenced

No runtime API/type changes. This flow relies on:

- `buildSummaryFeedStartParam`
- `buildSummaryFeedMiniAppUrl`
- `parseSummaryFeedStartParam`
- `getStartParamRoute`

## Extension Notes

- If payload format changes, bump version prefix (for example `sf2`) and keep parser backward-aware.
- Keep payload under Telegram limits and update parser + tests together.
