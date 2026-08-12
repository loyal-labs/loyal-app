# Privy × Loyal mainnet showcase

This isolated example proves that a Privy embedded Solana wallet can own and sign for a Loyal/Squads smart account, configure a bounded USDC autodeposit, authorize a policy-only backend sweep, and withdraw vault funds back to itself.

## Dashboard and secret setup

1. Create a Privy app and allow its local/deployed origin.
2. Enable email login, automatic Solana embedded-wallet creation, and **Return user data in an identity token**.
3. Mount the values in `.env.example` through 1Password. `PRIVY_SHOWCASE_POLICY_SIGNER_PK` is a persistent base58-encoded 64-byte Solana keypair. Its public key becomes the policy signer and must never be a root Settings signer.
4. Fund the Privy wallet with enough mainnet SOL for rent/fees and canonical mainnet USDC for the bounded canary. Fund the backend signer with only enough SOL for the delegated sweep fee.

Run `bun run --cwd examples/privy-showcase dev`. The app and automated checks are mainnet-only. Automated verification never submits a transaction; a live canary requires explicit user action in the UI.

## Trust boundary

- Privy wallet (client): root Squads signer and fee payer for account creation, setup, withdrawal, and close.
- Backend signer (server): policy signer only. It cannot change Settings or redirect the policy destination.
- Replay safety: the wallet-signed intent fixes finalized balances, allowance state, exact amount, memo nonce, and recent blockhash. Every server instance builds the same signed Solana transaction, so concurrent replay can only rebroadcast one transaction signature; later replay fails the signed snapshot check.
- On-chain policy: mainnet USDC, exact wallet source, vault-index-1 destination, per-period cap, one backend policy signer.
- Application check: minimum balance kept in the wallet. The signed execution intent makes that mutable floor explicit; it is not represented as an immutable on-chain constraint.
- Server endpoints: `/api/sweep/challenge`, `/api/sweep/execute`, and the public-key-only `/api/sweep/config`. There are no transaction prepare or confirm endpoints.
