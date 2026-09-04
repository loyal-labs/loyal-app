# @loyal-labs/loyal-smart-accounts

Universal TypeScript SDK for the Squads Smart Account program, packaged for Loyal's monorepo and applications.

This package does not depend on Squads' unpublished npm package. Loyal owns:

- a pinned upstream snapshot in `@loyal-labs/loyal-smart-accounts-core`
- a Loyal-normalized IDL and generated low-level artifacts
- a vertical-slice SDK with explicit `instructions`, `prepare`, `queries`, and client send flows
- an optional Loyal env adapter at `@loyal-labs/loyal-smart-accounts-core/loyal`

The public SDK exposes:

- `generated` for low-level generated accounts, instructions, types, and errors
- `programConfig`
- `smartAccounts`
- `proposals`
- `transactions`
- `batches`
- `policies`
- `spendingLimits`
- `execution`
- `pda`, `codecs`, and `errors` for shared protocol helpers

## Installation

```bash
bun add @loyal-labs/loyal-smart-accounts @solana/web3.js
# or
npm install @loyal-labs/loyal-smart-accounts @solana/web3.js
```

## Quick Start

```ts
import {
  createLoyalSmartAccountsClient,
  smartAccounts,
  pda,
  codecs,
} from "@loyal-labs/loyal-smart-accounts";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com");
const creator = Keypair.generate();

const [settingsPda] = pda.getSettingsPda({
  accountIndex: 1n,
});

const instruction = smartAccounts.instructions.create({
  treasury: creator.publicKey,
  creator: creator.publicKey,
  settings: settingsPda,
  settingsAuthority: null,
  threshold: 1,
  signers: [
    {
      key: creator.publicKey,
      permissions: codecs.Permissions.all(),
    },
  ],
  timeLock: 0,
  rentCollector: null,
});

const prepared = await smartAccounts.prepare.create({
  treasury: creator.publicKey,
  creator: creator.publicKey,
  settings: settingsPda,
  settingsAuthority: null,
  threshold: 1,
  signers: [
    {
      key: creator.publicKey,
      permissions: codecs.Permissions.all(),
    },
  ],
  timeLock: 0,
  rentCollector: null,
});

const client = createLoyalSmartAccountsClient({ connection });

await client.send(prepared, {
  signers: [creator],
});

await client.smartAccounts.create({
  treasury: creator.publicKey,
  creator,
  settings: settingsPda,
  settingsAuthority: null,
  threshold: 1,
  signers: [
    {
      key: creator.publicKey,
      permissions: codecs.Permissions.all(),
    },
  ],
  timeLock: 0,
  rentCollector: null,
});
```

## Upstream Sync

To refresh the pinned upstream snapshot and synced generated artifacts:

```bash
bun run loyal-smart-accounts:update
```

The update script stores the fetched upstream commit and IDL snapshots in the core package, validates registry coverage, and refreshes committed generated artifacts.
