# Solana Ledger Transaction-Proof Wallet Auth Verifier

Use this document as the fixed verifier for adding Ledger-compatible wallet auth
to Loyal web. The implementation passes only if Ledger or Ledger-backed wallet
users can authenticate through an explicit transaction-proof path while SIWS and
message-sign auth remain intact.

Do not run a frontend build for this verifier.

## Goal

Wallet auth must support three proof kinds:

- `siws` for wallets exposing `useWallet().signIn`;
- `message` for wallets exposing `useWallet().signMessage`;
- `transaction` for Ledger or hardware-backed users who opt into Ledger mode and
  can only provide `useWallet().signTransaction`.

All three proofs must end in the same server-verified onboarding path:
authenticated wallet address, smart-account provisioning or replay, JWT/session
cookie issuance, `refreshSession()`, and only then app unlock.

## Fixed PASS Conditions

Pass requires auth contracts to distinguish `kind: "transaction"` from
`"siws"` and `"message"`. Transaction challenge creation must require
`walletAddress`; transaction completion must accept a signed transaction payload
and must not accept client-supplied challenge text, memo contents, blockhash, or
fee payer as authority.

Pass requires transaction challenges to be server-owned. The challenge token
must bind:

- proof kind `transaction`;
- request origin;
- wallet address;
- exact auth memo text;
- serialized unsigned transaction shown to the wallet;
- issued time and expiration time.

Pass requires the unsigned transaction to be a login proof only:

- fee payer is the claimed wallet;
- exactly one instruction exists;
- the only instruction is the Solana Memo program;
- the memo data is the exact server-issued auth text;
- there are no transfer, token, address lookup, durable nonce, writable
  non-fee-payer, or extra program instructions.

Pass requires transaction completion to verify the signed transaction
adversarially:

- deserialize the signed transaction from the request safely;
- verify the fee payer derives to the authenticated wallet address;
- verify the fee-payer signature is present and cryptographically valid;
- reject wrong signer, changed memo, changed fee payer, extra instructions,
  missing signature, malformed bytes, and expired/origin-mismatched challenge
  tokens;
- tolerate wallet-refreshed blockhash/message bytes when the fee payer,
  memo-only instruction shape, and signature remain valid;
- tolerate wallet-added, account-less Compute Budget instructions while still
  requiring exactly one Memo instruction and rejecting Compute Budget
  instructions with accounts;
- derive the wallet address from the verified transaction fee payer and use that
  address for `subjectAddress`, `walletAddress`, smart-account provisioning, and
  completion idempotency.

Pass requires the Cap captcha to stay on challenge creation. Completion may
consume only the challenge token and wallet proof.

Pass requires replay and concurrent completion behavior to remain equivalent to
existing wallet auth. A transaction challenge may replay only to the same
completed auth result and must not create a second user, smart account, wallet
row, or provisioning result.

Pass requires the frontend to expose an explicit Ledger/hardware-wallet toggle
in the interactive wallet login form and any reconnect form that can trigger
wallet proof. When enabled, the flow must connect the selected wallet, skip SIWS
and message proof, and use `signTransaction` after the server returns a
transaction challenge. When disabled, existing behavior remains: prefer SIWS,
then message fallback.

Brave Wallet is an explicit exception: it must not expose or activate Ledger
mode because it validates `recentBlockhash` against the chain before signing the
deliberately non-broadcastable proof transaction. Brave Wallet must remain on
the SIWS/message path; a blockhash-validation refusal is an unsupported wallet
capability and must surface the self-serve fallback rather than a generic
signing failure.

Pass requires rejection semantics to be user-respectful. If the user rejects a
transaction proof, the UI must surface cancellation and must not immediately
surprise them with SIWS or message-sign fallback. Fallback between proof kinds is
only for unsupported capability or explicit user mode, not user denial.

Pass requires copy to accurately describe Ledger mode as a login verification
transaction that is not broadcast by Loyal, not a token transfer, not a deposit,
and not an on-chain action the app will submit.

Pass requires old legacy SIWS `/api/solana/create` and `/api/solana/verify`
routes to remain absent.

## Scope

In scope:

