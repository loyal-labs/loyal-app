# Mini App Library Structure

Quick reference for `/apps/telegram/src/lib/`.

## Folder Overview

| Folder | Purpose | Key Exports |
|--------|---------|-------------|
| `/core` | HTTP utilities, database | `fetchJson()`, `resolveEndpoint()`, `getDatabase()` |
| `/encryption` | Message encryption | `encrypt()`, `decrypt()` |
| `/solana` | Blockchain integration | RPC connections, wallet, deposits, token holdings |
| `/telegram` | Telegram SDK integration | Mini app utils, bot API |
| `/magicblock` | SOL/USD price feed | `fetchSolUsdPrice()` |
| `/ai` | Ax program layer for summaries | summary specs, assets, evals |
| `/redpill` | Redpill API primitives | `chatCompletion()`, `chatCompletionStream()` |

## Root Files

| File | Purpose |
|------|---------|
| `constants.ts` | App-wide constants (storage keys, PDA seeds, Telegram keys, pricing) |
| `utils.ts` | Tailwind CSS helper (`cn()` function) |

## Quick Links

- [Environment Variables](./environment-vars.md) - Required setup
- [Folder Reference](./folder-reference.md) - Detailed breakdown
- [Database](./database.md) - Drizzle ORM schema and migrations
- [Ax Backbone V2](../ai/ax-backbone-v2.md) - Shared Ax runtime and summary program architecture
- [Deep Links and Start Param](./deeplinks-start-param.md) - Summary mini-app context link format and routing
- [Onboarding Overview](../onboarding/README.md) - Add bot, activate communities, configure notifications
- [Activate Community Guide](../onboarding/add-bot-and-activate-community.md) - Step-by-step activation flow
- [Notification Settings Guide](../onboarding/notifications.md) - Configure summary notifications
