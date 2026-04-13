# Mobile Dapp Browser Design

## Goal

Add a built-in dapp browser to the mobile wallet.

The browser should:

- open from the wallet page via a new button
- live as its own full-page mobile route
- start on a curated home screen with trusted dapps
- support manual URL entry so users can browse to other dapps
- inject a Loyal wallet provider into pages
- support native wallet approvals for:
  - `connect`
  - `disconnect`
  - `signMessage`
  - `signTransaction`
  - `signAndSendTransaction`

The browser must stay in the current mobile app visual language and must not become a general-purpose multi-tab browser in v1.

## Context

Current mobile wallet context:

- wallet home lives in `mobile/app/(tabs)/index.tsx`
- root stack lives in `mobile/app/_layout.tsx`
- wallet auth and signer ownership live in `mobile/src/lib/wallet/wallet-provider.tsx`
- signing primitives already exist in:
  - `mobile/src/lib/wallet/signer.ts`
  - `mobile/src/lib/wallet/seed-vault-signer.ts`
- send paths already use the existing signer and RPC connection:
  - `mobile/src/lib/solana/wallet/wallet-details.ts`
  - `mobile/src/components/wallet/SwapSheet.tsx`

Relevant extension reference:

- injected provider: `extension/entrypoints/loyal-wallet-provider.content.ts`
- page bridge: `extension/entrypoints/loyal-wallet-bridge.content.ts`
- approval orchestration: `extension/entrypoints/background.ts`
- approval UI: `extension/src/components/wallet/dapp-approval-view.tsx`

Important mobile constraint:

- `mobile/src/lib/storage.ts` is currently in-memory only and explicitly does not persist across app restarts
- persistent browser permissions therefore must not rely on the current `mmkv` wrapper
- `expo-secure-store` is already used in mobile wallet storage and should be the persistence base for v1 browser permissions

Dependency gap:

- `react-native-webview` is not currently declared in `mobile/package.json`
- v1 requires adding it explicitly

## Product Decisions Locked For V1

- This is a dapp browser, not a full browser product.
- The browser is single-tab only.
- The browser has a curated home screen plus manual URL entry.
- `jup.ag` is the first trusted preset dapp.
- Users may navigate to non-trusted dapps.
- Non-trusted dapps are not blocked, but approvals show a warning directly above the action buttons.
- Approval UI is always native, never rendered inside the webview.
- Successful connections are remembered per origin across app restarts.
- No favorites or bookmarks in v1.

## Requirements

- Add a new browser entry button to the wallet home action row or the same immediate wallet action area.
- Add a dedicated browser route outside the tab bar.
- The browser home screen must include:
  - trusted dapp tiles
  - URL/search entry
  - recent history
- The active browser screen must include:
  - back
  - forward
  - refresh
  - home
- The browser must load arbitrary dapp pages inside the app.
- The page must receive an injected Loyal wallet provider at document start.
- The provider must expose wallet behavior compatible with the extension mental model.
- Wallet requests must leave the webview and land in a native approval surface.
- The approval flow must work with both local encrypted keypair wallets and Seed Vault wallets.
- Signing requests must be rejected unless the origin has connected first.
- Only one approval request may be active at a time.
- Connected origins must persist across app restarts.
- Disconnecting a dapp must remove only that origin’s saved connection.

## Non-Goals

- No multi-tab browsing.
- No favorites/bookmarks.
- No custom user-managed trust list editing.
- No blocklist or security-scanner product in v1.
- No Jupiter-specific wallet integration path.
- No browser extensions, plugins, or injected devtools.
- No desktop-style browser chrome.
- No wallet-standard `signIn` flow in v1.
- No batch `signAllTransactions` feature in v1.

## Recommended Approach

Build a dedicated mobile browser screen backed by a single `WebView`, with a mobile-native injected provider and bridge.

Why this approach:

- It matches the extension’s provider-driven wallet model closely enough that the behavior is understandable and reusable.
- It supports arbitrary dapps instead of hardcoding Jupiter wrappers.
- It preserves a clean wallet-vs-dapp boundary by moving approvals into native UI.
- It keeps scope tight by limiting the browser to one active page and one pending approval.

Rejected alternatives:

- Curated wrappers only
  - too restrictive for the requested “navigate to other dapps” behavior
- External browser plus deep-link approvals
  - weaker UX, weaker compatibility, and no true built-in browser experience
- Full browser product with tabs, favorites, and settings
  - too much surface area for v1

## Design

### 1. Route And Navigation

Add a new top-level route:

- `mobile/app/browser/index.tsx`

Register it in `mobile/app/_layout.tsx` as a hidden stack screen, similar to `token/[mint]`.

Entry points:

- new wallet action button from `mobile/app/(tabs)/index.tsx`

V1 browser navigation stays inside a single route. The screen internally switches between:

- home state
- active webview state

There is no per-page Expo route or deep-linkable browser session URL in v1.

### 2. Browser Surface

The browser screen uses one long-lived controller and one visible page surface.

Sections:

1. `BrowserHeader`
   - back
   - compact URL/search field

2. `BrowserHome`
   - trusted dapp presets
   - recent history list
   - explicit empty-recents state when there is no history yet

3. `BrowserWebViewHost`
   - one `WebView`
   - toolbar with:
     - back
     - forward
     - home
     - refresh
   - current-origin trust status in the header area

4. `BrowserApprovalSurface`
   - native sheet or modal above the browser route
   - reused for connect, message signing, transaction signing, and sign-and-send

Visual direction:

- reuse the wallet’s white canvas, gray card surfaces, black typography, and coral accents
- trusted preset treatment can use a soft branded card treatment
- avoid dark trading-app browser chrome

### 3. Trusted Dapps And History

Trusted presets are static app-owned metadata.

Initial trusted preset list:

- `https://jup.ag`

Each trusted preset should define:

- normalized origin
- display name
- icon source
- optional start URL

Recent history is user-earned navigation history and should be persisted separately from trusted presets.

History rules for v1:

- store a small bounded list, for example the most recent 20 entries
- each entry stores:
  - normalized origin
  - last visited URL
  - last known title
  - last seen timestamp
- visiting a page updates or moves the entry to the front

### 4. Injected Provider And Bridge

The browser injects a Loyal wallet provider into the page at document start.

The provider should mirror the extension capability shape conceptually, but the transport is mobile-specific:

- page code calls the injected provider
- provider serializes a request with an ID and posts it through `ReactNativeWebView.postMessage`
- mobile browser host receives the request, validates it, and either resolves immediately or opens native approval according to the request type and current origin state
- mobile sends the result back into the page by injecting a response script that resolves the pending request promise

Do not attempt to reuse extension background/content-script code directly.

What should be shared conceptually:

- request and response message types
- origin-based permission model
- single-pending-request behavior
- approval result semantics

What stays mobile-specific:

- `WebView` message bridge
- origin verification from navigation state
- unlock flow
- native sheet presentation
- local signer and RPC send path

### 5. Capability Surface

V1 injected provider supports:

- `connect`
- `disconnect`
- `signMessage`
- `signTransaction`
- `signAndSendTransaction`
- wallet-standard change events needed to reflect connection state

Behavior rules:

- `connect`
  - if the current origin is already connected, return the account immediately
  - otherwise open native approval
- `disconnect`
  - remove the current origin from saved connected origins
- `signMessage`
  - require prior connection
  - open native approval
- `signTransaction`
  - require prior connection
  - open native approval
  - sign but do not submit
- `signAndSendTransaction`
  - require prior connection
  - open native approval
  - sign with the existing wallet signer
  - submit through the existing Solana RPC connection

`signAndSendTransaction` should reuse the same underlying send pattern already used in mobile wallet flows:

- deserialize the incoming transaction
- sign through the active wallet signer
- submit serialized bytes with `getConnection().sendRawTransaction(...)`
- return the signature to the page

### 6. Origin Verification And Security Model

