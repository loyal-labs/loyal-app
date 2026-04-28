# @loyal-labs/smart-account-vaults

High-level read/write helpers for Loyal's Squads-derived smart-account vault flow.

This package is a convenience layer over:

- `@loyal-labs/loyal-smart-accounts`
- `@loyal-labs/loyal-smart-accounts-core`
- `@loyal-labs/solana-wallet`

It is intended for app-facing vault, proposal, and approval/execution flows rather than full protocol access.

## What It Exposes

The package root re-exports everything from:

- `src/client.ts`
- `src/messages.ts`
- `src/types.ts`
- `src/wallet.ts`

### Main factory

`createSmartAccountVaultsClient(config)`

Creates a client bound to a Solana `connection`, an optional smart-account `programId`, and an optional `walletDataClient`.

Returned client shape:

- `connection`
- `programId`
- `sdk`
- `fetchVault(args)`
- `listVaults(args)`
- `listProposals(args)`
- `fetchOverview(args)`
- `prepareSolTransferProposal(args)`
- `prepareSplTransferProposal(args)`
- `prepareCustomInstructionProposal(args)`
- `preparePolicyCustomInstructionProposal(args)`
- `prepareAddInitiateSigner(args)`
- `prepareRemoveInitiateSigner(args)`
- `prepareSetSpendingLimitPolicy(args)`
- `prepareRemoveSpendingLimitPolicy(args)`
- `prepareUseSolSpendingLimitPolicy(args)`
- `prepareApproveProposal(args)`
- `prepareRejectProposal(args)`
- `prepareExecuteProposal(args)`
- `prepareExecuteSettingsProposal(args)`

Notes:

- `sdk` is the underlying Loyal smart-accounts client. This package is a wrapper, not a replacement for the lower-level SDK.
- `listPolicies()` exists internally but is not returned as part of the public client surface.

### Message helpers

- `createVaultSolTransferMessage(args)`
- `createVaultSplTransferMessage(args)`
- `createVaultCustomInstructionMessage(args)`
- `isSupportedTokenProgram(programId)`
- `resolveVaultAccountIndex(accountIndex)`

These build `TransactionMessage` payloads where the vault PDA is the payer/executor account.

### Wallet helpers

- `sendPreparedWithWallet(args)`
- `isWalletAdapterLike(value)`

`sendPreparedWithWallet()` compiles a prepared operation to a versioned transaction, signs/sends with a wallet adapter, and optionally confirms it.

### Exported types

Read-model types:

- `SmartAccountOverview`
- `SmartAccountVaultSnapshot`
- `SmartAccountProposalSnapshot`
- `SmartAccountProposalSummary`
- `SmartAccountPolicySnapshot`
- `SmartAccountSignerSnapshot`

Proposal/input types:

- `SmartAccountTransferProposalInput`
- `SmartAccountTokenTransferProposalInput`
- `SmartAccountCustomInstructionProposalInput`
- `SmartAccountPolicyCustomInstructionProposalInput`

Adapter/config types:

- `SmartAccountVaultsClientConfig`
- `WalletAdapterLike`
- `SendPreparedWithWalletArgs`

Status/enum-like types:

- `SmartAccountProposalStatus`
- `SmartAccountProposalPayloadType`
- `SmartAccountProposalSummaryKind`
- `SmartAccountSignerPermission`
- `SmartAccountSignerScope`

## How It Works

### 1. Underlying SDK

`createSmartAccountVaultsClient()` constructs a lower-level client with `createLoyalSmartAccountsClient(...)` and fixes the default commitment to `confirmed`.

This package does not implement the protocol itself. It delegates PDA derivation, account decoding, prepared operation building, and execution helpers to the Loyal smart-accounts SDK.

### 2. Vault reads

`fetchVault()`:

1. Resolves `accountIndex` with a default of `0`.
2. Derives the vault PDA from `settingsPda + accountIndex`.
3. Fetches:
   - lamports from RPC
   - portfolio from `walletDataClient.getPortfolio(...)`
   - activity from `walletDataClient.getActivity(...)`
4. Returns a normalized `SmartAccountVaultSnapshot`.

`listVaults()`:

1. Loads smart-account settings unless `accountUtilization` is supplied.
2. Expands vault indexes from `0..accountUtilization`.
3. Calls `fetchVault()` for each vault.

### 3. Policy and proposal reads

`listProposals()` scans on-chain program accounts using `getProgramAccounts(...)` with discriminator-based memcmp filters for:

