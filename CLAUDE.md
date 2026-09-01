# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Loyal is a Solana wallet product family: the askloyal.com web app (wallet, swap, Earn), a mobile app, a browser extension, an internal admin dashboard, and a Telegram bot for community summaries. The legacy Telegram mini-app is sunset and serves only a wallet-key export page.

## Commands

### Frontend (run from `/apps/telegram`)

```bash
bun dev                    # Start dev server (turbopack)
bun run build              # Production build (Next.js)
bun lint                   # ESLint
bun db:generate            # Generate Drizzle migrations from schema
bun db:migrate             # Apply migrations
bun db:studio              # Open Drizzle Studio GUI
```

### Mobile App (run from `/apps/mobile`)

```bash
npx expo start --clear     # Start Expo dev server (requires dev client)
npx expo lint              # ESLint
npm test                   # Jest tests
npx eas build --profile development-simulator --platform ios  # Build dev client (iOS sim)
npx eas build --profile development --platform ios            # Build dev client (device)
npx eas build --profile preview --platform android            # Preview APK
npx eas build --profile production --platform all             # Production build
```

### Admin Dashboard (run from `/apps/admin`)

```bash
bun dev                    # Start dev server (turbopack)
bun run build              # Production build (Next.js)
bun lint                   # Next.js lint
```

### Root Level

```bash
bun run lint                         # prettier --check
bun run lint:fix                     # prettier -w
bun run build:packages               # build all package workspaces
bun run build:auth-packages          # build auth-core
bun run build:db-packages            # build shared DB packages
bun run build:llm-packages           # build LLM packages
bun run build:shared-packages        # build shared package
bun run build:solana-packages        # build Solana packages
bun run build:wallet-packages        # build wallet-core
bun run typecheck:auth-packages      # typecheck auth-core
bun run typecheck:db-packages        # typecheck shared DB packages
bun run typecheck:llm-packages       # typecheck LLM packages
bun run typecheck:shared-packages    # typecheck shared package
bun run typecheck:solana-packages    # typecheck Solana packages
bun run typecheck:wallet-packages    # typecheck wallet-core
bun run guard:shared-boundaries      # ensure shared packages stay app-env agnostic
bun run guard:admin-shared-schema    # prevent admin-local schema duplication
bun run admin:dev                    # run admin dev server from repo root
bun run admin:lint                   # lint admin workspace from repo root
bun run admin:build                  # build admin workspace from repo root
bun run frontend:dev                 # run Loyal web frontend from repo root
bun run frontend:lint                # lint Loyal web frontend from repo root
bun run frontend:build               # build Loyal web frontend from repo root
```

### Git Hooks

```bash
./scripts/setup-git-hooks.sh
```

- Run once per clone/worktree to enable repo hooks.
- Hooks enforce commit message format (`commit-msg`) and run lint+build for the telegram, admin, and web apps before push.
- Temporary bypass (only when necessary): `SKIP_VERIFY=1 git push`
- CI note: app builds are intentionally not run in GitHub Actions; Vercel is the build/deploy gate.

## Architecture

### Directory Structure

- **`/apps/telegram`** - Next.js Telegram mini-app and bot/API service; the mini-app retains the sunset page and wallet-key export
- **`/apps/web`** - Next.js Loyal web frontend (wallet, swap, and Earn)
- **`/apps/mobile`** - Expo React Native mobile app (iOS/Android)
- **`/apps/extension`** - Browser extension wallet
- **`/apps/admin`** - Next.js internal admin dashboard
- **`/apps/dashboard`** - Internal dashboard application
- **`/apps/userbot`** - Telegram userbot worker service
- **`/packages`** - Shared workspace packages for auth, databases, LLMs, Solana, wallets, and smart accounts
- **`/crates`** - Rust CLI and smart-account support crates
- **`/docs`** - Internal repository and engineering documentation
- **`/user-docs`** - Mintlify-hosted public/user-facing documentation

### Telegram App Architecture

The Telegram mini-app is a sunset compatibility surface; do not add back the removed private-transfer UI or chain-backed claim/deposit flows.

