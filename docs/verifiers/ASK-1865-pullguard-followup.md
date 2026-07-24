# ASK-1865 PullGuard Follow-up Verifier

## Incident boundary

This verifier covers the follow-up findings from the PullGuard review of
`loyal-labs/loyal-app#524`. The user flow is:

1. Shield MAX USDC.
2. Unshield MAX USDC.
3. Lose one or more Solana RPC reads while the wallet refreshes.

The frontend must never turn an incomplete balance read into an authoritative
zero balance. This follow-up also protects shielding availability, retry
classification, and the unavailable-wallet presentation.

## Required conditions

### 1. Incomplete secure-balance reads fail closed

- A failure from any configured deposit-enumeration source rejects the secure
  balance read instead of returning a partial or empty deposit list.
- A wallet portfolio refresh whose secure-balance provider rejects must reject;
  it must not cache or return a fresh portfolio with zero shielded balances.
- A later successful refresh must read the live secure balance. The preceding
  failure must not poison the portfolio cache.
- With a previously confirmed snapshot, refresh failure preserves it as stale.
  Without one, the balance remains unavailable.

### 2. Shield accounting pre-reads are best-effort

- For tracked USDC, failure to read the pre-shield deposit amount used only for
  local Kamino basis accounting must not prevent transaction construction,
  wallet execution, or confirmed shield success.
- If the accounting baseline is unavailable, basis reconciliation is skipped
  and logged. No unconfirmed transaction may be presented as successful.

### 3. Retry is offered only for transient connection failures

- Network, CORS, socket, timeout, and RPC transport failures are retryable.
- User rejection is not retryable.
- Deterministic transaction construction, simulation, and program failures are
  not retryable and remain visible as failures.

### 4. Unavailable balances are not rendered as an empty wallet

- An unavailable portfolio displays the unavailable warning and `$—`.
- It does not display `No cash yet` or the zero-valued LOYL placeholder.
- A stale portfolio may keep rendering its last confirmed token rows while
  clearly marked stale.

### 5. Original MAX-unshield invariants remain intact

- Base-chain confirmation is still required before an unshield is successful.
- A transient failure before confirmation can be retried.
- Retry rebuilds from the current live deposit amount rather than reusing the
  original MAX amount.
- One successful retry decreases the shielded balance exactly once.

## Verification procedure

Run from the ASK-1865 worktree:

```sh
cd frontend
bun run verify:max-unshield-recovery
bunx tsc --noEmit --incremental false
bun run lint
cd ..
git diff --check
```

Do not run a local frontend production build; Vercel is the build gate for this
repository.

Review the focused verifier output against every Required condition above.
Report each condition as `PASS` or `FAIL`, including the command or observation
that proves it. The overall verdict is `PASS` only when all five Required
conditions pass. Otherwise, fix the implementation without weakening this
verifier and rerun it.
