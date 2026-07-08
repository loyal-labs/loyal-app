# Earn Sponsored Zero-SOL Verifier

This is the plan-goal verifier for the Earn sponsored mainnet flows. It is the
fixed success criterion for this work: implementation plans can change, but this
verifier should pass only when a user wallet that has USDC and no SOL can setup
and close Earn deposit/autodeposit flows without receiving SOL and without
paying transaction fees.

## Verifier Prompt

Run:

```sh
op run --env-file=.env.mainnet.1password -- sh -c '\
  EARN_VERIFY_SOLANA_TESTING_PK="$(cat /path/to/zero-sol-usdc-wallet.json)" \
  EARN_VERIFY_EXPECTED_WALLET_ADDRESS=<zero-sol-usdc-wallet> \
  EARN_SETTINGS_PDA=<settings-pda-for-wallet> \
  NEXT_PUBLIC_SOLANA_ENV=mainnet \
  EARN_VERIFY_FRONTEND_BASE_URL=http://localhost:3000 \
  bun scripts/verify-earn-mainnet-sponsored-zero-sol-goal.ts
'
```

Required PASS conditions:

1. A safety preflight finds no known wallet-funded sponsored-flow paths in the
   two child verifier scripts: no `/prefund/sponsored` endpoint literals and no
   direct `sendPreparedWithWallet` calls.
2. The verifier runs both existing live sponsored scripts successfully:
   `scripts/verify-earn-mainnet-sponsored-flow.ts` and
   `scripts/verify-earn-autodeposit-mainnet-sponsored-flow.ts`.
3. The child scripts emit PASS markers and parseable JSON evidence.
4. No verifier evidence references `/prefund/sponsored`, and no
   `sponsoredPrefund` response is present. The fix must not send SOL to the user
   wallet as a workaround.
5. Every signature emitted by the child scripts is fetched from mainnet RPC and
   resolves to a confirmed/finalized transaction.
6. For every emitted transaction, account key 0, the on-chain fee payer, is
   `EARN_POLICY_SPONSOR_PUBKEY` or the public key derived from
   `EARN_POLICY_SPONSOR_PK`.
7. For every emitted transaction where the test wallet appears in the account
   list, the wallet's pre and post lamport balances are both `0`, and the wallet
   lamport delta is exactly `0`.
8. No emitted transaction contains a parsed System Program SOL transfer whose
   destination is the test wallet.
9. Autodeposit setup and close evidence must be sponsored; no setup/close
   evidence item may report `sponsored: false`.

Verdict format:

- `PASS` only if every required condition above holds.
- `FAIL` if any required condition fails, with the failing condition, child
  script output, and chain-check evidence written to
  `docs/solana/earn-sponsored-zero-sol-verifier-run.md` unless
  `EARN_SPONSORED_ZERO_SOL_TRACE_PATH` overrides that path.

## Notes

- This verifier intentionally checks outcomes, not a specific implementation.
  It does not require deleting prefund routes, but it does require the live
  sponsored flow not to call them and not to transfer SOL to the user wallet.
- Run it only against mainnet with an explicit zero-SOL wallet that already has
  enough USDC for the tested Earn amount.
