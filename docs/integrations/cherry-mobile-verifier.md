# Cherry mobile verifier-first plan

The standing goal was tool-counted at **3,962 bytes** before it was created.
The implementation plan is intentionally five lines:

1. Freeze the adversarial verifier and capture the focused baseline.
2. Add strict mobile boot, the dedicated route, viewport, and safe areas.
3. Verify launch identity and bridge-wallet equality before existing auth.
4. Add Cherry-sign/Loyal-submit transaction ownership and lifecycle failure handling.
5. Run the subsecond focused loop, lint once, and separate local from live truth.

## Standing verifier

Adversarially inspect the current implementation; documentation is not proof.
Report M1-M5 PASS/FAIL with command/file evidence, followed by LOCAL PASS/FAIL
and LIVE BLOCKED/PASS. Never run a local frontend production build.

### M1. Scope and fail-closed boot

Only `/app/cherry` may enter Cherry mode, and only when
`window.__cherry === true` and `window.ReactNativeWebView.postMessage` is
callable. Ordinary `/app` routes keep their provider/UI and make zero Cherry
calls. The Cherry route without that transport, `cherry_embed=1` alone, generic
iframes, and `ReactNativeWebView` alone show an unavailable state and make zero
SDK/auth calls. Missing MiniApp ID/origin fails non-sensitively. Add no framing,
iframe-cookie, blink, navigation, or Privy work.

### M2. Verified identity before Loyal starts

Ephemeral RS256/JWKS fixtures must prove exact app ID, origin and issuer;
`exp`/`nbf`/`iat`; maximum five-minute lifetime; Solana `sub`; room and `jti`.
Wrong, stale, overlong, or tampered values fail closed. Workspace and signing
stay blocked until bridge wallet equals verified `sub`. The token is boot
attestation only: it does not issue a Loyal session or bypass the existing
CAPTCHA plus wallet proof. Token/JWT never enters Loyal URLs, persistent
storage, responses, analytics, or logs.

### M3. One signer, one submitter

The adapter preserves connect, message, legacy/v0 single and ordered batch
signing. For unsigned transactions, `sendTransaction` accepts only the bounded
Seeker/MWA changes of a replaced recent blockhash, reordered static keys from a
full message recompile, and inserted read-only Compute Budget, Lighthouse, or
Memo instructions. It still requires the same transaction type/version, fee
payer, address-table lookups, signer counts, original key permission classes,
and original instructions/accounts/data in order. Any transaction with a prior
signature must retain byte-identical message bytes. After validating the Cherry
wallet signature and preserving prior signatures, it calls Loyal's supplied
`Connection.sendRawTransaction` exactly once. It never invokes host
`signAndSendTransaction` or automatically retries an ambiguous send. Real
serialized deterministic fixtures must prove the allowlisted modifications are
accepted while unauthorized mutations, invalid signatures, and prior-signature
changes perform zero RPC calls. Existing transaction hooks gain no Cherry
branches.

### M4. Lifecycle and mobile shell

Tests must prove SDK init pending/success/fast timeout, wallet match/mismatch,
suspend unmount, resume remount, and disconnect fail-closed plus best-effort
logout. The route exports device width, initial scale, `viewport-fit=cover`, and
mobile-only safe areas. Before launch/wallet verification it shows only compact
loading/error UI. Standalone wallet preference stays on its existing key;
Cherry uses a separate key.

### M5. Fast validation and external truth

Run:

```sh
git diff --check
bunx prettier --check frontend/src/features/cherry frontend/src/components/solana/wallet-provider.tsx frontend/src/app/app frontend/src/app/layout.tsx docs/integrations
bun --conditions=react-server test frontend/src/features/cherry
bun run frontend:lint
rg -n "cherry_embed|signAndSendTransaction|frame-ancestors|loyal_cherry_session" frontend/src frontend/next.config.ts
```

Explain every search match. LOCAL PASS uses deterministic fixtures and never
claims a working Cherry host. LIVE PASS also requires Vercel's build, a
provisioned Cherry WebView/token, exact wallet match, first-time auth, reload,
background/resume, keyboard/safe areas, devnet single broadcast plus
confirmation for representative legacy/v0/batch flows, no leakage, standalone
regression, and config-off rollback. Without MiniApp ID, group, and host access,
LIVE is BLOCKED.
