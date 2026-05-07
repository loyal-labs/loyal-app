# Smart Accounts API and Frontend Integration

This note documents the smart-account layers used by the frontend branch and the
recent Squads-related changes across the shared packages and CLIs.

## Reference Model

Loyal Smart Accounts target the Squads Smart Account Program. In the current
policy model:

- `Settings` is the root configuration and consensus account for root-level
  governance.
- Vaults are smart-account/sub-account PDAs derived from `settingsPda` and
  `accountIndex`; vault `0` is the canonical account in the frontend.
- Policy accounts are independent consensus accounts scoped under the same
  `Settings` root. Multiple policies are parallel authorities, not middleware
  that automatically stack on every transaction.
- `timeLock = 0` enables synchronous execution when the required signers are
  present in one transaction. Non-zero time locks require the async
  transaction/proposal/vote/execute path.
- Use `SpendingLimitPolicy` for new spending controls. The legacy Squads
  spending-limit accounts still exist for backwards compatibility but are not
  the preferred Loyal integration path.
- For edits to an existing policy, use `SettingsAction::PolicyUpdate` and build
  the update payload from the fetched policy state so omitted fields are
  preserved.

Primary protocol references:

- Squads policy branch README:
  `https://github.com/Squads-Protocol/smart-account-program/tree/policies`
- Squads hosted policy overview:
  `https://developers.squads.so/squads-api/api-reference/v1/policies`

## Package Layers

### `sdk/loyal-smart-accounts-core`

The core package owns generated protocol bindings, PDA helpers, codecs,
transport, prepared-operation compilation, and the operation registry. The
operation registry maps generated Squads instructions to feature namespaces and
client export names.

Feature groups currently include:

| Feature | Operations |
| --- | --- |
| `programConfig` | initialize and authority/treasury/creation-fee updates |
| `smartAccounts` | create account, direct authority updates, settings transactions |
| `proposals` | create, activate, approve, reject, cancel |
| `transactions` | create/close transactions, buffers, and `logEvent` |
| `batches` | create, add transaction, close, execute batch transaction |
| `policies` | create and close policy transactions |
| `spendingLimits` | legacy add/remove/use spending-limit instructions |
| `execution` | async execution, sync execution, settings execution, policy execution |

`logEvent` is exposed through the transaction feature for protocol event
logging. The current frontend changes do not build a separate app-level log
store; they use Solana simulation/wallet logs mainly for clearer user-facing
spending-limit errors.

### `sdk/loyal-smart-accounts`

The TypeScript SDK is the public TS wrapper over the core package. It exports:

- low-level protocol helpers: `generated`, `pda`, `codecs`,
  `errors`, `accounts`, `PROGRAM_ID`
- feature modules: `programConfig`, `smartAccounts`, `proposals`,
  `transactions`, `batches`, `policies`, `spendingLimits`, `execution`
- `createLoyalSmartAccountsClient(config)`

Each feature module has the same shape:

- `accounts`: generated account classes
- `instructions`: raw instruction builders for offline operations when exposed
- `prepare`: unbound prepared-operation builders
- `queries`: account fetchers
- `client(transport)`: bound `prepare`, bound `queries`, and send-ready client
  methods

The high-level client returns the same feature clients plus a generic
`client.send(prepared, { signers, confirm, sendOptions })`.

### `packages/smart-account-vaults`

This package is the frontend-facing adapter. It should be the default place for
vault UI and policy workflow code that needs to be shared between frontend
surfaces.

Exports:

- `createSmartAccountVaultsClient(config)`
- message helpers:
  - `createVaultSolTransferMessage`
  - `createVaultSplTransferMessage`
  - `createVaultCustomInstructionMessage`
  - `isSupportedTokenProgram`
  - `resolveVaultAccountIndex`
- spending-limit helpers:
  - `SOL_SPENDING_LIMIT_MINT`
  - period, reset, formatting, and token amount helpers
- wallet helpers:
  - `sendPreparedWithWallet`
  - `isWalletAdapterLike`
- read-model and action input types

Client reads:

- `fetchVault`
- `listVaults`
- `listSpendingLimitPolicies`
- `listSpendingLimits`
- `listProposals`
- `fetchOverview`

Client prepares:

- `prepareSolTransferProposal`
- `prepareSplTransferProposal`
- `prepareCustomInstructionProposal`
- `preparePolicyCustomInstructionProposal`
- `prepareAddInitiateSigner`
- `prepareRemoveInitiateSigner`
- `prepareSetSpendingLimitPolicy`
- `prepareRemoveSpendingLimitPolicy`
- `prepareUseSolSpendingLimitPolicy`
- `prepareApproveProposal`
- `prepareRejectProposal`
- `prepareExecuteProposal`
- `prepareExecuteSettingsProposal`
- `prepareExecutePolicyProposal`

Important behavior:

- `fetchOverview` joins settings, vault balances/portfolio/activity, policy
  signers, spending-limit policies, and proposals into one UI payload.
- Standard vault proposals create a transaction account and proposal account in
  one prepared operation.
- Policy custom proposals use the policy PDA as the consensus account and wrap
  the transaction message in a `PolicyPayload`.
- Settings changes use synchronous settings execution when the root threshold is
  `<= 1`; otherwise they create a settings transaction, create a proposal, and
  approve it.
