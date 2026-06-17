# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

!! Never run build on frontend locally for testing purposes !!

## Secrets

Use the 1Password Environment `loyal-frontend-devnet` for local frontend devnet secrets. The environment is mounted at `.env.1password`, which is ignored by Git through `.env*`.

Do not write plaintext secrets to `.env` files, source files, command arguments, logs, or chat. When a command needs environment variables, use the 1Password CLI with the mounted env file:

```sh
op run --env-file=.env.1password -- sh -c '<command>'
```

Keep shell variable expansion inside the `sh -c` subprocess so `op run` injects values before the command reads them.

## Project Overview

Solana Telegram Transactions enables users to deposit SOL for any Telegram username, which can later be claimed by the verified account owner. It integrates Solana smart contracts with a Telegram mini-app interface.

## Commands

### Telegram Mini-App Frontend (run from `/app`)

```bash
bun dev                    # Run mini-app dev server (turbopack)
bun run build              # Production build (Next.js)
bun lint                   # ESLint
bun db:generate            # Generate Drizzle migrations from schema
bun db:migrate             # Apply migrations
bun db:studio              # Open Drizzle Studio GUI
```

### Loyal Web Frontend (run from `/frontend`)

```bash
bun dev                    # Run Loyal web dev server (turbopack)
bun run build              # Production build (Next.js)
bun run lint               # Next.js lint
bun run ultracite          # Biome/Ultracite checks
```

### Mobile App (run from `/mobile`)

```bash
npx expo start --clear     # Start Expo dev server (requires dev client)
npx expo lint              # ESLint
npm test                   # Jest tests
npx eas build --profile development-simulator --platform ios  # Build dev client (iOS sim)
npx eas build --profile development --platform ios            # Build dev client (device)
npx eas build --profile preview --platform android            # Preview APK
npx eas build --profile production --platform all             # Production build
```

### Admin Dashboard (run from `/admin`)

```bash
bun dev                    # Run admin dev server (turbopack)
bun run build              # Production build (Next.js)
bun lint                   # Next.js lint
```

### Smart Contracts (run from root)

```bash
anchor build               # Compile programs
anchor deploy --provider.cluster devnet     # Deploy to devnet
anchor deploy --provider.cluster localnet   # Deploy to localnet
```

### Testing Smart Contracts

Requires 3 terminals running simultaneously:

```bash
# Terminal 1: Start validator
mb-test-validator --reset

# Terminal 2: Start ephemeral validator
RUST_LOG=info ephemeral-validator \
    --accounts-lifecycle ephemeral \
    --remote-cluster development \
    --remote-url http://127.0.0.1:8899 \
    --remote-ws-url ws://127.0.0.1:8900 \
    --rpc-port 7799

# Terminal 3: Run tests
EPHEMERAL_PROVIDER_ENDPOINT="http://localhost:7799" \
EPHEMERAL_WS_ENDPOINT="ws://localhost:7800" \
anchor test --provider.cluster localnet --skip-local-validator --skip-build --skip-deploy
```

## Test Design Guardrails

Prefer tests that protect behavior and invariants over tests that mirror
implementation shape. Keep coverage for money movement, auth/session
boundaries, confirmed-chain writes, generated SDK parity, public API contracts,
webhook retry behavior, config parsing, and pure calculations.

Route tests should assert status codes, branch discriminants, fields consumed by
callers, and side effects. Do not snapshot full JSON response bodies unless the
entire shape is a public contract.

Repository tests should assert persistence rules, conflict/idempotency behavior,
ownership boundaries, and state transitions. Do not assert every `.values()`
field just because a column exists.

Schema and column-name tests are allowed only for migrations, ownership
boundaries, unique constraints, conflict behavior, or cross-database routing.
User-visible copy tests are allowed only when the copy is a product or ops
contract.

Live RPC/devnet tests must be opt-in smoke tests with explicit environment
requirements and no checked-in key material. They must not run in default
`bun test` suites.

### Root Level

