# Wallet Activity + RPC Parsing

This document describes how the app derives wallet activity (incoming/outgoing) from Solana RPC transactions, including SPL token transfers.

## Data Flow (High Level)

- `app/src/lib/solana/rpc/get-account-txn-history.ts` fetches parsed transactions via `getParsedTransactions(...)` and maps them to `WalletTransfer`.
  - UI screens (activity list + transaction details) consume these transfers and render either:
  - SOL transfers (lamports delta), or
  - SPL token transfers (token balance delta), using `tokenMint/tokenAmount/tokenDecimals`.

## `WalletTransfer` Shape

`app/src/lib/solana/rpc/types.ts`:

- Always present (core transfer data):
  - `signature`, `slot`, `timestamp`
  - `direction` (`in` | `out`)
  - `amountLamports` (SOL transfers)
  - `feeLamports`, `status`, `counterparty?`
  - `type` — decoded instruction type (see [Transaction Types](#transaction-types) below), defaults to `transfer`
- Optional (only for detected SPL token transfers):
  - `tokenMint?: string`
  - `tokenAmount?: string` (decimal-adjusted UI amount, truncated for display)
  - `tokenDecimals?: number`

Current behavior: when a transfer is classified as an SPL token transfer, `amountLamports` is set to `0` and token fields are set.

## Transaction Types

The `type` field is decoded from on-chain instruction data. The parser attempts to decode instructions against the `telegram-private-transfer` and `telegram-verification` IDLs in order.

### telegram-private-transfer program types

These correspond to instructions on the `telegram-private-transfer` program (`97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV`):

| Type | Description |
|------|-------------|
| `secure` | Shield — `modify_balance` with `increase=true` (tokens move from wallet to vault) |
| `unshield` | Unshield — `modify_balance` with `increase=false` (tokens move from vault to wallet) |
| `initialize_deposit` | Deposit account creation |
| `initialize_username_deposit` | Username deposit account creation |
| `transfer_deposit` | Private balance transfer between two user deposits (PER) |
| `transfer_to_username_deposit` | Private transfer to a username deposit (PER) |
| `claim_username_deposit_to_deposit` | Claim from username deposit with verified Telegram session (PER) |
| `create_permission` | PER access control creation for user deposit |
| `create_username_permission` | PER access control creation for username deposit |
| `delegate` | Delegate user deposit to MagicBlock PER |
| `delegate_username_deposit` | Delegate username deposit to PER |
| `undelegate` | Commit and undelegate user deposit from PER |
| `undelegate_username_deposit` | Commit and undelegate username deposit from PER |

Note: `modify_balance` is not surfaced directly — it is re-mapped to `secure` or `unshield` based on the `increase` argument in the decoded instruction data (see `get-account-txn-history.ts:503-511`).

### telegram-verification program types

| Type | Description |
|------|-------------|
| `store` | Store Telegram validation bytes in session PDA |
| `verify_telegram_init_data` | Verify Ed25519 signature against Telegram public key |

### Other types

| Type | Description |
|------|-------------|
| `transfer` | Default/fallback — standard SOL or SPL transfer |
| `swap` | Jupiter swap (detected by Jupiter program ID in instructions) |

## How SPL Token Transfers Are Detected

Implementation: `findTokenBalanceChange(...)` in `app/src/lib/solana/rpc/get-account-txn-history.ts`.

1. Read `meta.preTokenBalances` and `meta.postTokenBalances`.
2. Filter balances down to token accounts belonging to the wallet:
   - Preferred: `owner === walletAddress`
   - Fallback (when `owner` is missing): treat the wallet's associated token account (ATA) as wallet-owned by re-deriving the ATA for `mint` and comparing.
3. Sum balances by mint (multiple token accounts per mint are supported).
4. Compute `delta = post - pre` for each mint and pick the mint with the largest absolute delta.
5. Produce:
   - `direction` from sign of delta
   - `tokenMint`, `tokenDecimals`
   - `tokenAmount` formatted from raw base units with truncation (currently max 4 fractional digits)

## How Counterparty Is Inferred For SPL Transfers

Implementation: `findSplTokenTransferCounterparty(...)` in `app/src/lib/solana/rpc/get-account-txn-history.ts`.

- Scans top-level and inner instructions for parsed `spl-token` / `spl-token-2022` instructions of type `transfer` / `transferChecked`.
- Determines whether the wallet token account is the `source` (outgoing) or `destination` (incoming).
- Returns the counterparty owner if known from token balance metadata; otherwise returns the counterparty token account address.

## UI Display Rules

- `app/src/components/wallet/ActivitySheet.tsx`
  - If `transaction.tokenMint` + `transaction.tokenAmount` exist, the row displays `tokenAmount` and token symbol instead of `SOL`.
  - Token symbol/icon are resolved from `tokenHoldings` using `resolveTokenInfo(...)`:
    - Uses holdings symbol/image when available
    - Falls back to `KNOWN_TOKEN_ICONS` and finally `DEFAULT_TOKEN_ICON`
- `app/src/components/wallet/TransactionDetailsSheet.tsx`
  - If token transfer: show token symbol as main unit and compute USD from the matching holding's `priceUsd` (if present).
  - Else: compute USD from `solPriceUsd`.

## Token Icons (Fallback)

If a token does not come back with an image URL, we fall back to a small known-icons map:

- Update `app/src/lib/solana/token-holdings/constants.ts` (`KNOWN_TOKEN_ICONS`)
- Add the image file under `app/public/tokens/`

## Caveats / Known Limitations

- Multi-token transactions (e.g. swaps) can change multiple mints; we currently select the single mint with the largest absolute balance delta.
- Some transactions may include both SOL and SPL balance changes; for pure token transfers we display the token change and treat SOL as `amountLamports = 0`.
- Counterparty inference is best-effort and can fall back to token account addresses when owner metadata is missing.
