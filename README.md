# Loyal App

Loyal App is a monorepo for Telegram-native Solana products.
It combines on-chain Anchor programs, a Telegram mini-app, an internal admin dashboard,
the Loyal web frontend, shared packages/SDKs, and worker services.

## Monorepo Structure

| Directory | What it contains | Start here |
| --- | --- | --- |
| [`app/`](./app) | Next.js Telegram mini-app and API routes | [`app/README.md`](./app/README.md) |
| [`frontend/`](./frontend) | Next.js Loyal web frontend | [`frontend/README.md`](./frontend/README.md) |
| [`admin/`](./admin) | Internal Next.js admin dashboard | [`admin/README.md`](./admin/README.md) |
| [`passkey/`](./passkey) | Next.js passkey proxy app for Squads Grid custom-domain WebAuthn flow | [`passkey/README.md`](./passkey/README.md) |
| [`programs/`](./programs) | Anchor smart contracts (`telegram-verification`, `telegram-private-transfer`) | [`programs/`](./programs) |
| [`tests/`](./tests) | Anchor integration tests | [`tests/`](./tests) |
| [`packages/`](./packages) | Shared workspace libraries (`db-core`, `db-adapter-neon`, `grid-core`, `llm-core`, `llm-server`, `shared`) | [`packages/`](./packages) |
| [`sdk/`](./sdk) | Publishable SDKs for deposits and private transfers | [`sdk/private-transactions/README.md`](./sdk/private-transactions/README.md) |
| [`workers/`](./workers) | Background workers and service runtimes | [`workers/userbot/README.md`](./workers/userbot/README.md) |
| [`docs/`](./docs) | Internal engineering and operations documentation | [`docs/README.md`](./docs/README.md) |
| [`user-docs/`](./user-docs) | Public Mintlify documentation content | [`user-docs/README.md`](./user-docs/README.md) |
| [`scripts/`](./scripts) | Repository automation scripts and setup helpers | [`scripts/`](./scripts) |
| [`githooks/`](./githooks) | Git hook scripts used by local workflow checks | [`githooks/`](./githooks) |
| [`migrations/`](./migrations) | Root-level migration artifacts and migration history | [`migrations/`](./migrations) |

## Quick Start (Contributors)

1. Install dependencies:
   ```bash
   bun install
   ```
2. Enable repository hooks (one-time per clone):
   ```bash
   ./scripts/setup-git-hooks.sh
   ```
3. Run the main app:
   ```bash
   cd app
   bun dev
   ```

For Vercel monorepo deploys, use separate projects with Root Directory set to `app`, `admin`, and `frontend` respectively.

## Common Commands

### Root

```bash
bun run lint
bun run lint:fix
bun run build:grid-packages
bun run build:db-packages
bun run build:shared-packages
bun run build:llm-packages
bun run typecheck:grid-packages
bun run typecheck:db-packages
bun run typecheck:shared-packages
bun run typecheck:llm-packages
bun run guard:shared-boundaries
bun run guard:llm-package-boundaries
bun run guard:admin-shared-schema
bun run admin:dev
bun run admin:lint
bun run admin:build
bun run frontend:dev
bun run frontend:lint
bun run frontend:build
bun run passkey:dev
bun run passkey:lint
bun run passkey:build
```

### Telegram App (`/app`)

```bash
bun dev
bun run build
bun lint
bun db:generate
bun db:migrate
bun db:studio
```

### Loyal Web Frontend (`/frontend`)

```bash
bun dev
bun run build
bun run lint
```

### Admin (`/admin`)

```bash
bun dev
bun run build
bun lint
```

### Smart Contracts (`/`)

```bash
anchor build
anchor deploy --provider.cluster devnet
anchor deploy --provider.cluster localnet
```

## Local Solana / Anchor Testing

Local tests require three terminals:

1. Terminal 1: Start validator
   ```bash
   mb-test-validator --reset
   ```
2. Terminal 2: Start ephemeral validator
   ```bash
   RUST_LOG=info ephemeral-validator \
       --accounts-lifecycle ephemeral \
       --remote-cluster development \
       --remote-url http://127.0.0.1:8899 \
       --remote-ws-url ws://127.0.0.1:8900 \
       --rpc-port 7799
   ```
3. Terminal 3: Run tests
   ```bash
   EPHEMERAL_PROVIDER_ENDPOINT="http://localhost:7799" \
   EPHEMERAL_WS_ENDPOINT="ws://localhost:7800" \
   anchor test --provider.cluster localnet --skip-local-validator --skip-build --skip-deploy
   ```

Devnet flow:

```bash
anchor build && anchor deploy --provider.cluster devnet
EPHEMERAL_PROVIDER_ENDPOINT="http://localhost:7799" \
EPHEMERAL_WS_ENDPOINT="ws://localhost:7800" \
anchor test --provider.cluster devnet --skip-local-validator --skip-build --skip-deploy
```

## Documentation

- Internal docs: [`/docs`](./docs) and [`docs/README.md`](./docs/README.md)
- Public docs: [`/user-docs`](./user-docs) and [`user-docs/README.md`](./user-docs/README.md)

Mintlify local preview:

```bash
cd user-docs
mint dev
```

Subtree sync from `loyal-docs`:

```bash
git subtree pull --prefix=user-docs loyal-docs main --squash
```

## Commit and PR Conventions

We use Conventional Commits for commit messages and pull request titles.

Enabled hooks:

- `commit-msg`: validates Conventional Commit messages
- `pre-push`: runs `app`, `admin`, and `frontend` lint->build pipelines in parallel before push
- Temporary bypass when required: `SKIP_VERIFY=1 git push`
- CI note: app build is intentionally not run in GitHub Actions; Vercel is the build/deploy gate

Optional local commit message check:

```bash
echo "feat(scope): short description" | bunx commitlint --verbose
```

GitHub pull requests also enforce commit messages and PR titles with the same rules.

## Grid Auth Domain

Runtime-agnostic Grid helpers now live in [`packages/grid-core/`](./packages/grid-core).
The `passkey` workspace remains the auth-domain app for passkey session/account
flows and owns WebAuthn/browser flow orchestration. Other clients should point
at it with:

- `NEXT_PUBLIC_GRID_AUTH_BASE_URL` in web workspaces
- `EXPO_PUBLIC_GRID_AUTH_BASE_URL` in mobile
- `GRID_*` variables inside `passkey`
