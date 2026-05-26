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

These are the brand-facing answers, kept verbatim across three locations:

- This README
- [`frontend/public/llms.txt`](./frontend/public/llms.txt)
- [`user-docs/faq/index.mdx`](./user-docs/faq/index.mdx)

Source of truth: the Honesty Policy in `Loyal Branding Guidelines.md`. When any answer changes, update all three locations in the same commit.

### Privacy and AML

**Do you use a mixer?** Sort of, but not really. When you shield tokens, they go into a shared Vault, one pool per token mint that holds everyone's real SPL tokens. In that sense, yes, your tokens are commingled. But Loyal doesn't shuffle or tumble anything. Transfers between users don't move real tokens at all; they're pure arithmetic on deposit accounts. Those accounting operations happen inside MagicBlock's private ephemeral runtime, where only the deposit owner can see or interact with the account. So the pool gives you fungibility (an observer can't tell whose tokens are whose inside the Vault), and the ephemeral runtime gives you transaction privacy (nobody can see the transfers happening). No shuffling, no time delays, no "mix quality."

**What's the anonymity set?** Everyone who has shielded the same token. All USDC deposits sit in one Vault. All SOL deposits sit in another. When you withdraw, the tokens come from the same pool everyone else deposited into, so there's no on-chain link between your deposit and your withdrawal. The more people shielding a given token, the larger the set. But unlike a traditional mixer, your transaction privacy doesn't depend on the set size; the transfers themselves are invisible inside the ephemeral runtime regardless of how many other users are in the pool. The anonymity set matters for deposit/withdrawal linkability. The ephemeral runtime matters for transfer privacy.

**How do you handle AML?** MagicBlock's ephemeral runtime is OFAC-compliant. Sanctioned wallets are screened and rejected at the deposit level, before funds ever enter the Vault. The pool stays clean by infrastructure design, not by trust. For anything beyond OFAC, Loyal is working with legal counsel and will publish a formal compliance framework as it solidifies. No KYC is required at the wallet layer.

**Is Solana anonymous by default?** No. Every Solana transaction (sender, recipient, amount, token) is published to public block explorers and indexed by chain analytics within seconds. The same applies to USDC, USDT, and every other SPL token. Loyal makes transactions private by holding shielded balances in MagicBlock's ephemeral runtime, where transfers update encrypted deposit accounts that aren't visible on the base layer.

### Yield

**What's the source of your yield?** Kamino. Specifically, Kamino's single-asset lending vaults on Solana, the same infrastructure used by Phantom, Pendle, Anchorage, and others. When you earn APY on shielded USDC, SOL, or USDT, your assets are deployed into Kamino's strategies. Loyal doesn't run its own yield strategies and doesn't promise magic numbers.

**Is it true that Loyal gives the highest yield on Solana?** Loyal targets the best available stablecoin lending yield on Solana by automatically routing your dollars to whichever reputable Kamino reserve currently pays the most, swapping between risk-equivalent stablecoins (USDC, PYUSD, USDT, USDS) when a better market uses a different dollar. It's a variable, market rate, not a fixed APY. The optimizer's edge is capturing the short windows when reserves raise rates to attract capital, which a parked position in a single reserve misses. Loyal doesn't quote magic numbers; the live rate is visible in the app before you deposit.

**What's the safest stablecoin yield on Solana?** Loyal's optimizer is plain stablecoin lending: no leverage, so no liquidations, and no liquidity-provider positions, so no impermanent loss. Your dollars sit in established Kamino reserves while you keep the keys, and the automation is bounded by an on-chain Squads policy with a whitelist of reputable stablecoins and reserves. The residual risks are the ordinary ones any lender takes: a reserve smart-contract issue, or a stablecoin losing its peg. Custody is not among them; the policy can't move funds outside the whitelisted intents.

