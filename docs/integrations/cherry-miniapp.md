# Cherry MiniApp integration

## Goal

Run the existing Loyal web wallet inside Cherry without changing Loyal's
transaction construction, confirmation, persistence, or reconciliation flows.

The intended boundary is:

1. Cherry provides a signed launch context and the user's Solana wallet.
2. Loyal builds the same transactions it builds for existing wallet adapters.
3. Cherry signs messages and transactions after user approval.
4. Loyal submits signed bytes through its configured RPC, confirms them, and
   runs the existing post-confirmation APIs and reconciliation.

The inverse `@cherrydotfun/chat-embed-sdk` is not part of this integration.

## Mobile MVP implemented without Cherry provisioning

- `@cherrydotfun/miniapp-sdk` is pinned exactly, because the package is still
  pre-1.0 and bridge behavior must not change through an implicit range update.
- Strict Cherry browser detection is isolated to `/app/cherry`.
- Server configuration remains disabled until both the MiniApp ID and the
  registered origin are supplied.
- Launch-token verification validates the Cherry signature through the SDK,
  then independently checks issuer, Solana wallet, room, token id, and token
  timing context before exposing a wallet identity to Loyal.
- `/app/cherry` is a mobile-only entry. It requires both
  `window.__cherry === true` and a callable native WebView transport before it
  dynamically loads any Cherry SDK runtime.
- The server attests the launch token through a same-origin, no-store endpoint.
  It returns only wallet, room, issue, and expiry context and never creates a
  Loyal session from the bearer token.
- The connected bridge wallet must equal the server-verified token wallet
  before the existing Loyal workspace mounts.
- A narrow adapter validates Cherry's legacy/v0 signatures and preserved prior
  signatures, then submits exactly once through Loyal's supplied RPC.
- Suspend unmounts active wallet/realtime work; resume remounts it from
  canonical sources; wallet disconnect fails closed and best-effort logs out.
- Device viewport and safe-area behavior is scoped to the dedicated route.

This first slice deliberately keeps Loyal's existing CAPTCHA and wallet-proof
session boundary. Connection is automatic, but a first-time user still
completes the existing human check and approves one wallet signature. Replacing
that boundary with zero-prompt launch-token auth requires a separately approved
abuse/replay design because onboarding can spend sponsorship funds.

Cherry's installed `cherry-miniapp-integration` skill was applied after the
initial verifier. Its step-by-step comparison is in
`docs/integrations/cherry-miniapp-skill-review.md`.

## Reviewed SDK contract (0.1.21)

The dependency is pinned to `0.1.21`, the current published version verified on
2026-08-03. Official source: <https://github.com/cherrydotfun/miniapp-sdk>.
These conclusions come from the exact installed distribution, not only the
README:

| Contract                                                                                                                 | Installed evidence                                                                                                             | Consequence for Loyal                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Strict host detection accepts only `window.__cherry` or `cherry_embed=1`.                                                | `node_modules/@cherrydotfun/miniapp-sdk/dist/index.mjs:8-16`                                                                   | Gate the adapter on both the dedicated route and a strict Cherry signal.                                                       |
| Normal detection also accepts any iframe or React Native WebView.                                                        | `node_modules/@cherrydotfun/miniapp-sdk/dist/index.mjs:13-15`                                                                  | Never mount or select Cherry through default detection on ordinary routes.                                                     |
| `strict` is declared and forwarded, but the built client reads only `initTimeout`; adapter readiness is also non-strict. | `dist/client-Bi55Q6eQ.d.ts:222-247`; `dist/react/index.mjs:508-525`; `dist/index.mjs:173-196`; `dist/solana/index.mjs:177-179` | SDK 0.1.21's provider flag is insufficient. Loyal must gate mounting and ask Cherry to fix the release.                        |
| Bridge request timeout is 120 seconds; init defaults to 10 seconds.                                                      | `node_modules/@cherrydotfun/miniapp-sdk/dist/index.mjs:30,119-134,194-195`                                                     | Show distinct initialization and approval states; a two-minute wallet wait cannot look frozen.                                 |
| Client initialization decodes the launch JWT without verifying it.                                                       | `node_modules/@cherrydotfun/miniapp-sdk/dist/index.mjs:221-246`                                                                | Never create a Loyal session from client context; verify the raw token server-side first.                                      |
| Bridge messages use wildcard `postMessage`; incoming messages are not filtered by `event.origin` or `event.source`.      | `node_modules/@cherrydotfun/miniapp-sdk/dist/index.mjs:41-79,91-110`                                                           | Keep the route mobile-only, add no iframe surface, and verify host message provenance with Cherry before financial activation. |
| Single, batch, and message signing return host results.                                                                  | `node_modules/@cherrydotfun/miniapp-sdk/dist/solana/index.mjs:210-247`                                                         | Verify message bytes, signer slot, prior signatures, and batch order before submission.                                        |
| Stock `sendTransaction` ignores Loyal's connection/options and calls host `wallet.signAndSendTransaction`.               | `node_modules/@cherrydotfun/miniapp-sdk/dist/solana/index.mjs:249-263`                                                         | Direct use changes submission ownership and can bypass Loyal RPC send/reconciliation.                                          |
| Token verification fixes RS256, verifies against JWKS, then compares `app_id` and exact `origin`.                        | `node_modules/@cherrydotfun/miniapp-sdk/dist/index.mjs:501-518`                                                                | Treat `app_id` as app audience; test signature, expiry, `nbf`, app, and origin locally.                                        |
| The verifier does not pass an issuer constraint to `jose.jwtVerify`.                                                     | `node_modules/@cherrydotfun/miniapp-sdk/dist/index.mjs:502-506`                                                                | Loyal independently requires `iss === CHERRY_MINIAPP_ISSUER`.                                                                  |
| Default JWKS and issuer constants use `https://chat.cherry.fun`.                                                         | `node_modules/@cherrydotfun/miniapp-sdk/dist/index.mjs:501,521-528`                                                            | Defaults still require reconfirmation with Cherry before activation.                                                           |

`frontend/src/features/cherry/server/sdk-launch-token-contract.test.ts`
executes the installed verifier with an ephemeral RSA key and local JWKS. It
proves signature, `app_id`, exact origin, expiry, and `nbf` behavior without
network access.

### SDK questions that block financial activation

- Will Cherry bind bridge responses to the exact parent `event.origin` and
  `event.source`, or provide an SDK version/mitigation that does?
- Will Cherry fix `strict` so provider, client, and adapter all enforce it and
  provide a regression-tested release?
- Does `wallet.signTransaction` preserve every prior signature and the exact
  legacy/v0 message bytes, including lookup tables and sponsored transactions?
- Does batch signing preserve order atomically, and what are its count and byte
  limits?
- Can every supported Cherry mobile host sign without broadcasting?
- What stable codes distinguish rejection, disconnect, timeout, malformed
  transaction, and host RPC failure?

## Loyal integration inventory