The browser must not trust page-supplied origin strings.

The requesting origin must come from the mobile browser host:

- derive it from the current `WebView` URL/navigation state
- normalize to `protocol + hostname + port`
- use the normalized origin for:
  - trusted preset matching
  - connected-origin persistence
  - approval display

Trust states in v1:

1. `trusted preset`
   - origin matches a built-in trusted dapp
2. `connected origin`
   - user has previously approved `connect`, but the origin is not a built-in trusted preset
3. `untrusted origin`
   - neither trusted preset nor connected

Approval UI rules:

- connect approval for trusted presets shows normal UI
- connect approval for non-trusted origins shows a warning above action buttons
- signing approval for connected-but-non-preset origins still shows the warning
- warning is advisory, not blocking

Request handling rules:

- only one active approval at a time
- a newer request replaces a stale pending request
- malformed or unsupported requests are rejected immediately
- if the wallet is locked, unlock must complete before approval continues
- if unlock is canceled or fails, the dapp request is rejected

### 7. Persistence Model

Because `mobile/src/lib/storage.ts` is currently non-persistent, v1 browser persistence should use dedicated `SecureStore` helpers inside the dapp-browser feature.

Persisted data:

- connected origins
- recent history
- optional cached display metadata for recent items

Do not persist:

- pending approval state
- in-page provider runtime state
- per-page JS execution state

Suggested feature-owned storage helpers:

- `mobile/src/features/dapp-browser/storage/connected-origins.ts`
- `mobile/src/features/dapp-browser/storage/recent-history.ts`

Data should stay small and bounded so `SecureStore` remains practical.

### 8. Feature Boundaries

Create a dedicated feature slice:

```text
mobile/src/features/dapp-browser/
  ui/
  bridge/
  storage/
  model/
  routes.ts
```

Suggested responsibilities:

- `ui/`
  - browser screen
  - home cards
  - toolbar
  - native approval sheet
- `bridge/`
  - injected provider script
  - request parsing
  - response serialization
  - request controller
- `storage/`
  - connected origins
  - recent history
- `model/`
  - origin normalization
  - trust-state classification
  - request types
  - approval state machine

Existing wallet logic should remain outside this slice:

- signer ownership stays in `mobile/src/lib/wallet/*`
- Solana RPC connection stays in `mobile/src/lib/solana/rpc/connection.ts`
- existing send/swap/shield wallet flows remain unchanged

### 9. Approval UX

Approval UI should stay wallet-owned and visually distinct from the web page behind it.

Each approval surface should show:

- dapp origin
- trusted/untrusted state
- favicon or preset icon when available
- request type
- decoded transaction or message summary when available
- `Reject`
- request-specific positive action:
  - `Connect`
  - `Sign`
  - `Sign & Send`

For transactions, show a useful summary when decoding succeeds and a raw fallback when it does not.

For non-trusted origins, the warning block sits directly above the action row, not hidden in details.

### 10. Testing And Verification

Required unit coverage:

- origin normalization
- trusted-origin matching
- connected-origin persistence
- recent history persistence and trimming
- malformed request rejection
- single-pending-request replacement behavior
- provider request/response matching by ID
- `signAndSendTransaction` bridge behavior

Required integration or component coverage:

- browser screen route can open from wallet page
- trusted preset launches its start URL
- reconnect path returns immediately for remembered origins
- disconnect removes only the current origin
- unlock-then-approve flow works for a locked wallet

Required manual smoke path:

1. Open browser from wallet page.
2. Launch `jup.ag` from the trusted home tile.
3. Connect the wallet.
4. Perform one request that signs or signs-and-sends.
5. Navigate to a non-trusted dapp.
6. Confirm approval shows the warning above the action buttons.
7. Restart the app and confirm the previous trusted connection state is remembered per origin.

## Open Follow-Up Work After V1

- bookmarks or favorites
- multiple tabs
- user-managed trusted sites
- richer malicious-site handling
- deeper transaction decoding
- deeper compatibility features such as wallet-standard `signIn`
