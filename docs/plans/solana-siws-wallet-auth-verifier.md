# Solana SIWS Wallet Auth Verifier

Use this document as the fixed verifier for making Wallet Standard
`solana:signIn` the preferred Loyal web wallet-auth proof while preserving the
existing message-sign fallback.

Do not treat this as an implementation checklist. The work passes only when a
skeptical runner can verify the end-state from repo code, focused contract
tests, and targeted static checks. Do not run a frontend build for this
verifier.

## Goal

Loyal web wallet auth must support one-approval Sign In With Solana for wallets
that expose `useWallet().signIn`, then issue the same auth session, smart
account session fields, and JWT cookie only after the server verifies the SIWS
proof.

Wallets without `signIn` must keep using the current `connect()` plus
`signMessage()` proof. SIWS support must not weaken the existing message-sign
auth path, Cap captcha boundary, replay/idempotency behavior, or
auth-session-only app gate.

## Fixed PASS Conditions

Pass requires the product auth path to be
`/api/auth/wallet/challenge` and `/api/auth/wallet/complete`. Legacy
`/api/solana/create` and `/api/solana/verify` routes must not be present.

Pass requires wallet auth challenge and completion contracts to distinguish
proof kind:

- `kind: "siws"` challenge does not require a wallet address;
- `kind: "message"` challenge requires the wallet address exactly as the
  current flow does;
- completion accepts a discriminated proof payload instead of treating every
  completion as a raw message signature.

Pass requires SIWS challenge creation to be server-owned. The challenge token
must bind the exact `SolanaSignInInput` to verify, including proof kind,
origin, domain, URI, chain ID, nonce, issued time, expiration time, and
statement. The completion route must not trust a SIWS input supplied by the
client.

Pass requires SIWS verification to derive the authenticated wallet address from
the wallet output, not from client request data. The server must:

- deserialize `account.publicKey`, `signedMessage`, and `signature` from JSON
  safely;
- reject non-Ed25519 `signatureType`;
- run `verifySignIn(serverStoredInput, output)`;
- verify the public key derives to `output.account.address`;
- use the derived address as `subjectAddress` and `walletAddress` for the same
  user/smart-account/session issuance path as current wallet auth.

Pass requires domain and URI to match the request origin. Local, preview, and
production origins must not display a stale hardcoded production domain in the
wallet prompt. Chain IDs used in SIWS must be Wallet Standard chain identifiers
such as `solana:mainnet` and `solana:devnet`, not app-internal strings like
`mainnet` or `devnet`.

Pass requires the Cap captcha to remain on challenge creation. Completion may
consume only the issued challenge token and wallet proof.

Pass requires replay and concurrent completion handling to remain equivalent to
the existing wallet-auth completion behavior. A completed challenge may replay
only to the same completed auth result; duplicate completion must not create a
second user, smart account, wallet row, or session-side provisioning result.

Pass requires the frontend to prefer SIWS only when the selected wallet adapter
exposes `signIn`. The SIWS path must call `signIn(signInInput)` without a prior
wallet `connect()` approval. The message fallback path must remain available
when `signIn` is unsupported.

Pass requires rejection semantics to be user-respectful: if a user rejects a
SIWS prompt, the UI must surface cancellation and must not immediately surprise
them with the message-sign fallback. Fallback is for unsupported capability or
configuration errors, not user denial.

Pass requires the app to become signed in only after server verification,
smart-account provisioning or replay, session cookie issuance, and
`refreshSession()`. Wallet connection alone must not unlock the signed-in app.

## Scope

In scope:

- `packages/auth-core` wallet auth contracts and challenge-token claims;
- `frontend/src/app/api/auth/wallet/challenge`;
- `frontend/src/app/api/auth/wallet/complete`;
- `frontend/src/features/identity/server/wallet-onboarding*`;
- `frontend/src/components/auth/use-wallet-proof-auth.ts`;
- client auth API helpers and wallet proof helpers;
- focused contract/security tests for SIWS and message fallback.

Out of scope:

- transaction-proof Ledger fallback for direct Ledger/WebHID adapters;
- removing the message-sign path;
- broad wallet-provider redesign;
- frontend build verification;
- live wallet E2E requiring a human wallet prompt.

## Required Evidence

Record exact commands or file inspections for each item:

- contract shape: schemas and types showing discriminated challenge and
  completion payloads for `siws` and `message`;
- SIWS challenge: server code showing no wallet address is required and the
  challenge token stores the exact server-created `SolanaSignInInput`;
- SIWS completion: server code showing client-supplied SIWS input is ignored or
  not accepted, `verifySignIn` runs against token claims, and the wallet address
  is derived from output public key;
- fallback preservation: server and client code showing current message-sign
  verification still works for wallets without `signIn`;
- frontend preference: hook code showing selected adapters with `signIn` use
  SIWS first, unsupported adapters use the message fallback, and rejected SIWS
  does not auto-trigger a second prompt;
- session gate: code showing session refresh and modal close still happen only
  after completion returns a user;
- legacy route status: evidence that `/api/solana/create` and
  `/api/solana/verify` are absent;
- static checks: focused typecheck/lint/test commands listed below.

## Focused Checks

Do not run `bun run frontend:build`, `bun run build`, or `cd frontend && bun
run build` for this verifier.

Run targeted checks that match the changed surface. Use package-native
equivalents if script names differ:

```sh
bun run --cwd packages/auth-core test
```

```sh
./node_modules/.bin/tsc --noEmit --project frontend/tsconfig.json --pretty false
```

```sh
bun run --cwd frontend lint
```

Required negative inspections:

```sh
rg -n "/api/solana/(create|verify)|createSignInData|verifySIWS" frontend/src/components frontend/src/contexts frontend/src/lib/auth frontend/src/app/api/auth -S
```

Allowed matches are shared SIWS helpers and this verifier. Product auth UI and
`/api/auth/wallet/*` completion must not call legacy `/api/solana/*` routes,
and the legacy `/api/solana/create` and `/api/solana/verify` route files should
not exist.

```sh
rg -n "chainId: solanaEnv|chainId.*mainnet|chainId.*devnet|DOMAIN_NAME" frontend/src/lib/solana frontend/src/features/identity packages/auth-core -S
```

Any remaining app-internal SIWS chain ID or hardcoded production domain must be
dead legacy code or explicitly outside the product auth path.

## Test Expectations

Focused tests are justified because wallet auth is an external security
contract. They should assert observable invariants, not implementation mirrors:

- SIWS challenge succeeds without `walletAddress` and stores server-created
  input in the challenge token;
- SIWS completion rejects when the output signs a different nonce, domain, URI,
  chain ID, statement, or address than the token claims;
- SIWS completion rejects malformed byte arrays, non-Ed25519 signatures, and
  public-key/address mismatch;
- message completion still verifies the existing text signature path;
- duplicate completion for the same challenge converges on one provisioning
  result;
- frontend proof selection prefers `signIn` when present and does not fallback
  after user rejection.

## Final Verdict Format

Use this format when reporting completion:

```text
Verdict: PASS | FAIL

Evidence
contract shape: <file/command/result>
siws challenge: <file/command/result>
siws completion: <file/command/result>
message fallback: <file/command/result>
frontend preference: <file/command/result>
session gate: <file/command/result>
legacy route isolation: <command/result>
focused checks: <command/result>

Remaining gaps: <none, or exact blocker>
```
