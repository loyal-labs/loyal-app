# Environment Variables

All environment variables used by `/apps/telegram/src/`.

Environment access is centralized in:
- `core/config/public.ts` for `NEXT_PUBLIC_*` values
- `core/config/server.ts` for server-only values

## Required

| Variable | Used By | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_TELEGRAM_BOT_ID` | `constants.ts` | Telegram bot ID |
| `NEXT_PUBLIC_SOLANA_ENV` | `solana/rpc/` | `"mainnet"`, `"testnet"`, `"devnet"`, or `"localnet"` (defaults to devnet) |
| `ASKLOYAL_TGBOT_KEY` | `telegram/bot-api/` | Telegram bot token from BotFather (bot API only) |
| `TELEGRAM_SETUP_SECRET` | `api/telegram/setup-commands` | Bearer token for `/api/telegram/setup-commands` |
| `REDPILL_AI_API_KEY` | `redpill/`, `telegram/bot-api/summary-generation` | API key for Redpill AI service (raw chat + Ax summary generation) |
| `DATABASE_URL` | `core/database.ts` | Neon PostgreSQL connection string |
| `MESSAGE_ENCRYPTION_KEY` | `encryption/` | Base64-encoded 32-byte key for AES-256-GCM |

## Optional

| Variable | Used By | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_SERVER_HOST` | `core/api.ts` | Base URL for API endpoints |
| `DEPLOYMENT_PK` | `solana/wallet/gasless-keypair.server.ts` | Gasless payer keypair (required for gasless claim flow) |
| `NEXT_PUBLIC_GAS_PUBLIC_KEY` | `solana/wallet/` | Public key for gasless payer |
| `AX_SUMMARY_MODEL_DEFAULT` | `core/config/server.ts` | Default Ax summary model (fallback: `SUMMARY_AX_MODEL`, then `z-ai/glm-4.7`) |
| `AX_SUMMARY_MAX_ATTEMPTS` | `core/config/server.ts` | Max bounded attempts for Ax summary generation (default: `3`) |
| `AX_SUMMARY_EXAMPLES_VERSION` | `core/config/server.ts` | Version key for summary example/rule assets (default: `v1`) |
| `AX_SUMMARY_ENABLE_TELEMETRY` | `core/config/server.ts` | Enables runtime telemetry logging for Ax summary runs (default: `true`) |
| `SUMMARY_AX_MODEL` | `core/config/server.ts` | Legacy alias for summary model selection (kept for backward compatibility) |

## Cloudflare R2/CDN (Feature-specific)

These are required only when using `core/r2-upload.ts` and `core/cdn-url.ts`.

### R2 Upload Client (`core/r2-upload.ts`)

| Variable | Required | Description |
|----------|----------|-------------|
| `CLOUDFLARE_R2_ACCOUNT_ID` | Yes | Cloudflare account ID for R2 endpoint construction |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | Yes | R2 access key ID (S3-compatible token) |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Yes | R2 secret access key |
| `CLOUDFLARE_R2_BUCKET_NAME` | Yes | Bucket name to upload into |
| `CLOUDFLARE_R2_S3_ENDPOINT` | No | Custom S3 endpoint override. Default: `https://<account_id>.r2.cloudflarestorage.com` |
| `CLOUDFLARE_R2_UPLOAD_PREFIX` | No | Prefix prepended to all object keys (e.g. `telegram/photos`) |

### CDN URL Client (`core/cdn-url.ts`)

At least one base URL must be set:

| Variable | Recommended | Description |
|----------|-------------|-------------|
| `CLOUDFLARE_CDN_BASE_URL` | Yes | Primary server-side CDN base URL (for example custom domain) |
| `NEXT_PUBLIC_CLOUDFLARE_CDN_BASE_URL` | Optional | Public CDN base URL accessible in client bundles if needed |
| `CLOUDFLARE_R2_PUBLIC_DEV_URL` | Dev only | Fallback R2 public dev URL (for example `https://pub-xxxx.r2.dev`) |
| `NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_DEV_URL` | Dev only | Public variant of the R2 dev URL |

## Example `.env.local`

```env
# Telegram
NEXT_PUBLIC_TELEGRAM_BOT_ID=your_bot_id
ASKLOYAL_TGBOT_KEY=your_bot_token
TELEGRAM_SETUP_SECRET=your_setup_secret

# Solana - use "mainnet", "testnet", "devnet", or "localnet"
NEXT_PUBLIC_SOLANA_ENV=devnet

# AI
REDPILL_AI_API_KEY=your_api_key
# Optional - Ax summary runtime tuning
# AX_SUMMARY_MODEL_DEFAULT=z-ai/glm-4.7
# AX_SUMMARY_MAX_ATTEMPTS=3
# AX_SUMMARY_EXAMPLES_VERSION=v1
# AX_SUMMARY_ENABLE_TELEMETRY=true
# Legacy alias still supported
# SUMMARY_AX_MODEL=z-ai/glm-4.7

# Database
DATABASE_URL=postgresql://user:password@ep-xxx.aws.neon.tech/dbname?sslmode=require

# Encryption - generate with: openssl rand -base64 32
MESSAGE_ENCRYPTION_KEY=your_base64_key

# Optional - API host
NEXT_PUBLIC_SERVER_HOST=https://your-api.com

# Optional - Cloudflare R2/CDN
CLOUDFLARE_R2_ACCOUNT_ID=your_account_id
CLOUDFLARE_R2_ACCESS_KEY_ID=your_r2_access_key_id
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
CLOUDFLARE_R2_BUCKET_NAME=your_bucket_name
# Optional override
# CLOUDFLARE_R2_S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
# Optional prefix for object keys
# CLOUDFLARE_R2_UPLOAD_PREFIX=telegram/photos

# Preferred public URL for frontend links
CLOUDFLARE_CDN_BASE_URL=https://cdn.your-domain.com
# Optional public build-time variant
# NEXT_PUBLIC_CLOUDFLARE_CDN_BASE_URL=https://cdn.your-domain.com
# Dev fallback if no custom domain exists yet
# CLOUDFLARE_R2_PUBLIC_DEV_URL=https://pub-xxxx.r2.dev
```

## Localnet Setup

To use localnet for local testing:

```bash
# Terminal 1 - Start local validator
solana-test-validator

# Terminal 2 - Run app with localnet
NEXT_PUBLIC_SOLANA_ENV=localnet bun dev
```

| Environment | RPC Endpoint | WebSocket |
|-------------|--------------|-----------|
| `mainnet` | Helius mainnet | Helius WSS |
| `testnet` | Solana testnet RPC | Solana testnet WS |
| `devnet` | Helius devnet | Helius WSS |
| `localnet` | `http://127.0.0.1:8899` | `ws://127.0.0.1:8900` |

Note: On localnet, MagicBlock price feeds fall back to devnet.