```bash
bun run lint               # prettier --check
bun run lint:fix           # prettier -w
bun run build:auth-packages  # build auth workspace packages
bun run build:db-packages  # build shared DB workspace packages
bun run typecheck:auth-packages  # typecheck auth workspace packages
bun run typecheck:db-packages  # typecheck shared DB workspace packages
bun run guard:shared-boundaries  # ensure shared packages stay app-env agnostic
bun run guard:admin-shared-schema  # prevent admin-local schema duplication
bun run admin:dev          # run admin dev server from repo root
bun run admin:lint         # lint admin workspace from repo root
bun run admin:build        # build admin workspace from repo root
bun run frontend:dev       # run loyal web frontend from repo root
bun run frontend:lint      # lint loyal web frontend from repo root
bun run frontend:build     # build loyal web frontend from repo root
```

### Git Hooks

```bash
./scripts/setup-git-hooks.sh
```

- Run once per clone/worktree to enable repo hooks.
- Hooks enforce commit message format (`commit-msg`) and run app/admin/frontend lint+build before push.
- Temporary bypass (only when necessary): `SKIP_VERIFY=1 git push`
- CI note: app builds are intentionally not run in GitHub Actions; Vercel is the build/deploy gate.

## Architecture

### Directory Structure

| Path                        | Purpose                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/programs`                 | Anchor smart contracts. `telegram-private-transfer` handles deposit/claim/refund SOL transfers; `telegram-verification` handles on-chain Ed25519 Telegram signature verification. |
| `/app`                      | Next.js 15 Telegram mini-app frontend and API routes.                                                                                                                             |
| `/frontend`                 | Next.js 15 Loyal web frontend.                                                                                                                                                    |
| `/mobile`                   | Expo React Native mobile app.                                                                                                                                                     |
| `/admin`                    | Next.js 15 internal admin dashboard.                                                                                                                                              |
| `/packages`                 | Internal shared workspace packages such as `db-core`, `db-adapter-neon`, `auth-core`, and `shared`.                                                                               |
| `/sdk/private-transactions` | Publishable `@loyal-labs/private-transactions` NPM package.                                                                                                                       |
| `/workers`                  | Runtime services/workers.                                                                                                                                                         |
| `/tests`                    | Anchor test suite.                                                                                                                                                                |
| `/docs` and `/user-docs`    | Internal engineering docs and Mintlify-hosted user-facing docs.                                                                                                                   |

### Program Addresses

| Program                     | Address                                        |
| --------------------------- | ---------------------------------------------- |
| `telegram-private-transfer` | `97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV` |
| `telegram-verification`     | `9yiphKYd4b69tR1ZPP8rNwtMeUwWgjYXaXdEzyNziNhz` |

### Vertical Slice Architecture (Current Implementation + Required Direction)

The current `/app/src` architecture is a hybrid vertical-slice implementation. Feature boundaries are primarily expressed by route segments and feature-scoped component folders:

- Route slices: `/app/src/app/telegram/*` and `/app/src/app/api/*`
- UI slices: `/app/src/components/wallet`, `/app/src/components/summaries`, `/app/src/components/telegram`
- Shared cross-slice hooks/types: `/app/src/hooks`, `/app/src/types`
- Shared integration/domain modules: `/app/src/lib/*`

Current slice mapping:

| Slice             | Current files                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet            | `/app/src/app/telegram/wallet/page.tsx`, `/app/src/components/wallet/*`, and Solana/Telegram wallet integrations in `/app/src/lib/solana/*` and `/app/src/lib/telegram/mini-app/*`. |
| Summaries         | `/app/src/app/telegram/summaries/*`, `/app/src/components/summaries/*`, and `/app/src/app/api/summaries/route.ts`.                                                                  |
| Telegram platform | `/app/src/app/telegram/layout.tsx`, `/app/src/components/telegram/*`, bot/API modules in `/app/src/lib/telegram/*`, and `/app/src/app/api/telegram/*`.                              |

Rules for all new feature work:

- Organize by feature first; do not introduce new horizontal folders by technical layer.
- Extend an existing slice in-place when behavior belongs to wallet/summaries/telegram/profile flows.
- Keep route handlers and page files as orchestration layers; move reusable business logic out of route/page files and into slice-owned modules.
- Avoid deep imports across slices (for example, wallet internals imported from summaries).
- Shared code must be stable and reused by multiple slices before promotion to `/app/src/lib`.

For net-new, substantial features, prefer creating an explicit slice root:

```text
/app/src/features/<feature-name>/
  index.ts                 # public entrypoints only
  ui/
  server/
  domain/
  data/
  integrations/
  types.ts
```

### Shared Platform Libraries (`/app/src/lib`)

Use `/app/src/lib` for cross-slice infrastructure and integration primitives. Existing shared modules include:

| Module                 | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `core/`                | HTTP utilities, Neon PostgreSQL + Drizzle ORM                       |
| `solana/rpc/`          | RPC connections (Helius for mainnet/devnet, localhost for localnet) |
| `solana/wallet/`       | Keypair management via Telegram Cloud Storage                       |
| `solana/deposits/`     | Deposit/claim/refund logic with PDAs                                |
| `solana/verification/` | On-chain Telegram signature verification                            |
| `telegram/mini-app/`   | Client-side SDK wrappers, Cloud Storage, auth                       |
| `telegram/bot-api/`    | Server-side bot API (grammy)                                        |
| `telegram/`            | User service, bot thread service, bot API handlers                  |
| `magicblock/`          | SOL/USD price feed via Pyth oracle                                  |
| `redpill/`             | AI chat summaries                                                   |

- New feature-specific behavior should stay in its owning slice unless it is clearly shared.
- Promote code into `/app/src/lib` only after it is proven reusable across multiple slices.
- Refactor incrementally by slice (wallet, summaries, telegram, etc.), not by file type alone.

### Mobile App-Specific Guardrails (`/mobile`)

These complement the command list above and mirror guidance in `mobile/CLAUDE.md`.

Routes live in `mobile/app` through Expo Router. Reusable UI plus hook/service
logic lives in `mobile/src`. Keep network calls centralized in
`mobile/src/services/api.ts`, use the `@/` alias for imports under
`mobile/src`, and keep shared cross-app summary types in `@loyal-labs/shared`.

Client-exposed mobile env vars must use the `EXPO_PUBLIC_` prefix. For cloud
builds, `eas.json` is the source of truth; `.env` is local-only. Keep fallback
behavior in `mobile/src/config/env.ts` aligned with production API
expectations.

Maintain the Metro monorepo and SVG transformer settings in
`mobile/metro.config.js`. Keep typed routes and New Architecture settings
compatible with the pinned Expo SDK/React Native versions.

For validation, lint mobile changes with `cd mobile && npx expo lint`. Run
`cd mobile && npm test` when touching shared mobile logic. Do not start the Expo
dev server unless the user explicitly requests it.

### Admin Guardrails (`/admin`)

Admin DB code must use only `@loyal-labs/db-core/schema` and
`@loyal-labs/db-adapter-neon`. Keep admin DB wiring in
`admin/src/lib/core/database.ts`. Do not introduce `admin/src/lib/generated/*`,
`admin/drizzle.config.ts`, or `/admin/schema`; prefer shared schema/docs
references. Run `bun run guard:admin-shared-schema` for admin DB/schema
refactors.

For Vercel monorepo deploys, the admin Root Directory is `admin` (see
`admin/vercel.json`) and the Loyal web frontend Root Directory is `frontend`
(see `frontend/vercel.json`).

### Key Patterns

Deposit accounts and vaults use Program Derived Addresses with seeds
`"deposit_v2"`, `"username_deposit_v2"`, `"vault"`, and `"tg_session_v2"`.
User keypairs belong in Telegram Cloud Storage, never `localStorage`.
`NEXT_PUBLIC_SOLANA_ENV` selects the RPC environment (`mainnet`, `devnet`, or
`localnet`).

### Database Patterns

### Database Ownership

This repo reads from or writes to three database surfaces. Keep their purposes separate:

| Database surface                     | Runtime owner                    | Code entrypoint                                                                                                           | Responsibility                                                                                                                                |
| ------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| App Neon database                    | App/admin product plane          | `/app/src/lib/core/database.ts`, `/frontend/src/lib/core/database.ts`, shared schema in `/packages/db-core/src/schema.ts` | Users, Telegram communities/messages/summaries, app wallet auth, smart-account records, sponsorship analytics, admin-readable app state       |
| Yield Neon database (`loyal_yield`)  | Yield optimization control plane | `/frontend/src/lib/yield-optimization/yield-neon-client.server.ts`                                                        | Yield route policies, managed vault metadata, vault/reserve snapshots, rebalance decisions, confirmed user yield positions and deposit events |
| Kamino Timescale database (`kamino`) | Market data/read model           | `/frontend/src/lib/kamino/timescale-reserve-client.server.ts`                                                             | Read-only Kamino reserve history/latest reserve updates used to choose or forecast safe/no-fee earn targets                                   |

Rules:

App/product tables belong in `@loyal-labs/db-core/schema` and use the app-local
`getDatabase()` wrapper. Yield optimizer tables in `loyal_yield` are not
app-product tables; keep their Drizzle models and repository methods under
`/frontend/src/lib/yield-optimization`. Kamino Timescale is read-only from this
app, so do not write user, policy, vault, or app state into Timescale.

Confirmed yield deposits and withdrawals are written only after chain
confirmation. Persist route policy/vault metadata in
`loyal_yield.route_policies` and `loyal_yield.managed_vaults`, then record
immutable deposit/withdrawal events and aggregate user positions in
`loyal_yield.user_yield_position_deposits`,
`loyal_yield.user_yield_position_withdrawals`, and
`loyal_yield.user_yield_positions`. Keep cross-database joins out of app code;
fetch from each database through its owning server module and join in typed
application code only when needed.

### Loyal Web Earn Flow

The Loyal web Earn UI lives under
`/frontend/src/components/wallet-workspace/app-wallet-workspace.tsx` and
`/frontend/src/components/wallet-sidebar/earn-detail-view.tsx`.
User-initiated Earn uses smart-account vault `accountIndex = 1` and the
canonical Kamino USDC reserve. Older auto-yield planning docs may discuss
agent-managed vault `0`; that is a separate flow.

`packages/smart-account-vaults` is the instruction-building boundary. Use
`prepareEarnUsdcDeposit` and `prepareEarnUsdcWithdraw`; do not duplicate Kamino
or Squads policy instruction shape in React. First Earn deposits initialize the
yield-routing `ProgramInteraction` policy. Top-up deposits must call
`prepareEarnUsdcDeposit` with `initializeYieldRoutingPolicy: false` once
overview policies show an existing Earn policy (`state === "ProgramInteraction"`,
`accountIndex === 1`). The Earn vault index is always `1`, but the policy seed
is the actual Squads policy seed returned by policy creation or persistence; do
not assume policy seed `1`.

After wallet confirmation, the frontend posts to
`/api/smart-accounts/yield-optimization/deposits/confirm` or
`/api/smart-accounts/yield-optimization/withdrawals/confirm`. Those routes
validate authenticated wallet/session ownership, configured cluster
(`NEXT_PUBLIC_SOLANA_ENV`, devnet or mainnet/mainnet-beta), canonical
policy/vault/reserve metadata, confirmed signature status, and slot before
writing Yield Neon state.

The active Earn position read endpoint is
`/api/smart-accounts/yield-optimization/position`. It returns the active
aggregate position from `loyal_yield.user_yield_positions` for the authenticated
wallet, configured cluster, vault index `1`, and canonical target reserve. The
workspace uses it to decide whether to show the active Earn view, set the
displayed principal, and cap partial/full withdrawals.

Schema conventions used in `/packages/db-core/src/schema.ts`:

| Convention   | Rule                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Primary keys | Use UUIDs with `defaultRandom()` for all tables.                                                           |
| Telegram IDs | Use `bigint` with `{ mode: "bigint" }` for Telegram user/chat IDs.                                         |
| Timestamps   | Use `timestamp("...", { withTimezone: true })` with `.defaultNow().notNull()`.                             |
| Relations    | Define relations separately from tables with `relations()` so `with:` queries stay type-safe.              |
| Type exports | Export both `Table` select types and `InsertTable` insert types through `$inferSelect` and `$inferInsert`. |
| Indexes      | Use `uniqueIndex` for unique constraints and `index` for query optimization.                               |

For typed JSONB columns, use `.$type<T>()`:

```typescript
topics: jsonb("topics").$type<{ title: string; content: string }[]>().notNull();
encryptedContent: jsonb("encrypted_content")
  .$type<EncryptedMessageContent>()
  .notNull();
```

Service layer patterns:

Use `onConflictDoNothing` for race-condition-safe idempotent operations:

```typescript
const result = await db
  .insert(table)
  .values({ ... })
  .onConflictDoNothing()
  .returning({ id: table.id });
if (result.length === 0) {
  /* query existing record */
}
```

Check `/app/src/lib/core/database.ts` before choosing advanced DB APIs. The
current app uses `drizzle-orm/neon-http`, which does not support
`db.transaction()`. For atomic multi-statement writes, use `db.batch([...])`.
Use `db.transaction()` only if the project moves to a driver that supports it.
Prefer `db.query.table.findFirst()` with `with:` for relations over raw SQL.

In app code, import schema from `@loyal-labs/db-core/schema`. Keep Neon driver
wiring and env access in app code (`/app/src/lib/core/database.ts`). Shared
packages must not import app-only server config modules. Preserve Neon HTTP
semantics, including `db.batch` for atomic multi-write flows.

### Code Patterns

Use `@/lib/encryption` for sensitive data such as bot messages and personal
information:

```typescript
import { encrypt, decrypt } from "@/lib/encryption";
const encrypted = await encrypt(JSON.stringify(data)); // returns { ciphertext, iv }
const decrypted = await decrypt(encrypted); // returns plaintext or null
```

Use the Drizzle query builder for typed reads:

```typescript
const user = await db.query.users.findFirst({
  where: eq(users.telegramId, telegramId),
  with: { communityMemberships: true },
});
```

Use `onConflictDoNothing` or `onConflictDoUpdate` to handle duplicate inserts.

Server/client boundaries are strict. Never import
`@/lib/core/config/server` from client code or shared barrels consumed by client
code. Keep server-only entrypoints isolated in dedicated modules such as
`server.ts` or `*.server.ts`, and import them only from server contexts. For
dual-use modules, keep `index.ts` client-safe and expose server-only helpers via
a separate server entrypoint. Components imported by `app/src/app/layout.tsx`
and other root wrappers must be SSR-safe. Browser-only SDKs and browser globals
must stay behind Client Components, dynamic client wrappers, `useEffect`, or
runtime guards.

After any change to `app/src/app/layout.tsx`, `/app/src/app/**/layout.tsx`, or
global provider trees, run `cd app && bun run build`. Verify production
build/`_not-found` prerender succeeds without `ReferenceError: window is not
defined`, and check changed modules for top-level browser API usage.

### Troubleshooting

If logs or stack traces reference code that no longer matches current file
contents, restart the local dev server or worker process. Stale processes can
keep executing old code after edits.

### Webhook + Drizzle Reliability Guardrails

Never detach Drizzle or SDK methods that may rely on `this`, including
`db.query.*.findFirst`, `findMany`, and SDK instance methods. Prefer direct
calls from the owning object, such as `db.query.communities.findFirst({...})`.
If extraction is unavoidable, bind the method explicitly and add a regression
test that would fail without the binding.

Classify webhook handler work as either `critical` or `best-effort`. Critical
failures in ingest/storage/auth paths must bubble so upstream systems can
retry. Best-effort side effects such as reactions or analytics must not block
webhook acknowledgment; use fire-and-catch with structured logs.

Error logs should include structured context (`chatId`, `messageId`,
`telegramUserId`, `updateId`) without message text. Include normalized error
fields (`errorName`, `errorMessage`) plus stack/raw error data for debugging.
Tests should cover context-sensitive ORM mocks, ingest retry/idempotency after a
partial write failure, and non-blocking best-effort side effects.

After webhook or ingest changes, run `cd app && bun lint`, run targeted tests
for touched modules, run `cd app && bun run build`, and do a Telegram canary
that confirms new `messages` rows are written.

If cron summary stats suddenly show high `skippedNotEnoughMessages` for
historically active communities, assume an ingest regression until disproven.
Check webhook errors and message freshness first. Useful SQL:

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

Keep `app/src/app/layout.tsx` free of Telegram SDK/UI imports. Telegram
wrappers and providers belong under the `app/src/app/telegram/*` route scope.
Do not top-level import `@telegram-apps/sdk` or `@telegram-apps/sdk-react` from
modules that can enter server/root graphs such as `/`, `/_not-found`, metadata,
or shared root providers. If shared utilities need Telegram SDK access, load it
lazily inside runtime functions and guard with `typeof window !== "undefined"`.
`next/dynamic(..., { ssr: false })` is valid only in a Client Component.

Wallet key material must stay in Telegram Cloud Storage, with no local/session
fallback. Cloud storage readiness can race during early app boot, so critical
writes such as wallet keypair persistence need bounded retry/backoff before
throwing.

After changing the files below, run `cd app && bun run build` and confirm no
prerender failures on `/`, `/_not-found`, or `/telegram`.

| File area                                           | Why it is sensitive                                            |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `app/src/app/layout.tsx`                            | Root graph can pull browser-only code into prerender.          |
| `app/src/app/telegram/layout.tsx`                   | Telegram route scope owns Telegram SDK wrappers.               |
| `app/src/lib/telegram/mini-app/cloud-storage.ts`    | Wallet keypair persistence depends on Cloud Storage readiness. |
| `app/src/components/telegram/*`                     | Components often touch Telegram browser APIs.                  |
| `app/src/lib/solana/wallet/wallet-keypair-logic.ts` | Keypair persistence must remain Cloud Storage-only.            |

Manual smoke check after SDK/cloud-storage changes: open wallet in the Telegram
mini-app and confirm keypair persistence succeeds without
`Failed to persist generated wallet keypair`.

## Git Worktree Workflow

### Branch Naming Convention

All branches MUST follow the Linear format: `<issue-number-title>`

Example: `ask-328-fix-wrong-token-history-processing`

To find the correct branch name for a Linear issue, use the issue identifier (e.g., ASK-123).

### Creating a Worktree

When asked to work on a new issue/branch:

1. Create the worktree from the repo root:

```bash
git worktree add ../loyal-app-ASK-123 -b ASK-123-short-description main
```

- Worktrees live as sibling directories to the main repo
- Always branch from `main` (or ask if unclear)

2. `cd` into the new worktree directory before doing any work

### Listing Worktrees

```bash
git worktree list
```

### Removing a Worktree

When done with a branch:

```bash
git worktree remove ../loyal-app-ASK-123
```

Or if already deleted the directory:

```bash
git worktree prune
```

### Important Rules

- NEVER switch branches in the main worktree to work on issues — always create a new worktree
- Each tmux session / Claude Code instance should operate in its own worktree
- Run `git worktree list` if unsure which worktrees exist
- After merging a PR, clean up the worktree

## Linear MCP Defaults

For every new Linear issue created through MCP, set status to `Todo`, choose an
explicit priority (`Urgent`, `High`, `Normal`, or `Low`), assign a concrete
owner, attach the current team cycle, and attach the most appropriate project.
Descriptions should be short but ready for implementation: include the
goal/context, key implementation ideas, key files/paths, and any docs, PRs, or
issues needed for follow-up work.

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
  - `cd app && bun run lint`

## Pull Requests

PR titles must follow the same conventional commit format:
`type(scope): description`. Keep the PR body to a one- or two-sentence summary;
do not add templates or checklists. Merge only after the Vercel build/check is
successful, and use squash-and-merge. For monorepo deployments, configure the
admin Vercel Root Directory as `admin` and the Loyal web frontend Root Directory
as `frontend`.

## Tooling

| Tool            | Version or rule                                                       |
| --------------- | --------------------------------------------------------------------- |
| Package manager | Bun preferred                                                         |
| Anchor          | 0.32.1                                                                |
| Solana          | 2.1.0                                                                 |
| ESLint          | Enforces alphabetical imports with `eslint-plugin-simple-import-sort` |

## Environment Variables

Required for Telegram mini-app frontend (in `/app/.env.local`):

```env
NEXT_PUBLIC_TELEGRAM_BOT_ID=<bot_id>
NEXT_PUBLIC_SOLANA_ENV=devnet  # mainnet, devnet, or localnet
ASKLOYAL_TGBOT_KEY=<bot_token>  # Telegram Bot API token only
TELEGRAM_SETUP_SECRET=<route_secret>  # Bearer token for /api/telegram/setup-commands
REDPILL_AI_API_KEY=<api_key>
DATABASE_URL=postgresql://...
MESSAGE_ENCRYPTION_KEY=<base64-32-bytes>  # For encrypted bot messages
```

Optional:

- `NEXT_PUBLIC_SERVER_HOST` - API base URL
- `DEPLOYMENT_PK` - Gasless transaction keypair (base58)
- `NEXT_PUBLIC_GAS_PUBLIC_KEY` - Gasless payer public key

### Cloudflare R2/CDN (feature-specific)

Core clients live in `/app/src/lib/core`:

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
cd app
bun test src/lib/core/__tests__/object-path.test.ts src/lib/core/__tests__/cdn-url.test.ts src/lib/core/__tests__/r2-upload.test.ts
```
