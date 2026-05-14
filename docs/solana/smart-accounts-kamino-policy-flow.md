# Kamino Lending Agent Policy Flow

This document covers the current operator-script flow and the target product
integration shape for:

- vault USDC balance must be greater than `500 USDC`
- only Kamino Lending may be called
- only a supported KLend deposit instruction may be called
- only the Agent policy signer is needed for recurring deposits
- the user remains the root `Settings` owner

## Current State

Implemented today:

- `scripts/create-kamino-lending-policy.ts` builds a `ProgramInteraction`
  policy creation settings transaction, creates the proposal, and can optionally
  approve and execute it.
- `scripts/propose-smart-account-transaction.ts` can submit later Agent-owned
  transactions through `--policy-pda`, including Kamino KTX responses or generic
  instruction JSON.
- The frontend provisions root smart accounts and exposes generic smart-account
  overview, approvals, policy signer updates, spending-limit policy creation,
  and supported policy execution flows.
- The frontend has Kamino read-side helpers for portfolio/APY/shield balances.

Not implemented yet:

- A frontend "enable auto-yield" action that creates this Kamino policy.
- Persisted/indexed storage for the resulting Kamino `policyPda`.
- A runtime Agent worker that periodically computes `balance - 500 USDC`,
  fetches Kamino deposit instructions, and executes them through this policy.

## Policy Model

Use a `ProgramInteraction` policy on the user's canonical vault:

- parent: user `Settings` PDA
- target vault: `accountIndex = 0`
- policy signer: Agent public key
- policy threshold: `1`
- policy permissions mask: `7` (`Initiate | Vote | Execute`)
- policy time lock: `0`

The current Loyal generated SDK has the older explicit-pubkey `ProgramInteraction` creation payload. On the current Squads `policies` branch this serializes as the legacy program-interaction payload, which the program still supports. When the local SDK is regenerated from the latest branch, prefer the newer compiled `ProgramInteraction` payload with `pubkeyTable`.

## Constraints

The policy creation script builds one instruction constraint:

- `programId = KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
- instruction data offset `0` equals one supported KLend deposit discriminator:
  - `depositReserveLiquidity`: `a9c91e7e06cd6644`
  - `depositReserveLiquidityAndObligationCollateral`: `81c70402de271a2e`
  - `depositReserveLiquidityAndObligationCollateralV2`: `d8e0bf1bcc9766af`
- every account in the provided Kamino template instruction is pinned by exact pubkey
- the source vault USDC token account also has account-data checks:
  - mint at token-account offset `0` equals USDC mint
  - owner at offset `32` equals the vault PDA
  - amount at offset `64` is `DataOperator.GreaterThan 500_000_000`

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

Create, approve, and execute the policy settings transaction:

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

This flow is not wired into the frontend yet. The current frontend pieces are
the generic smart-account flows listed below; the Kamino-specific opt-in should
reuse those package APIs instead of adding direct Squads plumbing to the UI.

For new users, keep `frontend/src/features/smart-accounts/server/onchain.ts` creating the root smart account as it does today:

- `settingsAuthority: null`
- `threshold: 1`
- one user signer in `signers`
- sponsor pays creation

After the account is ready, add an opt-in policy creation step. This cannot be done only by the sponsor, because `PolicyCreate` is a settings action and the user is the settings signer. The frontend should prepare a sponsored settings transaction, ask the user's wallet to sign as `creator/signer`, and have the sponsor sign as fee payer/rent payer.

For existing users, expose the same flow behind an "enable auto-yield" action:

1. derive `settingsPda` and vault `0`
2. fetch a Kamino deposit-instructions template for `wallet = vaultPda`
3. build the `PolicyCreate` settings action with the same constraints as `scripts/create-kamino-lending-policy.ts`
4. create proposal, approve, and execute with user wallet signature plus sponsor fee-payer signature
5. store or index the resulting `policyPda` for the Agent worker

Do not add the Agent as a root `Settings` signer. The Agent should only appear in `Policy.signers[]`.

Existing generic frontend smart-account plumbing:

- `frontend/src/features/smart-accounts/server/read-model.ts` loads
  `SmartAccountOverview` through `packages/smart-account-vaults`.
- `/api/smart-accounts/overview` returns the overview without eager activity
  scans; `/api/smart-accounts/vault-activity` loads selected-vault activity.
- `frontend/src/hooks/use-smart-account-sidebar-data.ts` prepares approval,
  execution, signer, and spending-limit actions with
  `createSmartAccountVaultsClient`.
- Connect requests from `loyal auth` arrive as `?connect=<agentPubkey>` and are
  approved by calling `prepareAddInitiateSigner`, which updates a
  `SpendingLimit` policy signer set with `PolicyUpdate`.
- Spending-limit amount edits call `prepareSetSpendingLimitPolicy`. Existing
  policies must stay update-in-place so mint, destinations, period, usage, and
  time-lock semantics are preserved.
- Agent top-ups call `prepareUseSolSpendingLimitPolicy`, which prepares
  synchronous `executePolicyPayloadSync`; the signing wallet must be a valid
  policy signer, not necessarily the authenticated root settings signer.
- Stored policy proposals can be executed from the UI through
  `prepareExecutePolicyProposal` when the payload is a supported
  `SpendingLimit` or async `ProgramInteraction` payload.

## Target Runtime Worker

The Agent worker should:

1. derive vault `0` and the vault USDC ATA
2. read the token balance
3. skip if balance is `<= 500_000_000`
4. request Kamino KTX deposit instructions for `amount = balance - 500_000_000`
5. select the supported KLend deposit instruction from the KTX bundle
6. submit that instruction through the policy path with the Agent key

If Kamino returns setup instructions that require extra non-vault signers, pre-create those accounts outside the policy path. The policy should stay deposit-only.
