# ASK-900: Token Detail Page Design

## Goal

Add a dedicated token detail page in the mobile app for every token that can appear in the wallet.

The page should combine:

- wallet position context
- market context
- token-specific wallet activity
- direct token actions

It must stay in the current mobile app visual language rather than copying the dark trading-app references directly.

## Context

Current wallet experience in `mobile`:

- the main wallet route is `mobile/app/(tabs)/index.tsx`
- tokens render in `mobile/src/components/wallet/TokensList.tsx`
- the full token list renders in `mobile/src/components/wallet/TokensSheet.tsx`
- send, swap, shield, and receive already exist as wallet actions
- wallet holdings already distinguish `public` vs `shielded` positions through `TokenHolding.isSecured`
- wallet transaction history already includes token mints and token-related transaction variants

ASK-900 includes visual references that point in the same direction:

- chart-first token hero
- action row below the hero
- lower-half market stats and links
- wallet balance shown separately from market information

The selected design direction is `Balanced Stack`:

- a route-level page, not a sheet
- market context at the top
- wallet position context immediately below
- lower-half market stats and activity in a single long scroll

## Requirements

- Each wallet token row should open a dedicated token page.
- The page must also work for tokens the user does not currently hold.
- The route must be a full page with standard back navigation.
- Market context must remain unified for a token, even when the user holds both public and shielded balances.
- Portfolio context must distinguish `public` and `shielded` balances.
- The top of the page must balance price/chart, actions, and wallet position.
- The page must support existing wallet actions in token context:
  - `Send`
  - `Receive`
  - `Swap`
  - `Shield`
- The page must include token-specific wallet activity.
- The page must include lower-half market and token metadata.
- The page must stay visually aligned with the existing mobile wallet language:
  - white canvas
  - soft gray cards
  - black typography
  - coral action accents
  - green for positive movement

## Data Constraints

The token detail page should be designed around data we can actually support.

Already available in the app:

- wallet holdings by mint with:
  - `mint`
  - `symbol`
  - `name`
  - `balance`
  - `decimals`
  - `priceUsd`
  - `valueUsd`
  - `imageUrl`
  - `isSecured`
- wallet activity with token-aware fields:
  - `tokenMint`
  - `tokenAmount`
  - `swapFromMint`
  - `swapToMint`
  - secure/unshield transaction types

Required new market data:

- token chart data
- token market stats
- richer token metadata and links for tokens not already present in holdings

## Non-Goals

- No cost basis or PnL in v1.
- No live market trade feed in v1.
- No tabbed token detail experience in v1.
- No premium Birdeye dependency.
- No dark-theme redesign of the mobile wallet.
- No attempt to turn the token page into a separate trading app surface.

## Recommended Approach

Build a route-level token page with a single long scroll.

Why this approach:

- It removes bottom-sheet ambiguity and keeps navigation simple.
- It matches the rest of the mobile app better than a mini-app-with-tabs pattern.
- It lets market and wallet context sit together without mode switching.
- It gives us a clean entry point for future token discovery outside the wallet list.

Rejected alternatives:

- A bottom sheet token detail.
  - Too easy to confuse with the existing token sheet and transaction sheets.
- A tabbed token page with `Overview`, `Market`, `Activity`.
  - Adds navigation overhead and pushes too much surface area into v1.
- A chart-dominant dark trading screen.
  - Breaks the current visual language and raises implementation scope.

## Design

### 1. Route And Navigation

Add a dedicated route for token details.

Recommended path:

- `mobile/app/token/[mint].tsx`

Entry points:

- tap from `TokensList`
- tap from `TokensSheet`
- future entry from token search/discovery

The page should always be keyed by token mint, not by list position or sheet state.

### 2. Page Anatomy

The page uses a single long scroll with these sections:

1. `TokenHeader`
   - back
   - share / copy address
   - optional more menu

2. `TokenHero`
   - token icon
   - token name
   - symbol
   - current price
   - absolute move
   - percent move
   - range selector
   - line chart

3. `TokenActionRail`
   - `Send`
   - `Receive`
   - `Swap`
   - `Shield`

4. `TokenPositionSummary`
   - total token balance
   - total USD value
   - compact split tiles:
     - `Public balance`
     - `Shielded balance`

5. `TokenPositionDetail`
   - public amount and value
   - shielded amount and value
   - contextual CTA for shielding / unshielding
   - latest wallet interaction for this token

6. `TokenMarketStats`
   - market cap
   - FDV
   - liquidity
   - 24h volume
   - holder count
   - mint / contract

7. `TokenLinks`
   - website
   - X / social
   - explorer
   - copy mint

8. `TokenActivity`
   - token-filtered wallet activity only

### 3. Position Model

This page has one token identity, but two portfolio states.

Market layer:

- singular token identity
- singular chart
- singular price
- singular market stats

Portfolio layer:

- combined total at the top of the position section
- separate `public` and `shielded` balances underneath
- wallet actions derived from actual position state

This avoids treating shielded balances like a separate market asset while still making the custody distinction obvious.

### 4. Held Vs Unheld Behavior

#### User holds the token