- **Mini-app entry**: `/apps/telegram/src/app/page.tsx` provides the splash redirect, and `/apps/telegram/src/app/telegram/page.tsx` provides the sunset page and wallet-key export.
- **Bot and summaries**: retained API routes live under `/apps/telegram/src/app/api/**`; shared bot and summary modules live under `/apps/telegram/src/lib/telegram/**`, `/apps/telegram/src/lib/redpill/**`, and `/apps/telegram/src/lib/core/**`.
- **Wallet support**: the retained Solana modules are under `/apps/telegram/src/lib/solana/rpc/**`, `/apps/telegram/src/lib/solana/token-holdings/**`, and `/apps/telegram/src/lib/solana/wallet/**`.

### Shared Platform Libraries (`/apps/telegram/src/lib`)

Use `/apps/telegram/src/lib` for retained cross-cutting infrastructure and integration primitives. Existing modules include:

| Module | Purpose |
|--------|---------|
| `core/` | HTTP utilities, Neon PostgreSQL + Drizzle ORM |
| `solana/rpc/` | RPC connections (Helius for mainnet/devnet, localhost for localnet) |
| `solana/wallet/` | Keypair management via Telegram Cloud Storage |
| `solana/token-holdings/` | Token holdings resolution and display data |
| `telegram/mini-app/` | Client-side SDK wrappers, Cloud Storage, auth |
| `telegram/bot-api/` | Server-side bot API (grammy) |
| `telegram/` | User service, bot thread service, bot API handlers |
| `magicblock/` | SOL/USD price feed via Pyth oracle |
| `redpill/` | AI chat summaries |
| `jupiter/` | Jupiter pricing and swap API clients |
| `market/` | Server-side token and market data |

- Keep feature-specific behavior in its owning app or package unless it is clearly shared.
- Promote code into `/apps/telegram/src/lib` only when it is proven reusable by the retained Telegram surfaces.

### Admin Guardrails (`/apps/admin`)

- Admin must use shared DB packages:
  - `@loyal-labs/db-core/schema`
  - `@loyal-labs/db-adapter-neon`
- Keep DB client wiring in `apps/admin/src/lib/core/database.ts`.
- Do not add `apps/admin/src/lib/generated/*` or `apps/admin/drizzle.config.ts`.
- Do not reintroduce `/apps/admin/schema`; use shared schema/docs as source of truth.
- Run `bun run guard:admin-shared-schema` after admin schema/DB changes.
- For Vercel monorepo deploys, set Root Directory to `apps/admin` (config in `apps/admin/vercel.json`).

### Key Patterns

- **Keypair Storage**: User keypairs stored in Telegram Cloud Storage (not localStorage)
- **Environment Selection**: `NEXT_PUBLIC_SOLANA_ENV` controls RPC endpoint (`mainnet`, `devnet`, `localnet`)

### Database Patterns

Schema conventions used in `/packages/db-core/src/schema.ts`:

- **Primary Keys**: UUID with `defaultRandom()` for all tables
- **Telegram IDs**: Use `bigint` with `{ mode: "bigint" }` for Telegram user/chat IDs
- **Timestamps**: Always use `timestamp("...", { withTimezone: true })` with `.defaultNow().notNull()`
- **Typed JSONB**: Use `.$type<T>()` for type-safe JSONB columns:
  ```typescript
  topics: jsonb("topics").$type<{ title: string; content: string }[]>().notNull()
  encryptedContent: jsonb("encrypted_content").$type<EncryptedMessageContent>().notNull()
  ```
- **Relations**: Define separately from tables using `relations()`, enables type-safe `with:` queries
- **Type Exports**: Export both `Table` (select) and `InsertTable` (insert) types using `$inferSelect`/`$inferInsert`
- **Indexes**: Use `uniqueIndex` for unique constraints, `index` for query optimization

Service layer patterns:

- **getOrCreate Pattern**: Use `onConflictDoNothing` for race-condition-safe idempotent operations:
  ```typescript
  const result = await db.insert(table).values({...}).onConflictDoNothing().returning({ id: table.id });
  if (result.length === 0) { /* query existing record */ }
  ```
