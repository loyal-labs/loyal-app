# Kamino Lending Agent Policy Flow

This document covers an older operator-script flow and the target Agent
auto-yield product shape. The design keeps the user as the root `Settings`
owner, requires only the Agent policy signer for recurring deposits, and gates
execution so the vault USDC balance must stay above `500 USDC`. The policy may
call only Kamino Lending and only supported KLend deposit instructions.

## Current State

The current Loyal web Earn UI is already wired for user-initiated Kamino USDC
deposits and partial/full withdrawals. That flow uses vault `accountIndex = 1`,
the canonical Kamino USDC reserve, `packages/smart-account-vaults`, and the
`/api/smart-accounts/yield-optimization/*` routes documented in
`smart-accounts-api-and-frontend.md`.

The flow below is separate. It describes an Agent-managed auto-yield design that
keeps excess USDC above a threshold in a vault and is not the same as the
current user-initiated Earn UI.

Implemented today: `scripts/create-kamino-lending-policy.ts` builds a
`ProgramInteraction` policy creation settings transaction, creates the proposal,
and can optionally approve and execute it.
`scripts/propose-smart-account-transaction.ts` can submit later Agent-owned
transactions through `--policy-pda`, including Kamino KTX responses or generic
instruction JSON. The frontend provisions root smart accounts and exposes
generic smart-account overview, approvals, policy signer updates,
spending-limit policy creation, supported policy execution flows, and Kamino
read-side helpers for portfolio/APY/shield balances.

This Agent auto-yield design still needs a frontend "enable auto-yield" action,
persisted/indexed storage for the resulting Kamino `policyPda`, and a runtime
Agent worker that computes `balance - 500 USDC`, fetches Kamino deposit
instructions, and executes them through this policy.

## Policy Model

Use a `ProgramInteraction` policy on the user's canonical vault:

| Field            | Value                               |
| ---------------- | ----------------------------------- |
| Parent           | User `Settings` PDA                 |
| Target vault     | `accountIndex = 0`                  |
| Policy signer    | Agent public key                    |
| Threshold        | `1`                                 |
| Permissions mask | `7` (`Initiate \| Vote \| Execute`) |
| Time lock        | `0`                                 |

The current Loyal generated SDK has the older explicit-pubkey `ProgramInteraction` creation payload. On the current Squads `policies` branch this serializes as the legacy program-interaction payload, which the program still supports. When the local SDK is regenerated from the latest branch, prefer the newer compiled `ProgramInteraction` payload with `pubkeyTable`.

## Constraints

The policy creation script builds one instruction constraint:

| Constraint                 | Value                                                                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program id                 | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`                                                                                                                                                                                     |
| Supported discriminator    | `depositReserveLiquidity` (`a9c91e7e06cd6644`), `depositReserveLiquidityAndObligationCollateral` (`81c70402de271a2e`), or `depositReserveLiquidityAndObligationCollateralV2` (`d8e0bf1bcc9766af`) at instruction data offset `0`. |
| Accounts                   | Every account in the provided Kamino template instruction is pinned by exact pubkey.                                                                                                                                              |
| Source vault token account | Mint at token-account offset `0` equals USDC mint, owner at offset `32` equals the vault PDA, and amount at offset `64` is `DataOperator.GreaterThan 500_000_000`.                                                                |

This gates execution on the vault source ATA having more than 500 USDC before the Kamino deposit. The future worker/backend should still compute the dynamic deposit amount, usually `balance - 500 USDC`.

## Operator Scripts

Build or fetch a Kamino KTX deposit-instructions JSON using the vault PDA as `wallet`.

```bash
curl --request POST \
  --url https://api.kamino.finance/ktx/klend/deposit-instructions \
  --header 'Content-Type: application/json' \
  --data '{
    "wallet": "<VAULT_PDA>",
    "market": "<KAMINO_MARKET>",
    "reserve": "<USDC_RESERVE>",
    "amount": "0.01"
  }' > kamino-usdc-deposit-template.json
