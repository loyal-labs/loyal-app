# Kamino Lending Agent Policy Flow

This is the practical implementation shape for:

- vault USDC balance must be greater than `500 USDC`
- only Kamino Lending may be called
- only a supported KLend deposit instruction may be called
- only the Agent policy signer is needed for recurring deposits
- the user remains the root `Settings` owner

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

This gates execution on the vault source ATA having more than 500 USDC before the Kamino deposit. The backend still computes the dynamic deposit amount, usually `balance - 500 USDC`.

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

## Frontend Changes

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

## Runtime Worker

The Agent worker should:

1. derive vault `0` and the vault USDC ATA
2. read the token balance
3. skip if balance is `<= 500_000_000`
4. request Kamino KTX deposit instructions for `amount = balance - 500_000_000`
5. select the supported KLend deposit instruction from the KTX bundle
6. submit that instruction through the policy path with the Agent key

If Kamino returns setup instructions that require extra non-vault signers, pre-create those accounts outside the policy path. The policy should stay deposit-only.