- show full position summary
- show split public / shielded balances
- enable wallet actions based on actual balance state
- show token-specific wallet activity

#### User does not hold the token

- still render the full token page
- keep market hero, chart, stats, and links
- render an empty-position card:
  - `You don’t hold this token yet`
- action emphasis shifts toward `Swap`
- `Send` stays disabled
- `Shield` stays hidden or disabled
- token activity shows wallet-empty state, not global market trades

#### User holds both public and shielded balances

- market layer stays singular
- position module shows combined total plus split balance tiles
- shielding actions stay in the position module, not the market section

### 5. Action Rules

- `Send`
  - public balance only
  - preselect this token when opened from token detail

- `Receive`
  - always available
  - keep current wallet receiving behavior, with token context if useful

- `Swap`
  - preselect this token as the active asset context
  - this is the primary acquisition action for unheld tokens

- `Shield`
  - available only when the token has public balance and the existing shielding implementation can handle that mint
  - initiated from the token page in token context

- `Unshield`
  - exposed contextually inside the position detail module when shielded balance exists

### 6. Loading And Error Behavior

The page should degrade by section rather than fail as a whole.

If local wallet data is ready but market data is loading:

- render balances immediately
- render hero/stat skeletons independently

If market data fails:

- keep the page usable from local holdings and wallet activity
- show chart unavailable state
- keep lower sections that can still render from local truth

If the token is unknown locally but known to market APIs:

- render full market page with zero-position state

If both local and market data fail:

- render a token unavailable state with retry and visible mint address

## Data Plan

### 1. Local Truth

These values should be computed from existing app state:

- total token balance
- public token balance
- shielded token balance
- total position USD
- token-specific wallet activity

Token-specific wallet activity should include:

- direct token sends / receives for the mint
- swaps where the token is the input mint
- swaps where the token is the output mint
- shield / unshield events for the mint

### 2. Jupiter

Use Jupiter for token identity and trust-layer metadata.

Expected usage:

- name
- symbol
- icon
- verification / trust signals
- holder count
- market cap / liquidity when available

Reference:

- `https://developers.jup.ag/docs/tokens/token-information`

### 3. Birdeye

Use Birdeye only through free/public endpoints for v1.

Allowed scope:

- historical price line chart
- token market stats
- token search/bootstrap when needed

Do not design v1 around premium-only Birdeye APIs.

This requirement is explicit.

Preferred endpoints:

- `history_price` for line-chart data
- `v3/token/market-data` for market stats
- optional public search endpoint for token lookup

Chart rule:

- v1 should use a line chart backed by Birdeye free/public history data
- do not make candlestick / OHLCV a requirement unless it is confirmed to work within Birdeye free access

References:

- `https://docs.birdeye.so/docs/pricing`
- `https://docs.birdeye.so/changelog/20250717-enhanced-free-access-performance-improvements-and-evm-data-accuracy`
- `https://docs.birdeye.so/reference/get-defi-history_price`
- `https://docs.birdeye.so/reference/get-defi-v3-token-market-data-single`

### 4. Truthfulness Rules

- Do not infer cost basis or PnL.
- Do not show fake `average buy price`.
- Do not show global `live feed` if the data is only wallet-local activity.
- Do not present shielded and public balances as different market identities.

## File Impact

Recommended new route:

- `mobile/app/token/[mint].tsx`

Recommended new feature area:

- `mobile/src/features/token-details/ui/TokenDetailScreen.tsx`
- `mobile/src/features/token-details/ui/*`
- `mobile/src/features/token-details/useTokenDetail.ts`
- `mobile/src/features/token-details/market-data.ts`
- `mobile/src/features/token-details/activity.ts`
- `mobile/src/features/token-details/types.ts`

Likely touched existing files:

- `mobile/src/components/wallet/TokensList.tsx`
- `mobile/src/components/wallet/TokensSheet.tsx`
- `mobile/src/components/wallet/SendSheet.tsx`
- `mobile/src/components/wallet/SwapSheet.tsx`
- `mobile/src/components/wallet/ShieldSheet.tsx`
- `mobile/src/hooks/wallet/useWalletTransactions.ts`

## Testing And Validation

Required implementation verification:

- `cd mobile && npx tsc --noEmit`
- `cd mobile && npx expo lint`

Suggested unit coverage:

- token detail view model for:
  - held token
  - unheld token
  - public + shielded token
  - market API fallback behavior
- activity filtering for:
  - token transfers
  - swaps involving the token
  - shield / unshield involving the token
- action enable / disable rules

Manual smoke checks:

- tapping a wallet token opens the correct token page
- back returns to the wallet screen without sheet confusion
- held token shows total + public + shielded balances correctly
- unheld token shows market content with empty-position state
- token activity is filtered to the current mint
- send / swap / shield open in token context
- chart and stats degrade gracefully when market APIs fail

## Rollout Notes

- This is a new surface layered on top of existing wallet actions, not a replacement wallet home redesign.
- The route should stay usable even when the user has zero position in the token.
- Keeping the page as a long scroll reduces interaction complexity and makes rollback straightforward if needed.