| Surface                     | Current code                                                                                                                                                                                                                                          | Current behavior / Cherry implication                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider/selection          | `frontend/src/components/solana/wallet-provider.tsx`; `frontend/src/app/app/layout.tsx`                                                                                                                                                               | Standard-wallet discovery uses `wallets=[]` and wraps all `/app`. Inject/select Cherry only under `/app/cherry` without replacing standalone preference.                                                  |
| Auto reauth                 | `frontend/src/features/cherry/client/session-gate.tsx`; `frontend/src/components/auth/wallet-auto-reauth.tsx`                                                                                                                                         | Hydration waits for verified bridge wallet; a mismatched prior Loyal wallet session is logged out before re-auth.                                                                                         |
| Auth                        | `frontend/src/components/auth/use-wallet-proof-auth.ts`; `frontend/src/lib/auth/wallet-proof-flow.ts`; `frontend/src/lib/auth/wallet-proof-signer.ts`                                                                                                 | Supports SIWS, `signMessage`, and sign-only legacy transaction proof. Cherry exposes message/transaction signing but no adapter `signIn`; use message proof unless Cherry confirms SIWS.                  |
| Direct SOL/SPL send         | `frontend/src/hooks/use-send.ts`                                                                                                                                                                                                                      | Builds v0, calls adapter `sendTransaction`, then confirms. Cherry must sign only so this flow submits once through Loyal RPC.                                                                             |
| Swap                        | `frontend/src/hooks/use-swap.ts`                                                                                                                                                                                                                      | Jupiter v0 default uses `sendTransaction`; smart-account branch uses a separate execution context. Canary both.                                                                                           |
| Private send/Shield         | `frontend/src/hooks/use-private-send.ts`; `frontend/src/hooks/use-shield.ts`; `frontend/src/hooks/use-solana-wallet-data-client.ts`; `frontend/src/components/solana/private-client-preloader.tsx`; `frontend/src/lib/solana/private-client-cache.ts` | Passes single, batch, and message signing into the private client. Trace and canary the lower submission boundary.                                                                                        |
| Smart-account orchestration | `frontend/src/hooks/use-smart-account-sidebar-data.ts`                                                                                                                                                                                                | Important Earn stages use `signThenSendRaw: true`; other stages may retain adapter `sendTransaction` and must be normalized.                                                                              |
| Smart-account send core     | `packages/smart-account-vaults/src/wallet.ts`                                                                                                                                                                                                         | Prefers `wallet.sendTransaction`; otherwise signs then Loyal sends raw with ambiguous-send reconciliation. Batch always signs all and Loyal submits/confirms. Adapter shape selects submission ownership. |
| Earn UI/actions             | `frontend/src/components/wallet-workspace/facelift/use-earn-actions.ts`; `frontend/src/components/wallet-workspace/earn-transactions-pane.tsx`; `frontend/src/components/wallet-workspace/app-wallet-workspace.tsx`                                   | Policy, deposit, withdraw, autodeposit, cleanup/refund, batch, confirmation, and persistence each need evidence.                                                                                          |
| Loyal session               | `frontend/src/features/identity/server/session-cookie.ts`; `/api/auth/wallet/complete`; `/api/auth/session/refresh`; `/api/auth/logout`                                                                                                               | The top-level mobile WebView reuses the existing session; Cherry boot attestation cannot create or replace it.                                                                                            |
| Hosting                     | `frontend/next.config.ts`; `/app/cherry`                                                                                                                                                                                                              | Vercel hosts the page; existing `SAMEORIGIN` policy stays unchanged because no web iframe is in scope.                                                                                                    |
| Lifecycle/UI                | wallet workspace plus `frontend/src/features/realtime-sync`                                                                                                                                                                                           | Hide chooser/connect/disconnect only after verified Cherry mode; handle mobile safe areas, suspension, resume, rejection, timeout, and canonical refetch.                                                 |

Discovery is reproducible with:

```sh
rg -n "sendTransaction|signTransaction|signAllTransactions|signMessage" frontend/src
```

`crypto-page.tsx` and `app-wallet-workspace.tsx` initialize the private client
with the same signing trio and belong to Private send/Shield. `wallet-proof-*`
matches are sign-only auth. All other value-moving matches fall under Direct
Send, Swap, Smart-account orchestration, or Earn.

## Transaction submission ownership matrix

| Flow                     | Signer                 | Intended single submitter          | Confirmation/reconciliation                  |
| ------------------------ | ---------------------- | ---------------------------------- | -------------------------------------------- |
| Auth proof               | Cherry                 | None; never broadcast              | Loyal verifies proof                         |
| Direct SOL/SPL           | Cherry sign-only       | Loyal connection                   | `use-send.ts`                                |
| Jupiter swap             | Cherry sign-only       | Loyal connection                   | `use-swap.ts`                                |
| Private/Shield           | Cherry sign-only/batch | Existing private-client RPC layer  | Private-client result plus canonical refetch |
| Smart-account single     | Cherry sign-only       | `@loyal-labs/smart-account-vaults` | Package confirm/reconcile                    |
| Smart-account batch/Earn | Cherry batch sign-only | `@loyal-labs/smart-account-vaults` | Per-stage confirm plus Loyal persistence     |

