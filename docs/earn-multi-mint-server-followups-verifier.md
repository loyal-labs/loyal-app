# Earn multi-mint server follow-ups verifier

This is the fixed PASS/FAIL contract for ASK-2105. Run it skeptically against
the current `loyal-apps` checkout. The new mints remain hidden; this verifier
does not authorize changing flags, database state, or onchain policies.

## Required checks

1. Reserve selection joins `kamino.reserve_current_states` to its exact
   `reserve_updates` row and an active catalog entry with the same reserve,
   market and mint. Only confirmed `laserstream_grpc`, `http_snapshot` or
   transitional `http_confirmed_refresh` observations qualify. The old
   `latest_verified_reserve_updates` view is no longer read: routing PR #342
   retired its verification writer, and #350 maintains current pointers from
   the stream instead. Both new-deposit selection and existing-position
   presence reject a future or more-than-240-second-old stream frontier (the
   highest-slot qualifying current row). The frontier is computed before
   narrowing to a requested reserve or mint, so a quiet venue can remain
   current while other watched reserves change. Individual future-dated rows
   are excluded. The transaction-refresh stale bit remains allowed, and the
   SDK still validates the selected reserve's on-chain owner/mint/program
   before building a deposit. Safe-market, supported-mint, liquidity and APY
   filters remain enforced. Neither deposit path expands or sorts the
   unbounded `latest_reserve_updates` history view.
2. Withdrawal confirmation treats `idle` and `reserve` as different source
   contracts. An idle withdrawal requires a null market and the exact vault ATA
   derived with the selected mint's token program. A reserve withdrawal is
   bound to the selected persisted source, but a change in today's routing
   catalog cannot hide an already-finalized transaction. Unsupported mints,
   wrong source accounts, unconfirmed signatures, and transaction mismatches
   still fail before accounting.
3. Normal deposit confirmation and recovery converge on the same idempotent
   signature-based accounting operation. Recovery can adopt an unseen legacy
   SPL or Token-2022 deposit for a managed vault that already has policies and
   positions. It does not infer a deposit from the wallet's largest current
   holding, rebuild policies, or write aggregate position balances directly.
4. Full-exit proof and cleanup use one complete vault token-account inventory.
   Both SPL Token and Token-2022 accounts are read at the required context slot;
   balances are classified per mint/account; positive unknown accounts block
   closure; and transfer/close instructions use each account's actual token
   program. Legacy-SPL USDT and Token-2022 CASH fixtures both pass the Max-exit
   contract.
5. Existing user policies are never mutated. The implementation adds no policy
   migration, onchain policy update, database migration, autodeposit change, or
   stablecoin-visibility change. Incompatible legacy policy generations still
   produce the existing update-required path.
6. The focused behavioral suite, SQL verifier and scoped type/lint checks pass:

   ```sh
   bun run --cwd apps/web verify:earn-multi-mint-server-followups
   bun test packages/smart-account-vaults/src/client.test.ts -t "multi-program Earn cleanup"
   ```

   For the reserve SQL contract, install PGlite outside the repository and run
   the real queries against its disposable in-memory PostgreSQL database:

   ```sh
   reserve_verify_dir=$(mktemp -d)
   bun add --cwd "$reserve_verify_dir" --exact @electric-sql/pglite@0.5.8
   cd apps/web
   bun --conditions=react-server scripts/verify-earn-reserve-selection.ts \
     "$reserve_verify_dir/node_modules/@electric-sql/pglite/dist/index.js"
   ```

   This requires no database credentials and performs no RPC requests. It
   covers the absent legacy view, first-deposit ranking, quiet-reserve top-ups,
   identity/commitment/catalog exclusions, liquidity/APY/mint/market filters,
   startup snapshots, stalled-stream rejection and recovery, future timestamps,
   and JSON-safe API rows. Production query latency and actual transaction
   simulation remain separate live checks. Frontend builds run on Vercel;
   do not run a local frontend build for this verification.

7. Simplicity audit: there is one reserve current-state query contract, one
   finalized-deposit accounting entrypoint, one source-discriminated withdrawal
   confirmer, and one vault token inventory model. There is no new journal
   subsystem, no second policy-shape parser, no per-symbol control-flow tree,
   and no recovery-only balance writer.

## Nice-to-have live evidence

- Read-only production `EXPLAIN (ANALYZE, BUFFERS)` shows no global historical
  reserve sort and database execution below one second.
- At least twenty hidden USDT/CASH prepares show no stale-bit flapping and whole
  prepare p95 below five seconds.
- Hidden Preview canaries cover existing-policy USDT recovery and one Token-2022
  Max exit, followed by an idempotent replay.

## Verdict

Report every required condition as PASS or FAIL with command or code evidence.
Overall PASS is allowed only when every required condition passes. Live checks
remain explicitly PENDING until run; they cannot be inferred from local tests.
