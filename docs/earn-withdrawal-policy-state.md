# Withdrawal preparation and inactive policies

Withdrawal preparation retries the active route-policy projection five times
(over 1.85 seconds of backoff). If no active pair appears, it checks the requested
vault's current policy pointer, scoped to authenticated authority, cluster,
settings, vault index, and vault address—not historical policy generations.

- An inactive vault or current route policy returns HTTP 409 with
  `earn_policy_inactive`, without a `Retry-After` header or transaction preparation.
  The web withdrawal handler invalidates Earn state, position, transactions, and
  earnings so another tab/device's completed cleanup does not leave stale state.
  It does not optimistically clear holdings or assume there is no newer deposit.
- Missing projection without evidence of inactivity retains HTTP 503 with
  `earn_policy_projection_pending` and `Retry-After: 1`.
- A policy that becomes active during backoff proceeds using live RPC holdings.

This classification is shared by web and mobile preparation routes. Inactivity
is a read-model observation, not proof that the vault has no on-chain funds.
No database repair, policy reactivation, or fund movement is performed.

Regression check:

```sh
cd apps/web
bun test src/app/api/smart-accounts/yield-optimization/withdrawals/prepare/route.test.ts
```

After deployment, try withdrawing from a stale tab after a full-exit cleanup:
expect the inactive-policy message and refreshed Earn state, not a retry loop.
Verify a fresh deposit can still prepare a withdrawal after projection catches up.
