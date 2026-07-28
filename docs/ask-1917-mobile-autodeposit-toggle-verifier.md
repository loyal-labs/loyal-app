# ASK-1917 Mobile Autodeposit Toggle Verifier

## Purpose

Adversarially verify the ASK-1917 fix for rapid mobile Autodeposit toggle
presses. The fix is complete only when every required check below passes.

## Scope and base

- Worktree: `loyal-app-ASK-1917`
- Base branch: `origin/ask-1355-mobile-earn-tab`
- Product scope: mobile Autodeposit toggle only
- No backend route, database schema, worker, or test-suite changes
- No `*.test.*`, `*.spec.*`, or `__tests__` files

## Required behavior

1. Every press remains interactive and immediately changes the displayed
   switch value. The switch is not disabled and has no loading lock.
2. Presses before the debounce expires are coalesced into one submission of
   the latest requested value.
3. At most one toggle HTTP request is in flight.
4. Presses during an in-flight request occupy one replaceable follow-up slot:
   intermediate values are skipped and the final requested value is submitted.
5. All promises in one coalesced cycle settle only after the final submission
   and the final authoritative refresh settle.
6. A failed final submission still runs the authoritative refresh, reconciles
   the optimistic value to the refreshed value, and rejects only after that
   reconciliation.
7. The lifecycle flow ID is forwarded through the toggle API as
   `x-loyal-flow-id`. HTTP failures continue to expose only the safe error code
   and status metadata already handled by the lifecycle observability layer.

## Automated verifier

From the repository root:

```sh
cd mobile
bun run verify:autodeposit-toggle
npx tsc --noEmit
npx expo lint
```

The focused verifier must print:

```text
ASK-1917 verifier: PASS
```

It covers:

- immediate optimistic updates while the controller remains interactive;
- pre-flight debounce and latest-value coalescing;
- serialized in-flight and follow-up submissions;
- promise completion ordering relative to the final request and refresh;
- final-failure refresh and reconciliation;
- lifecycle-flow header wiring;
- absence of a disabled/loading toggle gate.

## Diff audit

Run:

```sh
git diff --check
git diff --name-only origin/ask-1355-mobile-earn-tab...HEAD
git diff origin/ask-1355-mobile-earn-tab...HEAD -- mobile
```

Fail if the diff contains:

- a backend route, schema, migration, worker, or unrelated feature change;
- a test file or test-suite modification;
- a disabled/loading condition on the Autodeposit switch;
- concurrent calls to `setEarnAutodepositActive`;
- a toggle request that omits the lifecycle flow ID.

## Verdict

Report `PASS` only if the focused verifier, TypeScript check, Expo lint, and
diff audit all pass. Otherwise report `FAIL` with the exact failing condition.
