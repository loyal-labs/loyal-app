# Verification status

Last verified: 2026-08-04 (America/Los_Angeles)

Overall: **BLOCKED on the explicitly gated live mainnet canary.** The implementation and non-mutating verifier pass; no automated check submitted a transaction.

1. **PASS — Workspace.** `bun install --frozen-lockfile` and `bun run --cwd examples/privy-showcase verify` pass. No production frontend build was run.
2. **PASS — Privy implementation.** Email-only auth provisions a Solana embedded wallet, displays its address, and configures only `solana:mainnet` plus mainnet-only RPC guards.
3. **PASS — Discovery.** Finalized `getProgramAccounts` uses the Settings discriminator, decodes variable signer arrays, lists all signer matches, and labels synchronous-demo eligibility. Malformed, wrong-owner, and signer decoding tests pass.
4. **PASS — Creation implementation.** The client reads fresh ProgramConfig, derives the next Settings PDA, makes the Privy wallet creator/fee payer/sole all-permissions signer, waits for finalization, verifies Settings, and refuses blind replay after an ambiguous submission.
5. **PASS — Autodeposit implementation.** All resumable setup stages run client-side; nonce/seed are persisted before signatures; canonical mainnet USDC, vault index 1, policy signer, delegation, cap, period, and expiry are verified from finalized state. The mutable wallet floor is explicitly labeled application-enforced.
6. **PASS — Delegated sweep implementation.** Privy identity-token auth, embedded-wallet ownership, a short-lived signed finalized-state snapshot, chain rereads, canonical artifact checks, bounded amount, simulation, policy-key-only signing, finalization, and exact balance reconciliation are present. The intent fixes the blockhash and exact amount, so concurrent instances construct the same Solana transaction signature; stale or completed snapshots fail before a new send. Negative authorization, deterministic-replay, and stale-snapshot tests pass.
7. **PASS — Withdrawal implementation.** The client exposes no destination input: vault-index-1 canonical USDC can return only to the same Privy wallet ATA. Withdraw and close-autodeposit are separate actions, with amount/destination tests.
8. **PASS — Static safety.** Server secrets are confined to server modules, example secret values are blank, the backend key is rejected as a root signer, the API surface is limited to sweep config/challenge/execute, and automated verification contains no submission path.
9. **BLOCKED — Live canary.** Required inputs: a Privy app ID and secret, identity tokens enabled in the Privy dashboard, a persistent backend policy key stored through 1Password, a mainnet RPC that supports `getProgramAccounts`, deliberately bounded SOL/USDC funding, and explicit approval to submit the walkthrough transactions.

Verifier command:

```sh
bun run --cwd examples/privy-showcase verify
```
