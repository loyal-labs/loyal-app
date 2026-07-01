# Earn Autodeposit Scheduled Transactions Verifier

## Goal

The Earn transactions pane must show real scheduled Autodeposit sweeps from
`earn-state` and let a signed-in user request immediate execution through the
existing worker-bound endpoint. The UI must not include placeholder scheduled
rows, and the frontend must not submit sweep transactions.

## Fixed PASS Checks

Pass requires the `earn-state` response to serialize open surplus lots as
`autodeposit.scheduledSweeps`. Each serialized lot must carry its id, remaining
raw amount, eligibility time, classification, confidence value, reason text, and
status.

Pass requires the transactions pane to render scheduled rows from
`autodepositConfig.scheduledSweeps`. The row must show the formatted amount,
formatted time, `Main -> Earn`, `Autodeposit`, and an `Execute now` action. The
static placeholder values `Tomorrow at 18:06` and `334.48 USDC` must not remain
as rendered data.

Pass requires no `Scheduled` section when `scheduledSweeps` is empty. Scheduled
rows must still render when confirmed Earn transaction history is empty.

Pass requires `Execute now` to post to
`/api/smart-accounts/yield-optimization/autodeposit/sweeps/execute` with the
active auth session. The UI must show pending/error state, refresh `earn-state`
after success, and invalidate Earn transaction caches.

Pass requires execution to remain worker-bound. The endpoint may accelerate
eligible open surplus lots, but the frontend must not build, sign, or submit
sweep transactions.

## Iteration Rules

Run the verifier slowly and in order. It is acceptable for an iteration to fail
while exposing the next real gap. Do not change the goal to match the current
implementation. Preserve the PASS checks above, make the smallest correct
change, and run the next focused check.

Tests come after the UI/API path is integrated. Do not begin this pass by
writing tests around the old placeholder behavior.

## Required Evidence

Record the exact command or inspection used for each item:

For code inspection, record where `earn-state` includes `scheduledSweeps` from
open surplus lots and where `AppWalletWorkspace` passes those sweeps into the
transactions pane.

For tests, record focused output for the scheduled amount/time/section helpers,
loaded autodeposit config preserving non-empty `scheduledSweeps`, and the
execute route branches: `401`, `404`, inactive `409`, no-sweeps `409`, and
success serialization.

For commands, record lint output for
`src/components/wallet-workspace/earn-transactions-pane.tsx` and
`src/components/wallet-workspace/app-wallet-workspace.tsx`, plus output from
`bun scripts/verify-earn-autodeposit-persistence.ts`.

Do not run a frontend build for this verifier.

## Final Verdict Format

Use this format when reporting completion:

```text
Verdict: PASS | FAIL

Evidence
earn-state scheduledSweeps: <file/command/result>
transactions pane wiring: <file/command/result>
scheduled helper tests: <command/result>
loaded config test: <command/result>
execute route tests: <command/result>
lint: <command/result>
persistence verifier: <command/result>

Remaining gaps: <none, or exact blocker>
```