- **Driver Compatibility (Critical)**: Check `/apps/telegram/src/lib/core/database.ts` before choosing advanced DB APIs. Do not assume all Drizzle drivers support the same capabilities.
- **Atomic Multi-step Writes (Neon HTTP)**: This repo uses `drizzle-orm/neon-http`, which does **not** support `db.transaction()`. For atomic multi-statement writes, use `db.batch([...])`. Only use `db.transaction()` if the project is moved to a driver that supports it.
- **Query Builder**: Prefer `db.query.table.findFirst()` with `with:` for relations over raw SQL
- **Shared DB Guardrail**: In app code, import schema from `@loyal-labs/db-core/schema`.
- **Shared DB Guardrail**: Keep Neon driver wiring and env access in app (`/apps/telegram/src/lib/core/database.ts`).
- **Shared DB Guardrail**: Shared packages must not import app-only server config modules.
- **Shared DB Guardrail**: Preserve Neon HTTP semantics (`db.batch` for atomic multi-write flows; no `db.transaction()` assumptions).

### Code Patterns

- **Encryption**: Use `@/lib/encryption` for sensitive data (bot messages, personal info):
  ```typescript
  import { encrypt, decrypt } from "@/lib/encryption";
  const encrypted = await encrypt(JSON.stringify(data)); // returns { ciphertext, iv }
  const decrypted = await decrypt(encrypted); // returns plaintext or null
  ```
- **Drizzle Queries**: Use the query builder for type-safe operations:
  ```typescript
  const user = await db.query.users.findFirst({
    where: eq(users.telegramId, telegramId),
    with: { communityMemberships: true },
  });
  ```
- **Idempotent Operations**: Use `onConflictDoNothing` or `onConflictDoUpdate` to handle duplicate inserts gracefully
- **Server/Client Boundaries (Critical)**:
  - Never import `@/lib/core/config/server` from client code or shared barrels consumed by client code.
  - Keep server-only entrypoints isolated in dedicated modules (e.g. `server.ts` or `*.server.ts`) and import them only from server contexts (`/apps/telegram/api`, server actions, other server-only modules).
  - For dual-use modules (client + server), keep `index.ts` client-safe and expose server-only helpers via a separate server entrypoint.
  - Components imported by `apps/telegram/src/app/layout.tsx` and other root wrappers must be verified as SSR-safe before merge.
  - Browser-only SDKs (`@telegram-apps/*`, `window`/`document`/`localStorage` dependent modules, Mixpanel browser SDK, etc.) must be loaded behind `dynamic(..., { ssr: false })` in a Client Component, or via a dedicated client-only wrapper component imported from layout.
  - If a component must stay client-only but is imported in layout/provider trees, use lazy client entrypoints and keep browser globals behind `useEffect` or client-guarded code paths.
- **Root Layout Change Checklist**:
  - After any change to `apps/telegram/src/app/layout.tsx`, `/apps/telegram/src/app/**/layout.tsx`, or global provider trees, run `cd apps/telegram && bun run build`.
  - Verify production build/`_not-found` prerender path succeeds without `ReferenceError: window is not defined`.
  - Check changed modules for top-level browser API usage and ensure any browser-only dependencies are behind client-only boundaries.

### Troubleshooting

- **Runtime vs Code Mismatch**: If logs/stack traces reference code that no longer matches current file contents, restart the local dev server or worker process. Stale processes can keep executing old code after edits.

### Webhook + Drizzle Reliability Guardrails

- **Context-bound method safety (critical)**:
  - Never detach Drizzle/SDK methods that may rely on `this` (for example `db.query.*.findFirst`, `findMany`, or SDK instance methods).
  - Prefer direct invocation from owning object: `db.query.communities.findFirst({...})`.
  - If extraction is unavoidable, explicitly bind method context and add a regression test for bound behavior.
- **Webhook failure policy**:
  - Classify logic in webhook handlers as either `critical` or `best-effort`.
  - `critical` ingest/storage/auth failures must bubble and fail the webhook request to allow upstream retries.
  - `best-effort` side effects (reactions, analytics, forwarding) must never block webhook acknowledgment.
  - For best-effort paths, use fire-and-catch (`void task().catch(...)`) with structured logs.
- **Error logging standard**:
  - Log structured context (`chatId`, `messageId`, `telegramUserId`, `updateId`) without message text.
  - Include both normalized error fields (`errorName`, `errorMessage`) and stack/raw error for debugging.