```

Create the policy settings transaction, then approve and execute it:

```bash
bun run smart-accounts:create-kamino-policy \
  --settings-pda <SETTINGS_PDA> \
  --agent <AGENT_PUBKEY> \
  --template-instructions-file kamino-usdc-deposit-template.json \
  --keypair <USER_SETTINGS_SIGNER>.json \
  --fee-payer-keypair <SPONSOR>.json \
  --rpc-url https://api.mainnet-beta.solana.com \
  --program-id SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG \
  --approve \
  --execute
```

Run an Agent-controlled Kamino deposit later. If the file is a full Kamino KTX
bundle, select only the final deposit instruction; do not submit setup
instructions through the deposit-only policy.

```bash
bun run smart-accounts:propose \
  --policy-pda <POLICY_PDA> \
  --vault-index 0 \
  --instructions-file kamino-usdc-deposit-instructions.json \
  --instruction-index <DEPOSIT_INSTRUCTION_INDEX> \
  --keypair <AGENT>.json \
  --rpc-url https://api.mainnet-beta.solana.com \
  --program-id SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG \
  --approve \
  --execute
```

The custom instruction file can be a Kamino KTX response with `instructions` and `lutsByAddress`, or a generic JSON object with `instructions: [{ programId, data, keys }]`.

## Target Frontend Integration

This Agent auto-yield flow is not wired into the frontend yet. The current
frontend pieces are the generic smart-account flows listed below; the
Kamino-specific opt-in should reuse those package APIs instead of adding direct
Squads plumbing to the UI.

For new users, keep `frontend/src/features/smart-accounts/server/onchain.ts`
creating the root smart account as it does today: `settingsAuthority: null`,
`threshold: 1`, one user signer in `signers`, and sponsor-paid creation.

After the account is ready, add an opt-in policy creation step. This cannot be done only by the sponsor, because `PolicyCreate` is a settings action and the user is the settings signer. The frontend should prepare a sponsored settings transaction, ask the user's wallet to sign as `creator/signer`, and have the sponsor sign as fee payer/rent payer.

For existing users, expose the same flow behind an "enable auto-yield" action.
Derive `settingsPda` and vault `0`, fetch a Kamino deposit-instructions
template for `wallet = vaultPda`, build the `PolicyCreate` settings action with
the same constraints as `scripts/create-kamino-lending-policy.ts`, create and
execute the proposal with user wallet signature plus sponsor fee-payer
signature, then store or index the resulting `policyPda` for the Agent worker.

Do not add the Agent as a root `Settings` signer. The Agent should only appear in `Policy.signers[]`.

Existing generic frontend smart-account plumbing already supports the pieces
this flow would reuse. `frontend/src/features/smart-accounts/server/read-model.ts`
loads `SmartAccountOverview` through `packages/smart-account-vaults`.
`/api/smart-accounts/overview` returns the overview without eager activity
scans, while `/api/smart-accounts/vault-activity` loads selected-vault activity.
`frontend/src/hooks/use-smart-account-sidebar-data.ts` prepares proposal
execution, signer updates, and spending-limit actions with
`createSmartAccountVaultsClient`.

Connect requests from `loyal auth` arrive as `?connect=<agentPubkey>` and are
approved by calling `prepareAddInitiateSigner`, which updates a `SpendingLimit`
policy signer set with `PolicyUpdate`. Spending-limit amount edits call
`prepareSetSpendingLimitPolicy`. Existing policies must stay update-in-place so
mint, destinations, period/usage state, and time-lock semantics are preserved.
Agent top-ups call `prepareUseSolSpendingLimitPolicy`, which prepares synchronous
`executePolicyPayloadSync`; the signing wallet must be a valid policy signer.
Stored policy proposals can be executed from the UI through
`prepareExecutePolicyProposal` when the payload is a supported `SpendingLimit`
or async `ProgramInteraction` payload.

## Target Runtime Worker

The Agent worker should derive vault `0` and the vault USDC ATA, read the token
balance, skip balances `<= 500_000_000`, request Kamino KTX deposit
instructions for `amount = balance - 500_000_000`, select the supported KLend
deposit instruction from the KTX bundle, and submit that instruction through the
policy path with the Agent key.

If Kamino returns setup instructions that require extra non-vault signers, pre-create those accounts outside the policy path. The policy should stay deposit-only.
