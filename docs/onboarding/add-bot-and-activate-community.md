# Add Bot and Activate Community

This guide covers the full onboarding flow to enable community message tracking and summaries.

## Prerequisites

### Operator setup

Ensure these environment variables are configured for the app deployment:

- `ASKLOYAL_TGBOT_KEY`
- `TELEGRAM_SETUP_SECRET`
- `CRON_SECRET`
- `DATABASE_URL`
- `REDPILL_AI_API_KEY`

Reference: `apps/telegram/.env.example`.

### Register Telegram bot commands

Run the setup script once after deployment (or when commands change):

```bash
cd apps/telegram
bun run telegram:setup-commands
```

Optional fallback (if you prefer endpoint-based setup):

- Endpoint: `POST /api/telegram/setup-commands`
- Auth header: `Authorization: Bearer <TELEGRAM_SETUP_SECRET>`

This registers group commands including:

- `/activate_community`
- `/deactivate_community`
- `/summary`
- `/notifications`

### Add admins to whitelist

Only users in the `admins` table can activate/deactivate communities and change notification settings.

Minimal SQL example:

```sql
INSERT INTO admins (telegram_id, username, display_name)
VALUES (123456789, 'example_user', 'Example User')
ON CONFLICT (telegram_id) DO NOTHING;
```

## Add the Bot to a Telegram Community

1. Open your target Telegram group or supergroup.
2. Add your bot as a member.
3. Promote the bot to admin if your community policy requires elevated permissions.
4. Send a test text message in the group (used later to verify tracking).

When the bot is added, Telegram sends a `my_chat_member` update.  
The webhook handles this by creating or updating the community row as:

- `isActive = false`
- `isPublic = false`

The bot also sends a short onboarding message in chat with next steps.  
In community chats, this onboarding helper message is auto-cleaned after a short delay (typically within 1-2 minutes).

## Activate Community

1. In the target community chat, run `/activate_community`.
2. The command must be executed in a community chat (group/supergroup/channel), not private chat.

## Expected Outcomes

### Whitelisted admin, first activation

Expected bot message:

`Community activated for message tracking!`

What happens:

- Community row is created in `communities` (or reused if it already exists from join webhook onboarding)
- Community is marked active
- Message tracking for this chat becomes eligible immediately

### Whitelisted admin, community already active

Expected bot message:

`Community is already activated. Data updated!`

What happens:

- Existing community metadata is refreshed
- Community remains active

### Whitelisted admin, community exists but was deactivated

Expected bot message:

`Community reactivated for message tracking!`

What happens:

- Existing community is reactivated
- Message tracking resumes

### User not in whitelist

Expected bot message:

`You are not authorized to activate communities. Contact an administrator to be added to the whitelist.`

What happens:

- Activation is denied
- No community activation state change is applied

### Bot removed from community

When the bot is removed (via `my_chat_member` transition to `left` or `kicked`), webhook handling updates the community to:

- `isActive = false`
- `isPublic = false`

No onboarding message is sent on removal.

## Verify Message Collection

After successful activation:

1. Send a few new text messages in the community.
2. Confirm message ingestion in `messages` for that community (via DB query or internal tools).
3. Optionally run `/summary`:
- If no summaries exist yet, expected response is:
`No summaries available yet. Summaries are generated daily when there's enough activity.`
- If summary master switch is off for the community, expected response is:
`Summary notifications are turned off for this community. Use /notifications to turn them on.`

## Notes

- Summary generation/delivery is scheduled via `/api/cron/summaries`, not immediate at activation time.
- Helper message cleanup is handled by `/api/cron/telegram-helper-cleanup` (every minute) and uses the same `CRON_SECRET` bearer auth pattern.
- Activation only enables tracking and eligibility for subsequent summary runs.
- `/summary` and scheduled summary notifications both respect the community notification master switch.
