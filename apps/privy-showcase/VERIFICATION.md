# Privy Earn demo — verifier-first contract

This demo has one deliberately small, observable state machine. It does not
authorize arbitrary transactions, and the verifier never signs or submits one.

## User-visible state machine

The page must make these steps explicit and keep completed steps visible:

1. **Connect** — sign in with Privy and select the embedded Solana wallet.
2. **Balance** — display finalized canonical USDC sent directly to that wallet.
   The demo must not expose an in-app funding action.
3. **Create smart account** — search finalized Settings accounts for the wallet
   first; create one only when no eligible account exists. Reload finalized
   state after creation.
4. **Create policies** — search by Settings account and reuse only an exact
   bundle. Create missing artifacts with the wallet as Settings authority and
   `SMART_ACCOUNT_SPONSOR_PUBKEY` as delegated policy signer:

   - one recurring-delegation autodeposit policy: wallet USDC → vault 1;
   - one Earn route policy pinned to Kamino Main Market USDC;
   - one Earn setup policy pinned to Kamino Main Market USDC;
   - one USDC SpendingLimit policy: vault 1 → this wallet only.

   The four items above are four physical Policy accounts. Subscription
   authority, recurring delegation, token approval, ATAs, and Kamino obligation
   accounts are setup artifacts, not additional policies. Any extra policy,
   duplicate, incompatible signer, or non-Main market is a hard failure.

5. **Move money** — each button sends a fixed movement request to the backend.
   The backend authenticates the Privy wallet, reconstructs the one allowed
   operation, signs with the delegated sponsor key, simulates with signature
   verification, broadcasts once, waits for finalization, and reloads balances:

   | Step | Fixed transition | Amount |
   | --- | --- | ---: |
   | A | wallet → smart account vault 1 | 2 USDC |
   | B | smart account vault 1 → Kamino Main USDC | 2 USDC |
   | C | Kamino Main USDC → smart account vault 1 | 1 USDC |
   | D | smart account vault 1 → originating wallet | 1 USDC |

6. **Withdraw** — beside Sign out, let the authenticated user enter another
   Solana address and amount. Build only a canonical-USDC transfer from the
   embedded wallet, require a Privy signature, wait for finalization, and then
   refresh the wallet balance. This user-authorized transfer is separate from
   the delegated backend state machine.

The UI must derive and label the three actual money states from finalized chain
data: **In wallet**, **In smart account**, and **In Kamino**. Kamino means the
vault’s position in the canonical Main USDC reserve/collateral, not an
unrelated token balance.

## Static acceptance checks

Run from the monorepo root:

```sh
bun run --cwd apps/privy-showcase verify:demo
```

The verifier checks, at minimum:

- no funding action, plus separate connect/withdraw actions, one progressive
  setup action that chains account creation then policy creation, one loop
  action that decomposes into exactly the four fixed backend moves, and four
  explicit movement actions;
- finalized existing-account discovery before account creation;
- idempotent policy discovery and the exact four-policy topology;
- recurring autodeposit, Main-only Earn route/setup, and USDC wallet-exit
  SpendingLimit implementation markers;
- one authenticated backend route with explicit movement kinds;
- wallet identity binding, sponsor-key environment consistency, and delegated
  sponsor signing;
- mainnet-beta, canonical USDC, vault index 1, and Kamino Main boundaries;
- a full reset that drains Kamino, closes all four policies through
  wallet-signed teardown stages, and has the sponsor re-derive each stage
  byte-exactly;
- no browser persistence, generic sweep/replay endpoint, worker, scheduler, or
  transaction submission primitive in the verifier itself.

A passing static verifier means the requested contract is present: account
discovery, the exact policy bundle, the three balance projections, and the
four backend movement transitions. Without the mounted 1Password environment
the live section reports `BLOCKED`, which is the expected local result.

## Finalized walkthrough evidence

After an explicitly approved walkthrough, run the same command with all values
below. Values are public addresses/signatures; never pass a private key:

```sh
bun run --cwd apps/privy-showcase verify:demo -- \
  --wallet <PRIVY_WALLET> \
  --settings <SETTINGS_ACCOUNT> \
  --autodeposit-policy <POLICY> \
  --earn-route-policy <POLICY> \
  --earn-setup-policy <POLICY> \
  --spending-limit-policy <POLICY> \
  --wallet-to-smart-signature <FINALIZED_SIGNATURE> \
  --smart-to-kamino-signature <FINALIZED_SIGNATURE> \
  --kamino-to-smart-signature <FINALIZED_SIGNATURE> \
  --smart-to-wallet-signature <FINALIZED_SIGNATURE>
```

The live verifier then proves:

- mainnet RPC and a funded sponsor;
- `EARN_POLICY_SPONSOR_PK` derives exactly the configured
  `SMART_ACCOUNT_SPONSOR_PUBKEY`;
- the wallet is the sole all-permissions Settings signer;
- exactly the four named physical policies exist, all with the delegated
  sponsor signer;
- autodeposit is bounded to this wallet/vault pair, Earn route/setup include
  only the canonical Main Market target, and the SpendingLimit is USDC vault →
  this wallet;
- all four signatures finalized successfully;
- token deltas match wallet→vault (+2), vault→Kamino (-2 plus collateral),
  Kamino→vault (+1 plus collateral reduction), and vault→wallet (+1);
- final chain-derived wallet, vault, and Main collateral balances are
  non-negative and the walkthrough leaves a positive Kamino position.

`PASS` requires every check. `FAIL` identifies a violated contract.
`BLOCKED` identifies missing external configuration or walkthrough evidence and
prints the exact rerun inputs. External configuration is supplied through the
mounted 1Password environment; the verifier does not authorize transactions.

## Implementation order

1. Implement finalized account discovery/create and reload.
2. Implement exact policy discovery/create, including delegated signer and
   USDC SpendingLimit.
3. Implement three balance reads and the four backend movement transitions.
4. Make the UI copy explain the source, destination, amount, signer/fee model,
   and resulting money state for every button.
5. Run lint/typecheck/tests through `verify:demo`, then collect one approved
   finalized walkthrough and rerun the live verifier.
