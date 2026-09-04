# Wallet Activity + RPC Parsing

This document describes how the app derives wallet activity (incoming/outgoing) from Solana RPC transactions, including SPL token transfers.

## Data Flow (High Level)

- `apps/telegram/src/lib/solana/rpc/get-account-txn-history.ts` fetches parsed transactions via `getParsedTransactions(...)` and maps them to `WalletTransfer`.
  - UI screens (activity list + transaction details) consume these transfers and render either:
  - SOL transfers (lamports delta), or
  - SPL token transfers (token balance delta), using `tokenMint/tokenAmount/tokenDecimals`.

## `WalletTransfer` Shape

`apps/telegram/src/lib/solana/rpc/types.ts`:

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

| Type | Description |
|------|-------------|
| `transfer` | Default/fallback — standard SOL or SPL transfer |
| `swap` | Jupiter swap (detected by Jupiter program ID in instructions) |

## How SPL Token Transfers Are Detected

Implementation: `findTokenBalanceChange(...)` in `apps/telegram/src/lib/solana/rpc/get-account-txn-history.ts`.

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

Implementation: `findSplTokenTransferCounterparty(...)` in `apps/telegram/src/lib/solana/rpc/get-account-txn-history.ts`.

- Scans top-level and inner instructions for parsed `spl-token` / `spl-token-2022` instructions of type `transfer` / `transferChecked`.
- Determines whether the wallet token account is the `source` (outgoing) or `destination` (incoming).
- Returns the counterparty owner if known from token balance metadata; otherwise returns the counterparty token account address.

## UI Display Rules

- `apps/telegram/src/components/wallet/ActivitySheet.tsx`
  - If `transaction.tokenMint` + `transaction.tokenAmount` exist, the row displays `tokenAmount` and token symbol instead of `SOL`.
  - Token symbol/icon are resolved from `tokenHoldings` using `resolveTokenInfo(...)`:
    - Uses holdings symbol/image when available
    - Falls back to `KNOWN_TOKEN_ICONS` and finally `DEFAULT_TOKEN_ICON`
- `apps/telegram/src/components/wallet/TransactionDetailsSheet.tsx`
  - If token transfer: show token symbol as main unit and compute USD from the matching holding's `priceUsd` (if present).
  - Else: compute USD from `solPriceUsd`.

## Token Icons (Fallback)

If a token does not come back with an image URL, we fall back to a small known-icons map:

- Update `apps/telegram/src/lib/solana/token-holdings/constants.ts` (`KNOWN_TOKEN_ICONS`)
- Add the image file under `apps/telegram/public/tokens/`

## Generic Squads Smart-Account Activity (frontend)

For frontend we route smart-account activity through the
shared vault package:

- `packages/smart-account-vaults` creates vault read models and delegates
  portfolio/activity reads to `@loyal-labs/solana-wallet`.
- `apps/web/src/features/smart-accounts/server/read-model.ts` creates a
  `SmartAccountVaultsClient` with the configured Solana RPC and wallet data
  client.
- `GET /api/smart-accounts/overview` loads the smart-account overview with
  `activityLimit: 0` so the first sidebar render does not scan activity for
  every vault.
- `GET /api/smart-accounts/vault-activity?accountIndex=<n>` loads activity
  lazily for the selected vault.
- `apps/web/src/hooks/use-smart-account-sidebar-data.ts` maps
  `WalletActivity` entries into sidebar rows and transaction details.

This flow also carries `program_action` activity rows from the wallet data
package. Solana program logs are not persisted as a separate frontend log feed
in this branch; they are used for error normalization when wallet sends fail.

## Facelift Earn Activity

The facelift wallet workspace has a separate, Earn-only Activity page. It loads
authenticated history from `GET /api/smart-accounts/earn-transactions`, which
combines the Yield Neon position history with Autodeposit history for Earn vault
`accountIndex = 1`; it does not use the generic `vault-activity` route. The
client reuses a five-minute cache with the Earn activity card and refetches when
the Earn realtime refresh key changes.

`apps/web/src/components/wallet-workspace/facelift/activity-page.tsx` groups the
returned deposits, withdrawals, rebalances, and other Earn rows by date and
window-renders the list. Selecting a row opens
`apps/web/src/components/wallet-workspace/facelift/transaction-detail-pane.tsx`,
which shows its route, confirmed slot, signature when available, and a Solscan
link when a signature exists.

## Caveats / Known Limitations

- Multi-token transactions (e.g. swaps) can change multiple mints; we currently select the single mint with the largest absolute balance delta.
- Some transactions may include both SOL and SPL balance changes; for pure token transfers we display the token change and treat SOL as `amountLamports = 0`.
- Counterparty inference is best-effort and can fall back to token account addresses when owner metadata is missing.