- `packages/auth-core` wallet auth contracts and challenge-token claims;
- `apps/web/src/app/api/auth/wallet/challenge`;
- `apps/web/src/app/api/auth/wallet/complete`;
- `apps/web/src/features/identity/server/wallet-onboarding*`;
- transaction-proof server helper code;
- `apps/web/src/lib/auth/wallet-proof-flow.ts`;
- `apps/web/src/lib/auth/wallet-proof-signer.ts`;
- `apps/web/src/components/auth/use-wallet-proof-auth.ts`;
- `apps/web/src/components/auth/wallet-tab.tsx`;
- `apps/web/src/components/auth/wallet-auto-reauth.tsx` only if needed to avoid
  auto-reauth attempting an impossible proof.

Out of scope:

- broadcasting the auth transaction;
- one-time trusted-device/passkey enrollment;
- replacing SIWS or message auth;
- frontend build verification;
- live human Ledger E2E.

## Required Evidence

Record exact commands or file inspections for each item:

- contract shape: schemas and types show `siws`, `message`, and `transaction`
  challenge and completion payloads;
- token claims: challenge token schemas bind transaction proof kind, origin,
  wallet address, memo text, and the unsigned transaction shown to the wallet;
- server challenge: code builds a memo-only transaction for the claimed wallet
  and stores the exact server-created proof data in the challenge token;
- server completion: code verifies the signed transaction against token claims,
  rejects memo/account/instruction/signature mutation, derives wallet address
  from fee payer, and then uses the same onboarding/session issuance path;
- frontend Ledger mode: login form exposes a Ledger/hardware toggle and selected
  wallets route to transaction proof when enabled, while Brave Wallet hides the
  toggle and remains on the SIWS/message path;
- fallback preservation: existing SIWS and message flows remain reachable when
  Ledger mode is disabled;
- rejection behavior: rejected transaction signing maps to a cancellation state
  without auto-triggering another proof prompt;
- unsupported wallet behavior: Brave Wallet's blockhash-validation refusal maps
  to `wallet_signing_unsupported` and the self-serve fallback message;
- legacy route status: `/api/solana/create` and `/api/solana/verify` are absent;
- static checks: focused commands below.

## Focused Checks

Do not run `bun run frontend:build`, `bun run build`, or `cd apps/web && bun
run build` for this verifier.

Run:

```sh
bun run --cwd packages/auth-core test
```

```sh
bun test apps/web/src/features/identity/server/wallet-auth-transaction.test.ts
```

```sh
./node_modules/.bin/tsc --noEmit --project apps/web/tsconfig.json --pretty false
```

```sh
bun run --cwd frontend lint
```

Required negative inspections:

```sh
test ! -e apps/web/src/app/api/solana
```

```sh
rg -n "/api/solana/(create|verify)|createSignInData|verifySIWS" apps/web/src/components apps/web/src/contexts apps/web/src/lib/auth apps/web/src/app/api/auth -S
```

Expected result: no product-auth hits; `apps/web/src/app/api/solana` should not
exist.

```sh
rg -n "kind: \"transaction\"|signTransaction|MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" packages/auth-core/src apps/web/src/features/identity apps/web/src/lib/auth apps/web/src/components/auth -S
```

Expected result: all transaction-proof logic lives in the auth contract,
identity server, auth proof helpers, or auth UI components.

## Test Expectations

Focused tests are justified because wallet auth is an external security
boundary and transaction mutation would still compile while broken.

Keep tests focused on observable invariants:

- verifies a real signed memo-only transaction and derives the wallet address;
- rejects changed memo;
- rejects changed fee payer;
- rejects extra instruction;
- accepts account-less Compute Budget instructions added by a wallet adapter;
- rejects Compute Budget instructions with accounts;
- rejects missing or wrong signer;
- accepts wallet-refreshed blockhash/message bytes when the fee payer, memo-only
  instruction shape, and signature remain valid;
- preserves existing SIWS verification test and message-token test.

Do not add tests that merely mirror schema field lists, component copy, object
defaults, route strings, or third-party library behavior.

## Final Verdict Format

Use this format when reporting completion:

```text
Verdict: PASS | FAIL

Evidence
contract shape: <file/command/result>
token claims: <file/command/result>
server challenge: <file/command/result>
server completion: <file/command/result>
frontend Ledger mode: <file/command/result>
fallback preservation: <file/command/result>
rejection behavior: <file/command/result>
legacy route status: <command/result>
focused checks: <command/result>

Remaining gaps: <none, or exact blocker>
```
