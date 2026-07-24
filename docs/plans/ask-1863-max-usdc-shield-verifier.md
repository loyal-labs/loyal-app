# ASK-1863 MAX USDC Shield Verifier

Use this prompt to decide whether PR
[`loyal-labs/loyal-app#523`](https://github.com/loyal-labs/loyal-app/pull/523)
actually fixes the intermittent `InvalidAmount` (`Custom(6013)`) failure seen
when shielding MAX USDC.

## Verification prompt

Work from the PR head with an up-to-date `origin/main`. Treat the repository
and chain-facing code as adversarial: look for any path that can still submit a
display-rounded amount, quote Kamino at a different commitment from
transaction preflight, persist the requested amount instead of the amount
actually submitted, or reuse one account's balance for another account's
token actions.

### Required 1: incident invariant

- A deterministic wallet-core test proves that a row rendered as `1.1723`
  USDC can still resolve the canonical `1.172339` balance and produce
  `1_172_339` raw units for MAX.
- A deterministic SDK test reproduces the observed Kamino rounding boundary:
  a request for `1_172_300` raw units maps to the fixed point `1_172_299`, and
  reapplying the conversion keeps `1_172_299`.
- The reserve snapshot used to select the Kamino fixed point and base
  transaction preflight use the same explicit commitment. There must be no
  `processed` quote combined with default `confirmed` preflight.

### Required 2: account isolation

- Personal-wallet token actions may resolve against canonical personal-wallet
  balances.
- Vault token actions resolve against that vault's canonical positions.
- Agent/signer token actions never resolve against the personal wallet's token
  collection. If no canonical signer positions are available, they retain the
  row-local fallback rather than borrowing another account's balance.
- A focused test covers the account-source selection, including identical
  mints with different balances.

### Required 3: effective amount propagation

- Every app surface that persists Kamino shield principal uses the effective
  amount returned by the executed SDK plan, not the originally requested
  amount.
- Enumerate all callers with:

  ```sh
  rg -n "buildShieldTokensTransactionPlan|executeShieldTokensTransactionPlan|addedPrincipalLiquidityAmountRaw|shieldTokens\\(" \
    frontend app mobile packages sdk --glob '*.ts' --glob '*.tsx'
  ```

- Frontend, Telegram mini-app, and mobile direct-shield paths satisfy the
  invariant. Private-send and fee-estimation paths must not introduce
  principal persistence based on the requested amount.

### Required 4: regression and scope boundaries

- Non-Kamino SPL tokens and native SOL retain their requested shield amount.
- Unshield construction and accounting are unchanged by this fix.
- SDK test/typecheck coverage is not weakened to make validation pass. In
  particular, the PR must not hide existing smoke suites with new
  `tsconfig.json` exclusions or silently remove them from the default test
  command.
- No files under `programs/`, no Anchor IDLs, and no generated smart-contract
  artifacts appear in `git diff origin/main...HEAD`.

### Required 5: executable evidence

Run all of the following without a local frontend production build:

```sh
bun test packages/wallet-core/src/lib/__tests__/shielding.test.ts
bun test sdk/private-transactions/tests/kamino-balance-quote.test.ts
bun run --cwd sdk/private-transactions build
bun run --cwd packages/wallet-core typecheck
bun run --cwd frontend lint
git diff --check
```

Also compare any failing command against `origin/main` before attributing it to
the PR. Confirm the pushed PR head matches local `HEAD`, the PR still targets
`main`, and all required GitHub checks for the pushed head are successful.

### Verdict format

Report `PASS` or `FAIL` for each Required section with concrete command output,
test names, paths, or GitHub state. Report overall `PASS` only when every
Required section passes. If any section fails, name the smallest remaining
counterexample and continue the plan-do-verify loop without weakening this
verifier.