- proposals
- transactions
- settings transactions
- policies

It then joins those accounts by consensus PDA and transaction index.

For summaries, it understands:

- native SOL transfers
- SPL `transferChecked` transfers
- settings transactions

Anything else is represented as `unknown`, with the program id surfaced when possible.

`fetchOverview()` combines:

- root settings
- vaults
- policy signers
- proposals

into a single `SmartAccountOverview` payload that is suitable for sidebar/read-model style UI use.

### 4. Proposal creation

For standard vault-originated proposals:

- `prepareSolTransferProposal()`
- `prepareSplTransferProposal()`
- `prepareCustomInstructionProposal()`

the flow is:

1. Load current settings.
2. Compute `transactionIndex = current + 1`.
3. Derive the target vault PDA.
4. Build a `TransactionMessage`.
5. Prepare the transaction account creation.
6. Prepare the proposal account creation.
7. Merge both prepared operations into one frozen prepared operation.

For policy-based custom proposals:

- `preparePolicyCustomInstructionProposal()`

the package:

1. Loads the policy account.
2. Uses the policy PDA as the consensus account.
3. Serializes the transaction message into multisig/smart-account transaction bytes.
4. Wraps the payload in a generated `PolicyPayload`.
5. Prepares the policy transaction and proposal creation operations.

### 5. Voting and execution

- `prepareApproveProposal()` wraps proposal approval.
- `prepareRejectProposal()` wraps proposal rejection.
- `prepareExecuteProposal()` executes a regular stored transaction.
- `prepareExecuteSettingsProposal()` first derives any extra execution accounts required by settings actions, then prepares the settings-transaction execution.

The send step is intentionally separate. Typical usage is:

1. Prepare an operation with the client.
2. Send it with `sendPreparedWithWallet(...)`.

## Relationship To Squads

This package follows Squads-style smart-account concepts:

- a root config account controls membership, threshold, and timelock
- vaults hold assets
- transactions are proposed and then voted on
- approved transactions are executed from vault PDAs
- policy and spending-limit mechanisms extend the base flow

The important local detail is that Loyal is not depending directly on Squads' unpublished package. The local SDK is pinned to an upstream snapshot of the newer Squads smart-account program:

- upstream repo: `https://github.com/Squads-Protocol/smart-account-program`
- pinned commit in this monorepo: `80bf1f7ad28fd1176c364879776982730b8e9c80`
- fetched on: `2026-03-20`
- local manifest: `sdk/loyal-smart-accounts/upstream/manifest.json`
- pinned program id there: `SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG`

That means this package sits conceptually between:

- the public Squads v4 multisig/vault/proposal model
- the newer Squads Smart Account Program and hosted developer API

## Relevant Squads Context

As of April 23, 2026, the official Squads materials split across two tracks:

- Squads v4 multisig docs:
  - `https://docs.squads.so/main/development/typescript/overview`
  - `https://docs.squads.so/main/development/reference/accounts`
- newer Smart Account API / Smart Account Program docs:
  - `https://developers.squads.so/squads-api/introduction`
  - `https://developers.squads.so/squads-api/api-reference/v1/policies`
  - `https://github.com/Squads-Protocol/smart-account-program`

Useful mappings:

- Squads "multisig" config account maps to this package's root smart-account settings flow.
- Squads vaults/sub-accounts map to this package's `accountIndex`-selected vault PDAs.
- Squads proposal approval/execution maps to this package's `prepareApproveProposal()`, `prepareRejectProposal()`, and execute helpers.
- Squads permission concepts map closely to:
  - `initiate`
  - `vote`
  - `execute`

## Known Limitations And Gotchas

- `walletDataClient` is optional in the config type, but `fetchVault()`, `listVaults()`, and `fetchOverview()` require it at runtime.
- Proposal creation uses `current transaction index + 1`, so concurrent proposers can race and produce stale prepared operations.
- Proposal summaries are intentionally lossy. Only common transfer/settings payloads are decoded into first-class summaries.
- There is no first-class `prepareExecutePolicyProposal()` helper in this wrapper. Some policy execution flows still require dropping to `client.sdk`.
- This package currently has no package-local tests or examples.

## Where It Is Used In This Repo

- `frontend/src/features/smart-accounts/server/read-model.ts`
- `frontend/src/hooks/use-smart-account-sidebar-data.ts`
- `scripts/propose-smart-account-transaction.ts`

Those consumers use this package as a read-model and wallet-action adapter on top of the lower-level Loyal smart-accounts SDK.