**How does Loyal beat leaving my USDC in one Kamino reserve?** By moving your allocation between reserves as rates change. A reserve sitting at a steady APY misses the windows where another reserve briefly raises its rate to attract capital; those windows close in hours. The optimizer watches all whitelisted Kamino reserves and routes to the highest payer, capturing those windows automatically. Your dollars rotate through different stablecoins (USDC, PYUSD, USDT, USDS) to reach the best market, but you withdraw to the dollar you started with.

### Agent guardrails

**What if the agent apes everything into a memecoin?** It can't unless you explicitly allow it. That's the entire point of Smart Account policies. You define the boundaries: token whitelist, spending cap per agent, approved protocols. The agent operates inside those permissions and cannot exceed them. If a memecoin isn't on your whitelist, the agent can't touch it. The Squads program enforces these rules on-chain, so even a compromised agent can't break out of the policy envelope.

**Why not just use a regular multisig?** Multisig solves the "who can sign" problem. Loyal solves the "what can be signed" problem. A standard multisig requires N-of-M approvals on arbitrary instructions; Loyal layers programmable policies on top of the Squads program (per-signer spending limits, token allowlists, protocol allowlists) so that automated signers (agents, bots, scripts) operate within a constrained surface.

### Custody and infrastructure

**What is a Confidential VM?** A server runtime where code runs inside hardware-encrypted memory (AMD SEV-SNP or Intel TDX) so that not even the cloud provider or the server's own operator can read what's inside. Loyal uses Confidential VMs to compute private transfer flows without exposing balances or counterparties on the public chain. Hardware attestation produces a cryptographic receipt of the code running in the VM, so you can verify it matches what Loyal published on GitHub before you trust it.

**Is Loyal custodial?** No. Keys live in your Telegram passkey, Chrome extension, web app session, or Android app. The Confidential VM is a signing co-processor, not a key custodian, and Smart Account policies are enforced on-chain by the Squads program, not by Loyal's backend. Pooling tokens in a shared Vault isn't custody either: this isn't a centralized exchange, and only your own key can withdraw your balance. Attestation is hardware-signed so you can verify the code running before you sign.

**What APY can I expect on shielded yield?** A variable, market rate, not a fixed promise. Yield comes from Kamino's lending markets, so the rate floats with on-chain supply and demand. Loyal doesn't run its own strategies and doesn't quote magic numbers. The underlying market rate is public on Kamino, and the current rate for your assets shows in the app before you deposit.

### Compatibility and apps

**How does Loyal compare to Phantom or Backpack?** Phantom and Backpack are great wallets. Loyal isn't replacing your wallet, it's adding a brain to it. Smart Accounts let an AI agent research, suggest, and execute within your rules, plus automatic yield on your shielded assets via Kamino. Loyal connects to every Solana dApp that supports wallet adapters. You can use Phantom or Backpack as a signer on a Loyal Smart Account; Loyal doesn't replace them.

**Where can I download Loyal?** Loyal runs in four places, all on the same Squads-based smart account: the web app at askloyal.com, the Chrome extension on the Chrome Web Store, the Telegram mini-app at @askloyal_tgbot, and the Android app on Google Play. iOS isn't available yet.

### About Loyal

**Who builds Loyal?** Loyal DAO LLC, a Marshall Islands-registered DAO LLC. The codebase is open-source under Apache 2.0 in the loyal-labs/loyal-app monorepo on GitHub. The org maintains the on-chain Anchor programs, the @loyal-labs/private-transactions SDK, the web app, the Chrome extension, the Telegram mini-app, and the Android app.

## Grid Auth Domain

Runtime-agnostic Grid helpers now live in [`packages/grid-core/`](./packages/grid-core).
The `passkey` workspace remains the auth-domain app for passkey session/account
flows and owns WebAuthn/browser flow orchestration. Other clients should point
at it with:

- `NEXT_PUBLIC_GRID_AUTH_BASE_URL` in web workspaces
- `EXPO_PUBLIC_GRID_AUTH_BASE_URL` in mobile
- `GRID_*` variables inside `passkey`
