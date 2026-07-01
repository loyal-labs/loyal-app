# Smart Account Signer Onboarding Verifier

## Goal

Prove that a generated mainnet wallet can be added as an active root
`Settings` signer to the smart account controlled by `SOLANA_TESTING_PK`, sign
in through the existing wallet auth flow, resolve to that existing smart
account without sponsoring a new personal smart account, and then be removed
cleanly.

This verifier is backend-compatible only. The current frontend session contract
must remain unchanged: wallet auth still returns `smartAccountAddress` and
`settingsPda`, and account switching is out of scope.

## Fixed PASS Checks

Pass requires root `Settings` signer support. Policy-scoped signer membership
must not be treated as an identity signer for wallet auth onboarding in this
verifier.

Pass requires schema support for durable signer-change request lifecycle in
`app_smart_account_settings_change_requests`. The table must record environment,
settings PDA, requested signer, root signer scope, action, status, idempotency
key, transaction/signature metadata, confirmed slot/time, error details, and
timestamps. Valid statuses must distinguish at least draft or requested,
submitted, confirmed, failed, and canceled or superseded states. Duplicate
requests for the same idempotency key must converge on the same row.

Pass requires an active signer read model in `app_smart_account_signers`. The
table must be keyed so one wallet cannot appear twice for the same environment
and settings PDA at root scope. It must store the smart account address,
settings PDA, signer wallet address, scope, active/removed state, observed
permissions or permission mask, source signature or slot metadata, last checked
time, and an optional `user_id` link. The `user_id` link may be populated only
after wallet auth proves ownership of that signer wallet.

Pass requires no misuse of `app_user_wallets`. That table remains the verified
wallet-to-user attachment created by wallet auth. It must not be pre-populated
by a signer-change request or by chain reconciliation before the generated
wallet signs the auth challenge.

Pass requires `Settings` chain state to stay the source of truth. Request rows
and signer rows are lifecycle and read-model records. A stale DB signer row must
not allow onboarding when the signer is no longer active on-chain.

Pass requires wallet auth completion to preserve the existing response shape.
The backend may internally select a personal or delegated smart account, but the
completed session user and API response must still expose `smartAccountAddress`
and `settingsPda` exactly as existing callers expect.

Pass requires onboarding resolution order to be deterministic:

1. If the signed-in wallet already owns a ready personal smart account for the
   active environment, use that personal smart account.
2. Otherwise, if the signed-in wallet is an active root `Settings` signer on
   one or more smart accounts, use the latest deterministic active delegated
   membership.
3. Otherwise, sponsor a new personal smart account through the existing
   provisioning path.

The delegated membership tiebreaker must be deterministic, documented in code,
and covered by tests. Prefer the latest active membership by confirmed slot and
then a stable secondary key such as settings PDA.

Pass requires extending the existing smart-account settings transaction helpers
and scripts. The implementation must not create a parallel harness for signer
changes. Add root `AddSigner` and `RemoveSigner` flows using the existing
`createSettingsTransaction` and `executeSettingsTransaction` or synchronous
settings execution surfaces, and keep signing/execution semantics consistent
with existing smart-account scripts.

## Mainnet Proof

The opt-in verifier must run only through 1Password:

```sh
op run --env-file=.env.1password -- sh -c '<command>'
```

The proof must generate a new temporary keypair and print only its public
address unless an explicit cleanup mode needs the encrypted or local temp
secret. Do not commit or log key material.

The proof must use `SOLANA_TESTING_PK` as the current root `Settings` signer for
the target mainnet smart account. Transaction submission still requires
explicit human approval during implementation.

The proof must:

1. Resolve the `SOLANA_TESTING_PK` smart account and settings PDA on mainnet.
2. Generate a new wallet address for the delegated signer.
3. Submit or execute a root `Settings` `AddSigner` change for that wallet.
4. Confirm the transaction and re-fetch chain `Settings` state showing the
   generated wallet as an active root signer.
5. Reconcile DB request and signer read-model rows.
6. Complete wallet auth as the generated wallet.
7. Prove the auth session resolves to the existing smart account and settings
   PDA, with no new sponsored personal smart account row or sponsorship
   transaction for the generated wallet.
8. Submit or execute a root `Settings` `RemoveSigner` change for that wallet.
9. Confirm chain `Settings` state no longer includes the generated wallet.
10. Reconcile DB rows so the signer row is removed or inactive and the request
    lifecycle is terminal.

## Failure Cases

Pass requires focused coverage for these cases:

- A stale active DB signer row exists, but the signer has been removed on-chain.
- The signer is removed on-chain between selection and session completion.
- A duplicate signer-change request uses the same idempotency key.
- A request references a settings PDA that does not belong to the expected smart
  account or environment.
- A policy-scoped signer is present, but the wallet is not a root `Settings`
  signer.
- A first-time signer has multiple delegated root memberships and no personal
  smart account.
- A wallet has both a ready personal smart account and delegated memberships;
  the personal smart account wins.

## Required Evidence

Record the exact command or inspection used for each item:

For schema, record the migration and shared `@loyal-labs/db-core/schema`
definitions for `app_smart_account_settings_change_requests` and
`app_smart_account_signers`, including statuses, unique indexes, ownership
checks, root signer scope, and nullable user link behavior.

For backend contract, record where wallet auth completion still builds the
existing session user with `smartAccountAddress` and `settingsPda`, and where
the resolver selects personal account, delegated signer account, or sponsored
account in that order.

For chain reconciliation, record where root `Settings` signers are fetched from
chain and used to upsert or deactivate `app_smart_account_signers` rows. Record
the guard that prevents stale DB rows from authenticating a removed signer.

For SDK and script surface, record focused tests proving root `AddSigner` and
`RemoveSigner` settings actions are built correctly through existing
smart-account helpers. Record the opt-in verifier command or script path.

For backend tests, record focused output for onboarding selection, delegated
login with no sponsorship, personal-account precedence, duplicate request
idempotency, signer read-model reconciliation, stale signer rejection, and the
multiple-membership tiebreaker.

For mainnet proof, record read-only DB checks showing:

- The settings-change request row was created, submitted, and confirmed.
- The signer read-model row is active after add.
- The generated wallet gets an `app_user_wallets` row only after auth.
- No personal `app_user_smart_accounts` row is sponsored for the generated
  wallet during delegated login.
- The signer row becomes removed or inactive after cleanup.

Do not run a frontend build for this verifier.

## Iteration Rules

Run the verifier slowly and in order. It is acceptable for an iteration to fail
while exposing the next real gap. Do not change the goal to match the current
implementation. Preserve the PASS checks above, make the smallest correct
change, and run the next focused check.

Keep chain transaction submission behind explicit approval. Until approval is
given, stop at dry-run, prepared transaction, or read-only proof.

## Final Verdict Format

Use this format when reporting completion:

```text
Verdict: PASS | FAIL

Evidence
schema shape: <file/command/result>
request lifecycle: <file/command/result>
chain reconciliation: <file/command/result>
onboarding selection: <file/command/result>
backend contract: <file/command/result>
SDK/script surface: <file/command/result>
mainnet add/remove proof: <command/result>
no unintended sponsorship: <query/result>
focused tests: <command/result>

Remaining gaps: <none, or exact blocker>
```
