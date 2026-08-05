# Cherry mobile verifier result (ASK-1931)

Run date: 2026-08-03

Branch: `ASK-1931-integrate-cherry-fun`

Local verdict: **PASS**

Live verdict: **BLOCKED**

## M1. Scope and fail-closed boot — PASS

- `/app/cherry` is the sole entry and requires both the Cherry marker and a
  callable native WebView transport before the SDK is dynamically imported.
- Ordinary routes render the existing app and perform no Cherry SDK/bridge
  call. Missing host signals show only the unavailable screen.
- Missing app ID/origin leaves server configuration disabled.
- The final forbidden-surface search found no source occurrence of
  `cherry_embed`, `signAndSendTransaction`, `frame-ancestors`, or
  `loyal_cherry_session`; web iframe/cookie/blink/Privy work is absent.

Evidence: `entry.ts`, `client/runtime-boundary.tsx`, `config.ts`, route-contract
tests, and the M5 search.

## M2. Verified identity before Loyal starts — PASS

- Installed-SDK RSA/JWKS fixtures exercise one complete signed launch through
  both SDK and Loyal validation, plus trusted key, exact app/origin, expiry,
  not-before, issuer, and maximum-lifetime failures.
- Loyal additionally enforces exact issuer, Solana `sub`, room, `jti`, integer
  issued-at/expiry, future skew, expiry, and a five-minute maximum lifetime.
- The same-origin, no-store endpoint returns only wallet, room, issued-at, and
  expiry; it returns no token, `jti`, cookie, or sensitive error.
- The workspace remains blocked until the connected Cherry wallet exactly
  equals verified `sub`; a prior Loyal session for another wallet is logged out
  before any auth/realtime/workspace child mounts.
- The token is boot attestation only. Existing CAPTCHA and wallet-proof auth
  remain mandatory for a first-time Loyal session.

Evidence: `server/sdk-launch-token-contract.test.ts`, `launch-token.test.ts`,
`launch-attestation.test.ts`, and `client/runtime-contract.test.ts`.

## M3. One signer, one submitter — PASS

- The adapter preserves connect, message signing, legacy/v0 signing, ordered
  batch signing, additional signers, and caller send options.
- Before RPC, it proves unchanged message bytes, a valid Cherry wallet
  signature, and preserved prior signatures.
- Its legacy and v0 send paths call the supplied Loyal
  `Connection.sendRawTransaction` exactly once. Mutation, invalid signature,
  removed prior signature, rejection, batch reordering, suspend, or disconnect
  produces zero RPC calls; an ambiguous RPC failure is not retried.
- Existing transaction hooks have no Cherry-specific branch.

Evidence: eleven real serialized-transaction/bridge tests in
`client/wallet-adapter.test.ts` and the clean forbidden-surface search.

## M4. Lifecycle and mobile shell — PASS

- A real RS256/JWKS contract test crosses the pinned SDK and Loyal launch-token
  boundary without replacing the verifier with a mock.
- Runtime-contract tests prove exact-route signals, exact wallet/session
  equality, synchronous lifecycle invalidation, suspend/resume behavior, and
  irreversible disconnect state.
- Production listeners attach before launch attestation. Suspend/disconnect
  invalidates the shared operation lease synchronously, so late host signatures
  cannot escape to auth or RPC; disconnect also blocks and best-effort logs out.
- The route exports device width, initial scale, and `viewport-fit=cover`; safe
  areas are route-scoped. Cherry and standalone use different wallet keys.

Evidence: `server/sdk-launch-token-contract.test.ts`,
`client/runtime-contract.test.ts`, `runtime-embedded.tsx`,
`/app/cherry/layout.tsx`, and `globals.css`.

## M5. Fast validation and external truth — PASS locally

- `git diff --check`: pass.
- Required Prettier check: pass.
- Focused Cherry suite: **43 pass, 0 fail**.
- `bun run frontend:lint`: exit 0; warnings are existing or unchanged lint
  classes, with no errors.
- Forbidden-surface search: no matches.
- Frontend project TypeScript still fails on the existing unbuilt internal
  workspace-package baseline; filtering that exact run to all changed Cherry,
  provider, auth, shell, and route files returned no errors.
- Local frontend production build: intentionally not run by repository rule.

## Why live remains blocked

LOCAL PASS proves the Loyal code and deterministic SDK contracts; it does not
prove a Cherry host. LIVE PASS still requires:

- public Cherry group name/URL, created by Loyal;
- stable deployed Vercel `/app/cherry` URL and successful Vercel build;
- MiniApp ID supplied by Cherry, exact registered origin, issuer/JWKS, and
  `wallet:connect` permission;
- real Cherry mobile launch token and controlled devnet wallet;
- confirmation that the host delivers/retries `cherry:init` after the page SDK
  listener is ready;
- load/init, exact wallet match, first-time auth, reload, suspend/resume,
  keyboard/safe-area, disconnect/reopen, and standalone regression canaries;
- rejection with zero broadcast and confirmed single-broadcast legacy, v0/ALT,
  and batch/Earn representative flows with reconciliation evidence;
- network/log inspection for token, message, transaction, and secret leakage;
- Cherry resolution of bridge message source/origin binding and strict SDK
  detection before financial activation.

The step-by-step live ladder is in `cherry-miniapp.md`.
