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
  `Settings` root. Multiple policies are parallel authorities. A transaction is
  governed by the consensus account it uses; policies do not automatically stack
  on every transaction.
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

| Feature          | Operations                                                            |
| ---------------- | --------------------------------------------------------------------- |
| `programConfig`  | initialize and authority/treasury/creation-fee updates                |
| `smartAccounts`  | create account, direct authority updates, settings transactions       |
| `proposals`      | create, activate, approve, reject, cancel                             |
| `transactions`   | create/close transactions, buffers, and `logEvent`                    |
| `batches`        | create, add transaction, close, execute batch transaction             |
| `policies`       | create and close policy transactions                                  |
| `spendingLimits` | legacy add/remove/use spending-limit instructions                     |
| `execution`      | async execution, sync execution, settings execution, policy execution |

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

| Field               | Meaning                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `accounts`          | Generated account classes.                                       |
| `instructions`      | Raw instruction builders for offline operations when exposed.    |
| `prepare`           | Unbound prepared-operation builders.                             |
| `queries`           | Account fetchers.                                                |
| `client(transport)` | Bound `prepare`, bound `queries`, and send-ready client methods. |

The high-level client returns the same feature clients plus a generic
`client.send(prepared, { signers, confirm, sendOptions })`.

### `packages/smart-account-vaults`

This package is the frontend-facing adapter. It should be the default place for
vault UI and policy workflow code that needs to be shared between frontend
surfaces.

Main exports:

| Group                  | Exports                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client                 | `createSmartAccountVaultsClient(config)`                                                                                                                       |
| Message helpers        | `createVaultSolTransferMessage`, `createVaultSplTransferMessage`, `createVaultCustomInstructionMessage`, `isSupportedTokenProgram`, `resolveVaultAccountIndex` |
| Spending-limit helpers | `SOL_SPENDING_LIMIT_MINT`, period/reset helpers, formatting helpers, and token amount helpers                                                                  |
| Wallet helpers         | `sendPreparedWithWallet`, `isWalletAdapterLike`                                                                                                                |
| Types                  | Read-model and action input types                                                                                                                              |

Client reads include `fetchVault`, `listVaults`,
`listSpendingLimitPolicies`, `listSpendingLimits`, `listProposals`, and
`fetchOverview`.

Prepared operations include SOL/SPL/custom transfer proposals, policy custom
instruction proposals, initiate signer add/remove, spending-limit policy
set/remove/use, approval/rejection, and transaction/settings/policy execution.

Important behavior: `fetchOverview` joins settings, vault
balances/portfolio/activity, policy signers, spending-limit policies, and
proposals into one UI payload. Standard vault proposals create a transaction
account and proposal account in one prepared operation. Policy custom proposals
use the policy PDA as the consensus account and wrap the transaction message in
a `PolicyPayload`.

Settings changes use synchronous settings execution when the root threshold is
`<= 1`; otherwise they create a settings transaction and proposal, then approve
it. Spending-limit edits use `PolicyUpdate` for existing policies and preserve
the fetched policy's mint, destinations, period, accumulation, exact-quantity
setting, and usage state. Threshold and time-lock fields are also preserved
unless the caller explicitly overrides them. SOL top-ups through a
spending-limit policy use `executePolicyPayloadSync`; a valid policy signer can
sign them.

## Frontend Usage

### Provisioning

The frontend service provisions one canonical smart account for an authenticated
wallet. It fetches the Squads program config to reserve the next settings index,
stores a pending DB record keyed by user and Solana environment, creates the
smart account through a sponsor path, and reconciles pending or failed records
by checking whether the wallet is already a signer on the on-chain settings
account.

Key files are `frontend/src/features/smart-accounts/service.ts`,
`frontend/src/features/smart-accounts/server/provisioner.ts`,
`frontend/src/features/smart-accounts/server/onchain.ts`, and
`frontend/src/features/smart-accounts/server/repository.ts`.

### Read Model Routes

The UI does not fetch Squads accounts directly from React for overview data.
Server routes create a `SmartAccountVaultsClient` with the configured RPC,
program id, and wallet data client:

- `GET /api/smart-accounts/overview` returns `SmartAccountOverview`.
- `GET /api/smart-accounts/vault-activity?accountIndex=<n>` returns a paged
  activity payload for one vault.

The read model has short cooldowns for RPC rate limits and retry/backoff for a
newly created settings account that has not propagated yet.

Key files are `frontend/src/app/api/smart-accounts/overview/route.ts`,
`frontend/src/app/api/smart-accounts/vault-activity/route.ts`, and
`frontend/src/features/smart-accounts/server/read-model.ts`.

### React Hook and Wallet Actions

`frontend/src/hooks/use-smart-account-sidebar-data.ts` is the main browser
adapter. It fetches the server overview and vault activity routes, maps vaults
and related account state into sidebar view models, prepares proposal actions
with `createSmartAccountVaultsClient`, and sends prepared operations through
`sendPreparedWithWallet`.

Execution helpers are selected by payload type: `settings_transaction` uses
`prepareExecuteSettingsProposal`, `policy_transaction` uses
`prepareExecutePolicyProposal`, and `transaction` uses `prepareExecuteProposal`.
The hook also normalizes wallet/Solana logs for spending-limit errors,
including insufficient vault SOL, insufficient fee-payer SOL, exceeded spending
limits, and policy reallocation failures.

### Earn Flow

The Loyal web Earn flow is user-initiated. It uses smart-account vault
`accountIndex = 1` and the canonical Kamino USDC target, while reconciliation
and withdrawals account for holdings in policy-approved Kamino markets.

Instruction building stays in `packages/smart-account-vaults`.
`prepareEarnUsdcDeposit` builds the user wallet transfer into the vault plus the
Kamino deposit executed through the Earn `ProgramInteraction` policy. The first
deposit creates the Earn yield-routing policy. Top-up deposits reuse the
existing policy by passing `initializeYieldRoutingPolicy: false`.
`prepareEarnUsdcWithdraw` resolves sources from the live RPC holdings snapshot.
Partial withdrawals select one idle or Kamino source. Full withdrawals sum all
positive sources and pass every positive Kamino holding to the SDK, so one exit
can unwind multiple approved markets. Full withdrawals leave policy closure to
the separate cleanup phase.

The browser hook sends the prepared transaction and then posts the confirmed
signature metadata to `POST
/api/smart-accounts/yield-optimization/deposits/confirm` or `POST
/api/smart-accounts/yield-optimization/withdrawals/confirm`.

Those confirmation routes validate the authenticated wallet/session, the
configured cluster from `NEXT_PUBLIC_SOLANA_ENV`, canonical policy/vault/mint
metadata, confirmed signature status, and confirmed slot before writing Yield
Neon state. A full withdrawal does not close policies in this step. When it is
the final step, the route verifies live holdings at or after the withdrawal slot
and returns `policy_close_required` only when Kamino holdings and idle USDC pass
the zero-balance/dust proof; otherwise it returns an incomplete or retryable
verification result.

The browser then prepares `POST
/api/smart-accounts/yield-optimization/withdrawals/cleanup/prepare` and submits
the wallet-signed cleanup to `POST
/api/smart-accounts/yield-optimization/withdrawals/cleanup/confirm`. Cleanup
re-proves zero balances and policy closure before finalizing the full exit; when
Autodeposit is active, its close transaction is confirmed as part of this flow.

Mobile clients prepare Earn instructions on-device. After mobile-wallet
authentication, `POST
/api/smart-accounts/mobile/earn/deposit/prepare-context` and `POST
/api/smart-accounts/mobile/earn/withdraw/prepare-context` return the resolved
smart-account, deployment, policy, reserve, and withdrawal inputs that the
device uses with `prepareEarnUsdcDeposit` or `prepareEarnUsdcWithdraw`, including
all live full-withdrawal targets. Mobile full exits use the same separate cleanup
and zero-proof phases; the legacy mobile `prepare` routes remain available for
app versions that predate on-device preparation.

