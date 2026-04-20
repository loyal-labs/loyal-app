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

// Shield: move tokens into private deposit
await client.initializeDeposit({
  tokenMint,
  user: signer.publicKey,
  payer: signer.publicKey,
});

await client.modifyBalance({
  tokenMint,
  user: signer.publicKey,
  payer: signer.publicKey,
  amount: 1_000_000,
  increase: true,
});

await client.createPermission({
  tokenMint,
  user: signer.publicKey,
  payer: signer.publicKey,
});

await client.delegateDeposit({
  tokenMint,
  user: signer.publicKey,
  payer: signer.publicKey,
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

// Unshield: commit PER state and withdraw tokens
await client.undelegateDeposit({
  tokenMint,
  user: signer.publicKey,
  payer: signer.publicKey,
  sessionToken: null,
  magicProgram: MAGIC_PROGRAM_ID,
  magicContext: MAGIC_CONTEXT_ID,
});

await client.modifyBalance({
  tokenMint,
  user: signer.publicKey,
  payer: signer.publicKey,
  amount: 1_000_000,
  increase: false,
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

- `initializeDeposit` — create deposit account (no-op if exists)
- `modifyBalance` — deposit (`increase: true`) or withdraw (`increase: false`) real tokens
- `createPermission` — set up PER access control (idempotent)
- `delegateDeposit` — delegate to TEE validator

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