- **Test design requirements**:
  - When wrappers call ORM methods, include context-sensitive mocks that would fail if method context is detached.
  - For webhook ingest, include retry/idempotency tests that simulate partial write failure then successful retry.
  - Include non-blocking tests for best-effort side effects to ensure handler completion does not await them.
- **Required validation after webhook/ingest changes**:
  - `cd apps/telegram && bun lint`
  - Run targeted tests for touched webhook/ingest modules
  - `cd apps/telegram && bun run build`
  - Manual canary in Telegram + verify new `messages` rows are written
- **On-call detection runbook**:
  - If cron summary stats suddenly show high `skippedNotEnoughMessages` for historically active communities, assume ingest regression until disproven.
  - Verify webhook errors and message freshness immediately.
  - SQL templates:
    ```sql
    -- Freshness by active community
    SELECT c.chat_title, c.chat_id, MAX(m.created_at) AS latest_message_at, COUNT(m.id) AS total_messages
    FROM communities c
    LEFT JOIN messages m ON m.community_id = c.id
    WHERE c.is_active = true
    GROUP BY c.id, c.chat_title, c.chat_id
    ORDER BY latest_message_at DESC NULLS LAST;
    ```
    ```sql
    -- 24h ingest volume by active community
    SELECT c.chat_title, c.chat_id, COUNT(m.id) AS messages_24h
    FROM communities c
    LEFT JOIN messages m
      ON m.community_id = c.id
     AND m.created_at >= NOW() - INTERVAL '24 hours'
    WHERE c.is_active = true
    GROUP BY c.id, c.chat_title, c.chat_id
    ORDER BY messages_24h DESC;
    ```

### Telegram SDK + Cloud Storage Guardrails

- Keep `apps/telegram/src/app/layout.tsx` free of Telegram SDK/UI imports. Telegram wrappers/providers belong under `apps/telegram/src/app/telegram/*` route scope only.
- Do not top-level import `@telegram-apps/sdk` or `@telegram-apps/sdk-react` from modules that can be pulled into server/root graphs (`/`, `/_not-found`, metadata, shared root providers).
- If Telegram SDK access is needed from shared utilities, load it lazily inside runtime functions (`await import("@telegram-apps/sdk")`) and guard with `typeof window !== "undefined"`.
- `next/dynamic(..., { ssr: false })` is only valid in a Client Component. Do not use it directly in a Server Component.
- Cloud storage policy is strict for wallet key material: no local/session fallback for keypair persistence. Use Telegram Cloud Storage only.
- Cloud storage readiness can race during early app boot. Critical writes (wallet keypair persistence) must use bounded retry/backoff before throwing.
- After changing any of these files, run `cd apps/telegram && bun run build` and confirm no prerender failures on `/`, `/_not-found`, and `/telegram`:
- `apps/telegram/src/app/layout.tsx`
- `apps/telegram/src/app/telegram/layout.tsx`
- `apps/telegram/src/lib/telegram/mini-app/cloud-storage.ts`
- `apps/telegram/src/components/telegram/*`
- `apps/telegram/src/lib/solana/wallet/wallet-keypair-logic.ts`
- Manual smoke check after SDK/cloud-storage changes: open wallet in Telegram mini-app and confirm keypair persistence succeeds without `Failed to persist generated wallet keypair`.

## Git Workflow

### Branch Naming Convention

All branches MUST follow the Linear format: `<issue-number-title>`

Example: `ask-328-fix-wrong-token-history-processing`

To find the correct branch name for a Linear issue, use the issue identifier (e.g., ASK-123).

## Linear MCP Defaults

- For every **new** Linear issue created via MCP, always set status to `Todo`.
- Always set an explicit priority (`Urgent`, `High`, `Normal`, `Low`).
- Always assign the issue to a concrete owner (never leave assignee empty).
- Always attach the issue to the **current cycle** for the team.
- Always attach the issue to the most appropriate project.
- Keep descriptions concise but actionable so work can start immediately.
- Each description must include: goal/context, key implementation ideas, key files/paths, and links/references (docs/PRs/issues) needed for follow-up queries.

## Commit Conventions