- Spending-limit edits use `PolicyUpdate` for existing policies and preserve the
  fetched policy's mint, destinations, period, accumulation, exact-quantity
  setting, usage state, threshold, and time lock unless the caller explicitly
  overrides a field.
- SOL top-ups through a spending-limit policy use
  `executePolicyPayloadSync` and can be signed by a valid policy signer rather
  than the authenticated root settings signer.

## Frontend Usage

### Provisioning

The frontend service provisions one canonical smart account for an authenticated
wallet:

- It fetches the Squads program config to reserve the next settings index.
- It stores a pending DB record keyed by user and Solana environment.
- It creates the smart account through a sponsor path.
- It reconciles pending or failed records by checking whether the wallet is
  already a signer on the on-chain settings account.

Key files:

- `frontend/src/features/smart-accounts/service.ts`
- `frontend/src/features/smart-accounts/server/provisioner.ts`
- `frontend/src/features/smart-accounts/server/onchain.ts`
- `frontend/src/features/smart-accounts/server/repository.ts`

### Read Model Routes

The UI does not fetch Squads accounts directly from React for overview data.
Server routes create a `SmartAccountVaultsClient` with the configured RPC,
program id, and wallet data client:

- `GET /api/smart-accounts/overview` returns `SmartAccountOverview`.
- `GET /api/smart-accounts/vault-activity?accountIndex=<n>` returns a paged
  activity payload for one vault.

The read model has short cooldowns for RPC rate limits and retry/backoff for a
newly created settings account that has not propagated yet.

Key files:

- `frontend/src/app/api/smart-accounts/overview/route.ts`
- `frontend/src/app/api/smart-accounts/vault-activity/route.ts`
- `frontend/src/features/smart-accounts/server/read-model.ts`

### React Hook and Wallet Actions

`frontend/src/hooks/use-smart-account-sidebar-data.ts` is the main browser
adapter. It:

- fetches the server overview and vault activity routes
- maps vaults, portfolio positions, activity, proposals, signers, and
  spending-limit policies into sidebar view models
- prepares proposal actions with `createSmartAccountVaultsClient`
- sends prepared operations through `sendPreparedWithWallet`
- chooses execution helpers based on proposal payload type:
  - `settings_transaction` -> `prepareExecuteSettingsProposal`
  - `policy_transaction` -> `prepareExecutePolicyProposal`
  - `transaction` -> `prepareExecuteProposal`
- normalizes wallet/Solana logs for spending-limit errors, including
  insufficient vault SOL, insufficient fee-payer SOL, exceeded spending limits,
  and policy reallocation failures

### CLI Agent Connect Flow

`cli/loyal-cli` opens the frontend with `?connect=<CLI_PUBLIC_KEY>` during
`loyal auth`. The frontend detects that query parameter, opens the connection
request view, and calls `addInitiateSigner`.

That action attaches the CLI key as an `Initiate` signer on an existing
spending-limit policy. The CLI then detects the policy connection by scanning or
subscribing to policy accounts where its public key appears in the configured
signer index range.

Key frontend files:

- `frontend/src/components/hero-section.tsx`
- `frontend/src/components/wallet-sidebar/connect-request-content.tsx`
- `frontend/src/components/wallet-workspace/app-wallet-workspace.tsx`
- `frontend/src/hooks/use-smart-account-sidebar-data.ts`

## CLI Split

The branch separates two CLIs:

- `cli/private-transfers-cli`: private-transfer CLI for
  `programs/telegram-private-transfer`, binary `loyal-private-transfers`.
- `cli/loyal-cli`: agent CLI for Squads smart-account vault automation,
  binary `loyal`.

`loyal` supports:

- `loyal auth`
- `loyal pubkey`
- `loyal show`
- `loyal propose raw <ENCODED_TRANSACTION>`
- `loyal propose transfer sol <RECIPIENT_ADDRESS> <AMOUNT>`
- `loyal propose transfer token <TOKEN_MINT_ADDRESS> <TOKEN_AMOUNT> <RECIPIENT_ADDRESS>`

`loyal auth` stores or reuses:

- agent signer keypair: `~/.config/loyal/id.json`
- CLI config: `~/.config/loyal/cli/config.yml`
- optional environment overrides such as `LOYAL_URL`, `LOYAL_RPC_URL`,
  `LOYAL_WS_URL`, `LOYAL_SETTINGS_PDA`, and `LOYAL_POLICY_PDA`

`loyal propose ...` creates a policy transaction and proposal directly on-chain
with the agent signer. On send failure, the CLI simulates the transaction,
prints the simulation result, up to 20 log lines, account diagnostics, and a
root-cause guess for common Solana failures.

## Validation Commands

For package and frontend changes in this area, use:

```bash
bun run --cwd packages/smart-account-vaults typecheck
bun run --cwd packages/smart-account-vaults build
bun test packages/smart-account-vaults/src/__tests__/spending-limits.test.ts
bun run --cwd sdk/loyal-smart-accounts test
bun run --cwd frontend lint
cargo check --manifest-path cli/loyal-cli/Cargo.toml
cargo test --manifest-path cli/loyal-cli/Cargo.toml
```

For protocol-sensitive docs changes, also inspect the Squads `policies` branch
semantics before changing recommendations around policies, sync execution, or
spending limits.
