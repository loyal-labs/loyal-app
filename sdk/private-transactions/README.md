# @loyal-labs/private-transactions

SDK for private SPL token deposits and transfers using [MagicBlock Private Ephemeral Rollups (PER)](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/introduction/authorization). This package wraps the `telegram-private-transfer` Anchor program and provides helpers for permissions, delegation, private transfers, claims, and undelegation.

## Installation

```bash
bun add @loyal-labs/private-transactions
# or
npm install @loyal-labs/private-transactions
```

### Peer Dependencies

```bash
bun add @coral-xyz/anchor @solana/web3.js @solana/spl-token @magicblock-labs/ephemeral-rollups-sdk
```

## Quick Start

```ts
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ER_VALIDATOR,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@loyal-labs/private-transactions";

const signer = Keypair.fromSecretKey(Uint8Array.from([...secretBytes]));
const tokenMint = new PublicKey("<mint>");

const client = await LoyalPrivateTransactionsClient.fromConfig({
  signer,
  baseRpcEndpoint: "https://api.devnet.solana.com",
  // Mainnet: https://mainnet-tee.magicblock.app
  // Devnet: https://tee.magicblock.app
  ephemeralRpcEndpoint: "https://mainnet-tee.magicblock.app",
  ephemeralWsEndpoint: "wss://mainnet-tee.magicblock.app",
  commitment: "confirmed",
});

// Shield: move tokens into private deposit in one base transaction
await client.shieldTokens({
  tokenMint,
  user: signer.publicKey,
  amount: 1_000_000,
  validator: ER_VALIDATOR,
});

// Private transfer (on PER) — destination username deposit must already exist and be delegated
await client.transferToUsernameDeposit({
  tokenMint,
  username: "alice_user",
  amount: 100_000,
  user: signer.publicKey,
  payer: signer.publicKey,
  sessionToken: null,
});

// Unshield: withdraw from private deposit in one base transaction
await client.unshieldTokens({
  tokenMint,
  user: signer.publicKey,
  amount: 1_000_000,
  sessionToken: null,
  magicProgram: MAGIC_PROGRAM_ID,
  magicContext: MAGIC_CONTEXT_ID,
});
```

## PER Authentication

For hosted PER endpoints (`tee.magicblock.app`, `mainnet-tee.magicblock.app`), the SDK acquires auth tokens automatically during `fromConfig`.

If you need explicit control, fetch the token externally and pass it through `authToken`:

```ts
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";

const authToken = await getAuthToken(
  "https://mainnet-tee.magicblock.app",
  wallet.publicKey,
  wallet.signMessage
);

const client = await LoyalPrivateTransactionsClient.fromConfig({
  signer: wallet,
  baseRpcEndpoint: "https://api.mainnet-beta.solana.com",
  ephemeralRpcEndpoint: "https://mainnet-tee.magicblock.app",
  ephemeralWsEndpoint: "wss://mainnet-tee.magicblock.app",
  authToken,
});
```

## API Overview

### Factory Method

- `fromConfig({ signer, baseRpcEndpoint, ephemeralRpcEndpoint, ... })`

### Shield / Unshield

- `shieldTokens` — one-transaction base shield flow, with optional pre-undelegate when the deposit is already delegated
- `unshieldTokens` — one-transaction base unshield flow, with optional pre-undelegate and automatic re-delegate when balance remains
- `buildShieldFlowTransactionPlan` — create the planned `shield` or `unshield` transactions and instruction metadata once
- `buildShieldTokensTransactionPlan` / `buildUnshieldTokensTransactionPlan` — explicit shield/unshield plan builders
- `estimateShieldFlowFee` — estimate transaction-level network fees plus instruction-attributed rent from an existing plan
- `estimateShieldTokensFee` / `estimateUnshieldTokensFee` — explicit shield/unshield estimators for an existing plan
- `executeShieldFlowTransactionPlan` — send the exact transactions from an existing plan in order
- `executeShieldTokensTransactionPlan` / `executeUnshieldTokensTransactionPlan` — explicit shield/unshield executors for an existing plan
- `initializeDeposit` — create deposit account (no-op if exists)
- `modifyBalance` — deposit (`increase: true`) or withdraw (`increase: false`) real tokens
- `createPermission` — set up PER access control (idempotent)
- `delegateDeposit` — delegate to TEE validator

Fee estimates use Solana's `getFeeForMessage` on the planned transaction
messages. Instruction rows report `rentLamports` for new accounts that the SDK
expects to create; network fees are not attributed per instruction because
Solana charges them at the transaction/message level. Build the plan once and
pass the same plan into the estimator so the estimate is tied to the exact
instructions your app is about to inspect or send. To execute that exact plan,
pass it to the matching `execute*TransactionPlan` method; it will send any
pre-undelegate transaction first, wait for the required owner transition when
the plan includes one, then send the base transaction.

```ts
const shieldPlan = await client.buildShieldTokensTransactionPlan({
  user: signer.publicKey,
  tokenMint,
  amount: 1_000_000,
});
const shieldEstimate = await client.estimateShieldTokensFee({
  plan: shieldPlan,
});

const unshieldPlan = await client.buildUnshieldTokensTransactionPlan({
  user: signer.publicKey,
  tokenMint,
  amount: 1_000_000,
});
const unshieldEstimate = await client.estimateUnshieldTokensFee({
  plan: unshieldPlan,
});

console.log(shieldEstimate.totalLamports);
console.log(unshieldEstimate.totalLamports);

const shieldResult = await client.executeShieldTokensTransactionPlan({
  plan: shieldPlan,
});

const unshieldResult = await client.executeUnshieldTokensTransactionPlan({
  plan: unshieldPlan,
});

console.log(shieldResult.signatures);
console.log(unshieldResult.signatures);
```

### Private Transfers (on PER)

- `transferDeposit` — transfer between user deposits
- `transferToUsernameDeposit` — transfer to username deposit
- `claimUsernameDepositToDeposit` — claim from username deposit with verified Telegram session

### Username Deposits

- `initializeUsernameDeposit` — create username deposit account
- `createUsernamePermission` — PER access control for username deposit
- `delegateUsernameDeposit` — delegate username deposit to PER
- `undelegateUsernameDeposit` — commit and undelegate username deposit

### Commit / Undelegate

- `undelegateDeposit` — commit PER state, return deposit to base layer
- `undelegateUsernameDeposit`

### Queries

- `getBaseDeposit` / `getEphemeralDeposit`
- `getBaseUsernameDeposit` / `getEphemeralUsernameDeposit`

### Accessors

- `publicKey`
- `getBaseProgram()`
- `getEphemeralProgram()`
- `getProgramId()`

### PDA Helpers

- `findDepositPda`
- `findUsernameDepositPda`
- `findVaultPda`
- `findPermissionPda`
- `findDelegationRecordPda`
- `findDelegationMetadataPda`
- `findBufferPda`

## Development

```bash
bun install
bun run typecheck
bun test --timeout 60000
```