No path may let `wallet.signAndSendTransaction` succeed and then call
`sendRawTransaction` for the same message. After a signature may have been
submitted, a timeout is unresolved and must reconcile before retry.

## Values required from Cherry

- Public Loyal group name and handle/URL.
- Staging and production MiniApp IDs.
- Registered staging and production origins.
- Manifest/registration with `wallet:connect`; do not request `inline:render`
  until Cherry sharing/blinks become an explicit product requirement.
- A staging group with at least two test users.
- Confirmation that the mobile WebView injects `window.__cherry = true` and
  exposes `ReactNativeWebView.postMessage` before launch.
- Confirmation of Solana behavior:
  - devnet support;
  - legacy and v0 transactions;
  - address lookup tables;
  - preservation of existing/partial signatures;
  - fee-payer requirements;
  - batch size and serialized transaction limits;
  - stable rejection, timeout, and disconnect error codes.
- Confirmation that the bridge binds messages to the registered parent origin
  and source, or an agreed SDK version/mitigation that does.
- A real fullscreen token fixture confirming the documented five-minute TTL.

## Runtime configuration

| Variable                  | Required | Purpose                                                                                                                        |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CHERRY_MINIAPP_ID`       | Yes      | Expected `app_id` in Cherry launch tokens.                                                                                     |
| `CHERRY_MINIAPP_ORIGIN`   | Yes      | Exact registered Loyal Mini App URL: `https://askloyal.com/app/cherry`. Cherry includes the path in the signed `origin` claim. |
| `CHERRY_MINIAPP_ISSUER`   | No       | Defaults to `https://chat.cherry.fun`.                                                                                         |
| `CHERRY_MINIAPP_JWKS_URL` | No       | Defaults to Cherry's public JWKS endpoint. A local endpoint may be used only by the development harness.                       |

The MiniApp ID is public configuration, not a secret. Launch tokens are
credentials and must never be written to logs, analytics, URLs controlled by
Loyal, or error details.

## Implemented mobile architecture

### Route and runtime

- `/app/cherry` is the only Cherry entry.
- It requires both `window.__cherry === true` and a callable
  `ReactNativeWebView.postMessage` before dynamically importing the SDK.
- A missing host, handshake timeout, unconfigured app, invalid token, wallet
  mismatch, or disconnect fails before the Loyal workspace mounts.
- Web iframe, cross-site-cookie, blink, Cherry navigation, and Privy work are
  deliberately absent from this mobile slice.

### Identity and existing Loyal auth

- The raw launch token is posted once to the same-origin, no-store launch
  endpoint and is never persisted.
- The server verifies RS256/JWKS, exact app and origin, issuer, expiry and
  not-before, issued-at, five-minute maximum lifetime, Solana `sub`, room, and
  `jti`.
- The response contains only the verified wallet, room, issued-at, and expiry.
- The bridge wallet must exactly equal the verified token wallet.
- Cherry connection is automatic. First-time Loyal authentication still uses
  the existing CAPTCHA and one wallet signature; the launch token does not
  create a Loyal session or spend onboarding sponsorship.

### Signing and submission

Loyal continues using its existing web3 transaction builders and confirmation
flows. The narrow Cherry adapter preserves connect, message signing, legacy/v0
single signing, and ordered batch signing. Its `sendTransaction` validates that
the message is unchanged, the Cherry wallet signature is valid, and existing
signatures survive; only then does it call Loyal's supplied
`Connection.sendRawTransaction` once. It never calls the stock host
`wallet.signAndSendTransaction` path or retries an ambiguous send.

### Mobile lifecycle and UI

- Cherry uses a separate wallet preference key and cannot overwrite the
  standalone wallet preference.
- Standalone wallet chooser/disconnect affordances are hidden only after the
  verified Cherry runtime is active; the existing Loyal flows stay intact.
- `suspended` unmounts the workspace, `resumed` remounts it from canonical
  state, and `walletDisconnected` blocks the app and best-effort logs out.
