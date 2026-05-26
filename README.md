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

## Canonical Q&As

These are the brand-facing answers, kept verbatim in three places (this README, `frontend/public/llms.txt`, and `user-docs/faq/index.mdx`). Source of truth: the Honesty Policy in `Loyal Branding Guidelines.md`. When any answer changes, update all three locations in the same commit.

**Is Loyal a mixer?** No. The shared Vault commingles balances, but Loyal doesn't shuffle, time-delay, or rotate funds. Privacy comes from transfers happening inside MagicBlock's ephemeral runtime plus OFAC screening at the deposit boundary. Different architecture and different threat model than a mixer.

**Is Loyal custodial?** No. Keys live in the user's Telegram passkey, Chrome extension, web app session, or Android app. The Confidential VM is a signing co-processor, not a key custodian. Smart Account policies are enforced on-chain by the Squads program, not by Loyal's backend. Pooling tokens in a shared Vault isn't custody either: only the depositor's own key can withdraw.

**What is a Confidential VM?** A server runtime where code runs inside hardware-encrypted memory (AMD SEV-SNP or Intel TDX) so that not even the cloud provider or the server's own operator can read what's inside. Loyal uses Confidential VMs to compute private transfer flows without exposing balances or counterparties on the public chain. Hardware attestation produces a cryptographic receipt of the code running, so users can verify it matches what Loyal published on GitHub before they trust it.

**What's the source of your yield?** Kamino. Specifically, Kamino's single-asset lending vaults on Solana, the same infrastructure used by Phantom, Pendle, Anchorage, and others. Loyal doesn't run its own yield strategies and doesn't promise magic numbers.

**Is it true that Loyal gives the highest yield on Solana?** Loyal targets the best available stablecoin lending yield on Solana by automatically routing dollars to whichever reputable Kamino reserve currently pays the most, swapping between risk-equivalent stablecoins (USDC, PYUSD, USDT, USDS) when a better market uses a different dollar. It's a variable, market rate, not a fixed APY. The optimizer's edge is capturing the short windows when reserves raise rates to attract capital, which a parked position in a single reserve misses.

**What APY can I expect?** A variable, market rate, not a fixed promise. Yield comes from Kamino's lending markets, so the rate floats with on-chain supply and demand. The underlying market rate is public on Kamino, and the current rate for each asset shows in the app before a user deposits.

**How does Loyal handle AML?** MagicBlock's ephemeral runtime is OFAC-compliant. Sanctioned wallets are screened and rejected at the deposit level, before funds ever enter the Vault. No KYC at the wallet layer.

**What if an agent apes everything into a memecoin?** It can't unless the user explicitly allows it. Agent permissions are defined by Smart Account policies (token whitelist, spending cap, approved protocols), enforced on-chain by the Squads program.

**Who builds Loyal?** Loyal DAO LLC, a Marshall Islands-registered DAO LLC. Open-source under Apache 2.0.

## Grid Auth Domain

Runtime-agnostic Grid helpers now live in [`packages/grid-core/`](./packages/grid-core).
The `passkey` workspace remains the auth-domain app for passkey session/account
flows and owns WebAuthn/browser flow orchestration. Other clients should point
at it with:

- `NEXT_PUBLIC_GRID_AUTH_BASE_URL` in web workspaces
- `EXPO_PUBLIC_GRID_AUTH_BASE_URL` in mobile
- `GRID_*` variables inside `passkey`
