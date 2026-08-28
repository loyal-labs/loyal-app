# Privy × Loyal Earn demo

A disposable mainnet demo with one visible state machine:

1. Connect the embedded Privy wallets and send Solana USDC to the displayed
   address outside the demo.
2. Find the wallet's existing Loyal smart account or create it once.
3. Find or create exactly four policies: recurring wallet autodeposit, Kamino
   Main route, Kamino Main setup, and a USDC limit back to the same wallet.
4. Move 2 USDC wallet → smart account → Kamino, then move 1 USDC Kamino →
   smart account → wallet. The UI offers one "Run the loop" action that chains
   all four hops with zero wallet signatures, plus each fixed hop individually
   in the engineer view; the loop decomposes into exactly the same four
   backend moves. Account and policy setup run as one progressive "Set up the
   account" action.
5. Withdraw wallet USDC to a user-provided Solana address with one Privy
   approval.
6. Reset the demo from the engineer view: wallet-signed teardown stages exit
   the whole Kamino position, drain the vault, close all four policies, and
   return reclaimable rents to the wallet, so the walkthrough can run again
   from the beginning. The smart account itself stays.

The Privy wallet approves account and policy setup. After that, four fixed
backend actions use the delegated policy key and pay fees with a separate
sponsor key. The endpoint never accepts an arbitrary movement transaction,
amount, mint, market, or destination. Every action reloads finalized wallet,
smart-account, and Kamino balances before and after execution.

## Setup

Configure a Privy app with:

- email login;
- automatic Solana embedded-wallet creation;
- the local or deployed origin;
- identity tokens with linked accounts enabled.

The demo intentionally has no funding button. Canonical Solana USDC is sent
directly to the displayed embedded-wallet address. The wallet withdrawal UI
constructs only a canonical-USDC transfer to the user-provided Solana address,
asks Privy for one signature, and waits for mainnet finalization. The embedded
wallet pays that withdrawal's network fee and any destination ATA rent.

Mount the 1Password Environment `loyal-demo`
(`cfeonlsrfu3yoohtlpplc6wb7u`) as the named pipe
`apps/privy-showcase/.env.1password`. It provides
`NEXT_PUBLIC_PRIVY_APP_ID`. The demo deliberately freezes its browser and
server RPC transport to the keyless `guendolen-nvqjc4-fast-mainnet` HTTPS/WSS
endpoint, so a mounted API-key URL cannot leak into browser requests. The
server-only keys have separate roles:

- `SMART_ACCOUNT_SPONSOR_PK` pays Solana fees and sponsored account rent;
- `EARN_POLICY_SPONSOR_PK` signs the four policy-constrained movements;
- `SMART_ACCOUNT_SPONSOR_PUBKEY` is the public policy signer embedded in all
  four policies and must derive from `EARN_POLICY_SPONSOR_PK`.

The frozen RPC supports mainnet `getProgramAccounts`. Wallet, smart-account,
and Kamino collateral accounts are watched over WSS; HTTP reads happen once at
startup and after an actual finalized account change, not on a timer. Never
expose either private key with a `NEXT_PUBLIC_` prefix.

Start the demo from the repository root with one command. The package script
combines the repository and app mounts because the current 1Password values are
split across them:

```sh
bun run --cwd apps/privy-showcase dev
```

The acceptance contract and sole verifier are documented in
[`VERIFICATION.md`](./VERIFICATION.md).