- Device-width viewport, `viewport-fit=cover`, and top/bottom safe areas are
  scoped to the mobile route.

## Fast test strategy

The subsecond loop uses the installed SDK with an in-memory WebView bridge and
ephemeral RSA/JWKS fixtures. It proves strict route gating, SDK init/timeout and
lifecycle, token claims, minimum response exposure, exact wallet equality,
message/legacy/v0/batch signing, prior-signature preservation, tamper rejection,
and exactly one Loyal RPC submission. No private key, remote RPC, real wallet,
or transaction broadcast is used.

Run the verifier in `cherry-mobile-verifier.md`. The Vercel deployment is the
production build gate; repository rules prohibit a local frontend build.

## Step-by-step completion plan

### 1. Local implementation — complete

1. Pin SDK `0.1.21` and keep all imports behind the dedicated client route.
2. Add fail-closed launch configuration and server attestation.
3. Add verified-wallet gating, the sign-only/Loyal-submit adapter, mobile
   viewport/safe areas, and lifecycle handling.
4. Run the focused contract loop, formatter, lint, type audit, and source audit.

### 2. Cherry provisioning — external input required

1. Create the public Loyal group in Cherry (in the app or at
   <https://chat.cherry.fun>).
2. Give Cherry the group name and the stable hosted URL
   `https://askloyal.com/app/cherry`.
3. Receive the staging MiniApp ID, registered exact app URL, staging group/test
   access, and confirmation of issuer/JWKS plus `wallet:connect` permission.
4. Configure `CHERRY_MINIAPP_ID` and
   `CHERRY_MINIAPP_ORIGIN=https://askloyal.com/app/cherry` on the deployment; override
   issuer/JWKS only if Cherry explicitly supplies different values.

### 3. Fast live ladder — stop at the first failure

1. Vercel build passes and `/app/cherry` rejects an ordinary mobile browser.
2. Cherry mobile opens it, completes `cherry:init` within 10 seconds, and the
   verified token wallet equals `wallet.connect`.
3. First-time CAPTCHA plus wallet proof succeeds; reload reuses the existing
   Loyal session without another onboarding mutation.
4. Reject one signature and prove zero RPC calls, then approve message signing.
5. On devnet, run one representative legacy transfer, one v0/ALT flow, and one
   batch/Earn preparation flow. For each, prove one Loyal broadcast, finalized
   confirmation, expected persistence/reconciliation, and authoritative
   before/after balances.
6. Background/resume, keyboard, safe areas, wallet disconnect, and reopen all
   recover cleanly; standalone Phantom/Solflare remains unchanged.
7. Inspect browser/network/server evidence for token, serialized-transaction,
   signed-message, and secret leakage.

Capture the deployed commit, SDK version, Cherry client, app ID (never the
token), wallet, cluster, transaction family, returned signature, confirmation
slot/status, persistence ID, and authoritative before/after state.

### 4. Production activation

After the devnet ladder and Cherry bridge-origin questions pass, configure the
production ID/origin. Any minimum-value mainnet canary requires separate user
approval. Monitor rejection, timeout, wallet-mismatch, and duplicate-submit
signals before widening access.

## Rollback

1. Remove/disable the Cherry ID and origin and redeploy; the route then fails
   before wallet or session work.
2. Ask Cherry to remove the registered URL if host access must stop immediately.
3. Reconcile any signature returned before rollback; never blindly retry an
   unresolved submission.
4. Smoke ordinary `/app` wallet selection, auth, Send, Swap, Smart Accounts,
   and Earn against authoritative state.

## Validation commands

```sh
git diff --check
bunx prettier --check frontend/src/features/cherry frontend/src/components/solana/wallet-provider.tsx frontend/src/app/app frontend/src/app/layout.tsx docs/integrations
bun --conditions=react-server test frontend/src/features/cherry
bun run frontend:lint
rg -n "cherry_embed|signAndSendTransaction|frame-ancestors|loyal_cherry_session" frontend/src frontend/next.config.ts
```