This project enforces [Conventional Commits](https://www.conventionalcommits.org/) via `commitlint` with `@commitlint/config-conventional`. A CI workflow (`.github/workflows/commit-style.yml`) validates all commit messages in a PR and the PR title itself.

### Format

```
type(scope): description
```

**Allowed types**: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`

**Scope** is optional but encouraged — use the area of the codebase being changed (e.g., `wallet`, `ui`, `og`, `sdk`, `ci`, `telegram`).

### Examples

```
feat(wallet): show SPL token transfers in activity
fix(sdk): restore delegation PDA helpers
chore(ci): enforce conventional commit style with commitlint
docs(sdk): refresh README for PER + auth usage
refactor(ui): extract pill button component
```

### Rules

- NEVER add `Co-Authored-By` trailers or any co-author attribution to commits
- Keep the subject line under 100 characters
- Use imperative mood in the description ("add", not "added" or "adds")
- Do not end the subject line with a period
- Validate locally before pushing:
  - `bun run commitlint:head`
  - `cd apps/telegram && bun run lint`

## Pull Requests

- PR titles MUST follow the same conventional commit format: `type(scope): description`
- PR body should be a simple one-two sentence summary of the changes — no templates or checklists
- Only merge a PR after its Vercel build/check is successful
- Merge PRs using squash-and-merge

## Tooling

- **Package Manager**: Bun (preferred)
- **Solana Version**: 2.1.0
- **ESLint**: Enforces alphabetical imports via `eslint-plugin-simple-import-sort`

## Environment Variables

Use `/apps/telegram/.env.example` as the environment template. Public settings
are read from the client bundle:

```env
NEXT_PUBLIC_TELEGRAM_BOT_ID=<bot_id>
NEXT_PUBLIC_SOLANA_ENV=devnet  # mainnet, testnet, devnet, or localnet
NEXT_PUBLIC_SERVER_HOST=<api_base_url>
NEXT_PUBLIC_USE_MOCK_SUMMARIES=false
NEXT_PUBLIC_MIXPANEL_TOKEN=<token>
NEXT_PUBLIC_MIXPANEL_PROXY_PATH=/ingest
```

Server settings are required by their corresponding Telegram bot, summary,
market, webhook, and operational features:

```env
DATABASE_URL=postgresql://...
NEON_DATABASE_URL=postgresql://...
ASKLOYAL_TGBOT_KEY=<bot_token>
TELEGRAM_SETUP_SECRET=<route_secret>
CRON_SECRET=<cron_secret>
REDPILL_AI_API_KEY=<api_key>
JUPITER_API_KEY=<api_key>
COINGECKO_API_KEY=<api_key>
IRYS_SOLANA_KEY=<private_key>
PRIVATE_MAINNET_RPC_URL=<rpc_url>
HELIUS_API_KEY=<api_key>
HELIUS_WEBHOOK_SECRET=<webhook_secret>
HELIUS_WEBHOOK_URL=<webhook_url>
PUSH_DEBUG_SECRET=<debug_secret>
LIBRARY_UPLOAD_TOKEN=<upload_token>
```

Optional server settings include `MESSAGE_ENCRYPTION_KEY`,
`SLACK_STATS_WEBHOOK_URL`, `TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM`,
`TELEGRAM_SUMMARY_PEER_OVERRIDE_TO`, and the `AX_SUMMARY_*` overrides.

### Cloudflare R2/CDN (feature-specific)

Core clients live in `/apps/telegram/src/lib/core`:
- `r2-upload.ts` (server-only): `getCloudflareR2UploadClientFromEnv()`
- `cdn-url.ts`: `getCloudflareCdnUrlClientFromEnv()`

Required for R2 upload:
- `CLOUDFLARE_R2_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_BUCKET_NAME`

Set at least one CDN base URL:
- `CLOUDFLARE_CDN_BASE_URL` (preferred)
- `NEXT_PUBLIC_CLOUDFLARE_CDN_BASE_URL`
- `CLOUDFLARE_R2_PUBLIC_DEV_URL` (dev fallback)

Optional:
- `CLOUDFLARE_R2_S3_ENDPOINT`
- `CLOUDFLARE_R2_UPLOAD_PREFIX`

Run targeted tests:

```bash
cd apps/telegram
bun test src/lib/core/__tests__/object-path.test.ts src/lib/core/__tests__/cdn-url.test.ts src/lib/core/__tests__/r2-upload.test.ts
```
