# Loyal Webapp Error Remediation Verifier

Run this verifier cold from `/Users/taequn/loyal/loyal-apps`. Treat it as the
fixed definition of done for the Loyal-owned web/backend errors observed around
the same-mint stablecoin release. Report PASS or FAIL for every Required
section. Overall local PASS requires every Required section; production remains
`LIVE PENDING` until the tested commit is deployed and observed. Never run a
local frontend build.

## Goal

Prove that one malformed Wallet Standard provider cannot crash Loyal web; Earn
withdrawal preparation uses one current, mint-specific source and fails with a
stable recoverable response when that source or a required on-chain account
changes; replaying confirmation after an on-chain success repairs persistence
without another withdrawal; and statusless prepare failures carry bounded,
privacy-safe diagnostics that identify the failed boundary.

## Required 1: Scope and safety

- The diff changes only the verifier, Loyal web/mobile request diagnostics, the
  shared Earn withdrawal package/server boundary, and the smallest dependency
  patch needed for Wallet Standard containment.
- No route-policy bytes, policy creation, user policy account, database schema,
  yield-routing worker, autodeposit behavior, feature flag, or stablecoin
  visibility changes.
- Existing policies are never migrated or updated. No verifier submits a Solana
  transaction. New mints remain dark.

## Required 2: Wallet Standard containment

- The production Wallet Standard adapter path handles a wallet whose declared
  transaction-signing feature omits, nulls, or supplies a non-array
  `supportedTransactionVersions` value without throwing.
- A valid legacy-only wallet still maps to `null`; a valid `legacy + 0` wallet
  still maps to a set containing both versions. The guard does not invent
  signing capabilities.
- The focused verifier exercises the patched runtime code, not a duplicate
  Loyal-only predicate. `rg` proves no hand-edited tracked `node_modules` file.

## Required 3: Current withdrawal source and typed failure

- Web and mobile prepare-context paths force a live holdings reconciliation,
  then select exactly one source by the complete source ID. The prepared source
  preserves mint, token program, market, reserve, obligation-derived accounts,
  and selected amount. There is no USDC or alternate-reserve fallback.
- A missing, duplicated, zeroed, changed-mint, changed-token-program, changed-
  market, or changed-reserve source returns HTTP 409 with
  `earn_withdraw_source_changed` (or the existing more specific source/amount
  conflict code) and does not invoke instruction construction.
- A stale KLend market/reserve discovered during preparation is normalized to a
  stable recoverable response after the one forced refresh; raw vendor errors
  and stacks are not returned to clients.

## Required 4: Full-withdraw account drift

- The shared SDK obtains a fresh confirmed account/blockhash view immediately
  before the full-withdraw prefix simulation.
- A genuinely absent optional zero-balance token account is treated as zero.
  A missing required reserve, market, obligation, policy, or lookup-table input
  fails before wallet submission with a typed, caller-safe error naming the
  account role—not a raw `AccountNotFound` simulation dump.
- Preparation performs at most one bounded refresh/retry and never retries,
  signs, sends, changes policies, or changes the selected mint/source.
- Partial and full paths retain exact-output/underfill protection and support
  SPL Token plus Token-2022 destinations.

## Required 5: Confirmed-chain persistence recovery

- Confirmation is idempotent by signature and authenticated principal. Replaying
  the identical confirmed withdrawal returns the recorded/repaired state and
  creates no second withdrawal or holding debit.
- Same signature with different principal or canonical metadata fails closed.
- If chain confirmation succeeded but the first backend-confirm request failed,
  the client preserves the signature/slot, displays a confirmed-but-syncing
  result, and retries only backend confirmation. It never calls wallet signing
  or transaction submission again.

## Required 6: Actionable, safe diagnostics

- Every web/mobile Earn prepare request propagates one canonical
  `x-loyal-flow-id` to its server route.
- A no-response failure is classified as one of the existing bounded detail
  tokens (`network_unreachable`, `request_timeout`,
  `kamino_upstream_unavailable`, or `rpc_request_failed`) when evidence exists;
  an HTTP response records its bounded status. Unknowns remain generic rather
  than guessed.
- Diagnostics include the bounded client platform/build fields already allowed
  by the lifecycle contract and never contain wallet addresses, signatures,
  amounts, URLs with queries, raw errors, headers, auth material, or RPC bodies.
- Only idempotent prepare/context reads may retry once on a transient transport
  failure. Wallet approval, transaction submission, and confirmation mutation
  are never automatically replayed.

## Required 7: Executable verification

Add or extend one focused verifier script and run it against production modules.
It must fail before the remediation and print per-check PASS/FAIL plus a final
verdict. Required commands:

```sh
bun --conditions=react-server scripts/verify-loyal-webapp-error-remediation.ts
bun run --cwd packages/smart-account-vaults typecheck
bunx tsc --noEmit -p apps/web/tsconfig.json
bun run --cwd frontend lint
git diff --check
```

Do not run `frontend:build`. Tests are justified only for money-movement
idempotency or an external dependency contract that compiles while broken.

## Production follow-up

After deployment, query ClickStack by the tested release for at least one real
successful web withdrawal and one mobile prepare attempt. Mark
`PRODUCTION VERIFIED` only if the malformed-wallet `.length` signature and raw
full-withdraw `AccountNotFound` do not recur, source drift is a typed 409, and
statusless failures include a bounded detail or are explicitly unknown. Absence
of traffic is `LIVE PENDING`, never PASS.

## Verdict format

```text
Verdict: PASS | FAIL
Production: VERIFIED | LIVE PENDING | REGRESSION

scope/safety: <evidence>
wallet containment: <evidence>
source drift: <evidence>
full-withdraw drift: <evidence>
confirmation replay: <evidence>
diagnostics/privacy: <evidence>
commands: <exact commands and results>
remaining gaps: <none or exact failures>
```
