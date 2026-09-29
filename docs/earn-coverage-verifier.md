# Earn earnings coverage and freshness

Earnings begin at the first confirmed deposit. Portfolio observations before that
confirmation seed the state at the deposit boundary; later observations remain
unchanged, and future observations are excluded. APY loading, coverage validation,
and all chart ranges use this same normalized portfolio history. The existing
missing-seed, 36-hour gap/staleness, and principal-history checks still apply.
Coverage failures log their required window and reserve-level coverage details;
wallet identities remain masked. Complete portfolio history is filtered in SQL
and only the fields used by the earnings calculation are loaded.

The visible web chart revalidates every five minutes, retries unavailable/stale
earnings every minute, and revalidates when the tab regains focus. A request and
its retries have a shared 60-second deadline so the first-load spinner settles while
allowing long-lived vault history reads to finish. Server-verified
unchanged amounts are valid fresh data, and today's earnings may reset at local
midnight. Cache version 6 discards older persisted chart payloads after this fix.

From `apps/web`, run the standalone regression checks without secrets:

```sh
bun --conditions=react-server scripts/verify-earn-coverage.ts
bun --conditions=react-server scripts/verify-earn-earnings.ts
bun scripts/verify-earn-client-freshness.ts
```

For a live audit, use the repository's mounted 1Password environment. The new
coverage verifier disables earnings snapshot reads and writes, so stale snapshots
cannot hide a failing scope and the audit never repairs or modifies database data.
Specify the cluster explicitly; the active-position registry itself has no cluster
column. Run against the appropriate environment for that cluster.

```sh
op run --env-file=.env.1password -- sh -c 'cd apps/web && bun --conditions=react-server scripts/verify-earn-coverage.ts --fleet --cluster mainnet-beta'
```

`--wallet <address>` or `--position-id <id>` restricts the audit to one user's
active scopes. Fleet discovery captures all distinct wallet/settings/vault scopes
in one query, then checks membership again after each pass and includes newly active
scopes before finishing. Each read has its own observation timestamp. The final
report counts every scope still active and includes a hash of that membership set;
previously active scopes remain in the detailed log. At most two scopes run concurrently. Results mask
wallet addresses and distinguish fresh coverage, actual APY coverage gaps,
principal/deposit-history mismatches, and dependency failures. A scope without
fresh verified coverage makes the verifier exit nonzero; never treat a partial
run or dependency timeout as verified coverage.

For genuine gaps, prepare a dry run of
`scripts/backfill-reserve-apy-from-kamino-api.ts` for the reported reserve's exact
market and required interval (including its seed). Do not invent rates, relax
coverage thresholds, or write operational backfill rows as part of this audit.
