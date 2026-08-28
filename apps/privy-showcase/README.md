# Privy × Loyal Earn demo

A disposable mainnet demo with one visible state machine:

1. Connect the embedded Privy wallets and send Solana USDC to the displayed
   address outside the demo.
2. Find the wallet's existing Loyal smart account or create it once.
3. Find or create exactly four policies: recurring wallet autodeposit, Kamino
   Main route, Kamino Main setup, and a USDC limit back to the same wallet.
4. Move 2 USDC wallet → smart account → Kamino, then move 1 USDC Kamino →
   smart account → wallet. The UI offers two chained scenarios — "Run payday
   sweep" (hops A+B) and "Fund a purchase" (hops C+D) — plus each of the four
   fixed hops individually; every scenario decomposes into exactly the same
   four backend moves.
5. Withdraw wallet USDC to a user-provided Solana address with one Privy
   approval.

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