The frontend reads active Earn state from `GET
/api/smart-accounts/yield-optimization/position`. That route returns the active aggregate row from
`loyal_yield.user_yield_positions` for the authenticated wallet, configured
cluster (`devnet` or `mainnet-beta`), vault index `1`, and canonical target
reserve. The reconciliation path also discovers positive USDC obligations in
every safe Kamino market allowed by the active route policy, rather than
depending only on reserves already recorded in the database. `AppWalletWorkspace`
uses the position response to decide whether to show the active Earn view,
display the current principal, and set the withdrawal maximum.

| Area                     | Key file                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Workspace state          | `frontend/src/components/wallet-workspace/app-wallet-workspace.tsx`                   |
| Earn detail UI           | `frontend/src/components/wallet-sidebar/earn-detail-view.tsx`                         |
| Browser action adapter   | `frontend/src/hooks/use-smart-account-sidebar-data.ts`                                |
| Active position route    | `frontend/src/app/api/smart-accounts/yield-optimization/position/route.ts`            |
| Deposit confirm route    | `frontend/src/app/api/smart-accounts/yield-optimization/deposits/confirm/route.ts`    |
| Withdrawal confirm route | `frontend/src/app/api/smart-accounts/yield-optimization/withdrawals/confirm/route.ts` |
| Withdrawal cleanup prepare | `frontend/src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/prepare/route.ts` |
| Withdrawal cleanup confirm | `frontend/src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/confirm/route.ts` |
| Mobile deposit context   | `frontend/src/app/api/smart-accounts/mobile/earn/deposit/prepare-context/route.ts`    |
| Mobile withdrawal context | `frontend/src/app/api/smart-accounts/mobile/earn/withdraw/prepare-context/route.ts`  |
| Mobile cleanup context   | `frontend/src/app/api/smart-accounts/mobile/earn/withdraw/cleanup/prepare-context/route.ts` |
| Mobile cleanup confirm   | `frontend/src/app/api/smart-accounts/mobile/earn/withdraw/cleanup/confirm/route.ts` |
| Yield repository         | `frontend/src/lib/yield-optimization/yield-deposit-repository.server.ts`              |
| Instruction builder      | `packages/smart-account-vaults/src/client.ts`                                         |

### CLI Agent Connect Flow

`cli/loyal-cli` opens the frontend with `?connect=<CLI_PUBLIC_KEY>` during
`loyal auth`. The frontend detects that query parameter, opens the connection
request view, and calls `addInitiateSigner`.

That action attaches the CLI key as an `Initiate` signer on an existing
spending-limit policy. The CLI then detects the policy connection by scanning or
subscribing to policy accounts where its public key appears in the configured
signer index range.

Key frontend files are `frontend/src/components/hero-section.tsx`,
`frontend/src/components/wallet-sidebar/connect-request-content.tsx`,
`frontend/src/components/wallet-workspace/app-wallet-workspace.tsx`, and
`frontend/src/hooks/use-smart-account-sidebar-data.ts`.

## CLI Split

The branch separates `cli/private-transfers-cli`, whose binary is
`loyal-private-transfers`, from `cli/loyal-cli`, whose binary is `loyal`.
`loyal-private-transfers` targets `programs/telegram-private-transfer`; `loyal`
targets Squads smart-account vault automation.

`loyal` supports `auth`, `pubkey`, `show`, `propose raw
<ENCODED_TRANSACTION>`, `propose transfer sol <RECIPIENT_ADDRESS> <AMOUNT>`,
and `propose transfer token <TOKEN_MINT_ADDRESS> <TOKEN_AMOUNT>
<RECIPIENT_ADDRESS>`.

`loyal auth` stores or reuses the agent signer keypair at
`~/.config/loyal/id.json`, CLI config at `~/.config/loyal/cli/config.yml`, and
optional environment overrides such as `LOYAL_URL`, `LOYAL_RPC_URL`,
`LOYAL_WS_URL`, `LOYAL_SETTINGS_PDA`, and `LOYAL_POLICY_PDA`.

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
