# loyal-vault-demo — verifier-first implementation contract

Status: implementation started (2026-09-04) by **one sequential implementation worker** in the isolated branch `ask-2025-posmotret-chto-nuzhno-dlya-backyard-finance` of worktree `/Users/user/loyal/loyal-app-ASK-2025`, base commit `81ea913f`. The three-agent assignment below is executed as sequential checkpoints by that single worker; the parent task owns contract decisions, integration review and final PASS. Application implementation, deployment and live proof are not complete. This document is the sole acceptance contract; work packages below are implementation guidance, not additional definitions of done. Adopted unchanged from `/Users/user/.codex/visualizations/2026/09/05/01a06ee7-4ed6-7381-9958-2e42c69ca10f/loyal-vault-demo-implementation-plan.md` (only this status note and the concurrency note differ).

## Objective

Deliver one deployed partner-facing web application, `loyal-vault-demo`, where a user connects a Solana wallet, deposits USDC into the existing Loyal/Backyard Voltr vault, receives LP tokens, sees their position and the vault's actual smart-account/Kamino allocation, requests a partial or full withdrawal, tracks its eligibility and liquidity restoration, and claims USDC back. Prove the complete browser-to-chain journey against the deployed source and existing Go worker.

## Scope and hard constraints

- Application root: `apps/loyal-vault-demo` in `loyal-apps`. Reuse the repository's Next.js/React/Bun conventions and wallet libraries. Register the workspace once in the explicit root workspace list. Keep feature code local to this app; extract a shared package only when actual reuse warrants it.
- Exactly one configured mainnet-beta Voltr vault: `HXtk15EA5pBg3rSKxBm8sWPExScPkTknSRp37fXNHgNA`. USDC input/output mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. Expected smart-account vault: `ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh`, account index `0`. Verify all bindings on chain before treating them as current. Do not substitute consumer Earn account index `1`.
- User money actions exposed by the demo are deposit, withdrawal request and withdrawal claim. No new vault, token, adaptor, policy installer, optimizer, route selector, manager transaction endpoint, sponsor signer or server-held user key. No instant-withdraw or cancellation UI is required for this version.
- Preserve the existing single Go manager writer, lease, journal, NAV authority and withdrawal priority. No second allocator, withdrawal execution worker or competing operation journal. Minimal additive observation/export work in `loyal-yield-routing` is allowed in the implementation scope; changing money-routing semantics remains owned by Phase 3 and requires explicit scope coordination.
- Supported-market metadata comes from the authoritative runtime catalog. Reject duplicate and foreign tuples; account for all catalog entries, including unavailable ones. This does not authorize additional lane activation or require a funded lifecycle on every lane. Actual distribution must reflect observed positions, including a single active loop when that is the runtime's limit.
- Browser signs user-owned Voltr transactions. Preparation and verification are signer-free. The verifier never broadcasts, signs, deploys, mutates production databases or induces worker allocation.
- No local frontend production builds, including through hooks or verifier subprocesses. Run scoped lint, no-emit type checking and browser checks; use the authorized hosting build for deployment evidence. Follow the repository's TypeScript test rubric; do not create shape/copy/source-string assertion suites.
- Preserve unrelated dirty checkout work. At implementation kickoff refresh and verify `main`, create an isolated main-based branch/worktree using the actual Linear issue name, and record the base commit. Do not invent an issue identifier or switch the shared dirty checkout. Only the integration owner edits shared workspace/lock/config files.
- This request authorizes planning, not implementation or production side effects. A later implementation assignment authorizes local in-scope changes and safe checks. Record any later explicit deployment/live-operation authorization with exact identities, action classes, value/fee/count limits and expiry. Phase 3's 1/20/60 USDC canary envelope does not authorize this demo or ongoing partner allocation.

## Current context and source pointers

The neighboring task is **PHASE 3 RWA LOOPS**, ID `01a06b6c-8023-72b1-ad5d-c97c0662820e`. Its latest inspected work was in `/private/tmp/loyal-backyard-phase3.3EQhbn`; this is a transient reference, not a deployable dependency. Refresh the task/source identity at kickoff. Its contract supports 11 catalogued lanes across Prime, Maple, OnRe, AUTO and Ethena, with three new-family canaries and no simultaneous multi-family allocation scheduler. The inspected implementation was still completing the cap governor; local code is not deployment proof.

Read these files in the current authoritative checkouts:

- `loyal-yield-routing/docs/plans/backyard-rwa-phase3-family-activation-verifier.md`: runtime scope, authority and expiry.
- `loyal-yield-routing/tools/backyard-voltr/src/integrations/voltr.ts`: SDK-based user deposit/request/claim builders and PDA derivation. Extract/adapt only the user operation surface; do not import CLI signers or manager scaffolding into the web app.
- `loyal-yield-routing/tools/backyard-voltr/src/domain/rwa-multiply-route-spec.ts`: candidate identity graph, to be checked against deployment and chain.
- `loyal-yield-routing/go/backyard-rwa-worker/internal/backyardrwa/{voltr_observe,nav,store,decide}.go`: receipts, custody valuation, durable observations and restoration decisions. Phase 3 may update these paths.
- `loyal-apps/apps/privy-showcase/src/lib/money-state.ts`: coherent chain-read reference. Its verifier targets a different product and contains source-shape checks; do not reuse it as this product's proof.
- `loyal-apps/apps/web/src/components/solana/wallet-provider.tsx`: wallet integration reference. Reuse relevant patterns without pulling in the consumer application's global providers and product flows.

Older manifests are explicitly incomplete and older tools refer to different adaptor generations. Historical native-vault withdrawal timing is not authoritative for this RWA vault. Resolve current strategy/NAV adaptor bindings and the actual receipt deadline; neither a hardcoded ten-minute nor a one-day timer is acceptable proof.

## Sole verifier

Implement this executable before application behavior:

```sh
bun run --cwd apps/loyal-vault-demo verify:demo --tier full --report /tmp/loyal-vault-demo-report.json
```

The script is `apps/loyal-vault-demo/scripts/verify-demo.ts`. A minimal package/script bootstrap is permitted to make the verifier executable before the app exists. Run its complete baseline immediately; missing app behavior must produce failures, never placeholder passes. The report is a generated result of this one verifier, not a second acceptance artifact. When secrets are required, invoke the command through serialized terminal-only `op run` with the existing appropriate mounted environment. Never read/copy a FIFO or assume the frontend devnet environment serves this mainnet demo.

Inputs are validated server-side configuration, the candidate source identity, local and deployed base URLs, current chain/worker observations, and captured browser/lifecycle evidence. Evidence files locate observations; their asserted success flags never prove a condition. Re-read chain receipts, transaction effects and deployment metadata independently. Reject production verification against fixtures, unrecognized vaults or an arbitrary URL supplied by a public request.

Output includes schema version, contract identity, tier, source commit/dirty state, deployment URL/build identity, runtime identity, cluster/genesis, observed slots/times, R00–R08 results, evidence references, freshness/tolerance parameters and external gates. Each check records what was proven by static inspection, controlled runtime/simulation, submission, confirmation, finalization, reconciliation, deployment and browser behavior. Never label simulation as live success.

Verdict rules:

- `PASS` only for a full run where every R-condition is proven against the candidate deployment and current authoritative evidence.
- `FAIL` names a reproducible false condition or missing implementation/coverage. Known failures remain failures even when other checks are externally blocked.
- `BLOCKED` when no known implementation failure explains the missing proof and an identified external dependency prevents completion; include owner, measured evidence and exact resume condition. Also report per-check blocks alongside any overall failure.
- `--tier fast` runs cheap static falsifiers and affected behavioral slices, returning check results with `completionEligible: false`. It cannot produce an overall completion `PASS`.
- Full runs evaluate every condition at baseline and completion, reporting unavailable inputs per check instead of aborting at the first missing credential. During iterations reuse valid expensive evidence until source, deployment or relevant state changes invalidate it.

Contract conditions cannot be deleted, skipped or weakened to get PASS. A measurement defect may be repaired only with independent evidence that the new measurement preserves the same condition at least as strictly; record defect, evidence and repair in the report. Scope weakening needs explicit user agreement.

## Required end-state conditions

### R00 — identity, authority and feasibility

Verify chain genesis, account owners, vault/USDC/LP mint, token programs and decimals, smart-account index/address, strategy receipts, custody destinations, current adaptor/NAV bindings and deployed manager identity. Derive PDAs independently and reject duplicate/foreign accounts. Read deposit restrictions, fee rules, LP accounting and withdrawal terms from the pinned SDK/deployed program state. Verify required mainnet read credentials and deployment access without exposing secrets.

Before costly implementation, establish whether current NAV refresh behavior safely supports an unrelated user's deposit/request while the manager is active, and what the program itself enforces. A UI freshness check is not an on-chain guarantee. Identify any unsafe accounting gap now; a required protocol change is an external scope decision, not permission to patch the adaptor here. Check that existing limits can service partner deposits and exits; do not reuse the temporary canary budget.

### R01 — exact application and signer boundary

Inspect the candidate source, workspace registration, reachable server actions/routes, client graph and deployment resources: one demo app, one bound vault, only the three user money actions, no extra manager writer or privileged signing capability. Check account/mint/program inputs at runtime as well as static imports. A manipulated wallet/vault/destination/amount/program request must fail before returning an executable foreign transaction. Deployment configuration and client assets must not expose RPC/database credentials or operational keys. Fixed-purpose RPC access must not become an unrestricted public proxy.

### R02 — truthful overview, position and allocation

The rendered overview and wallet panel agree with fresh chain observations: USDC/LP balances, LP supply/share valuation, fees, idle liquidity, escrowed shares and pending redemption. Use integer raw amounts and explicit decimals; wallet LP and escrowed LP must not be counted twice. Do not report LP market value as deposited principal or invent historical profit/APY.

Allocation shows actual market/collateral/debt identities, quantities, collateral value, debt value, net equity and LTV where available. Sum disjoint custody/position components and reconcile against Voltr's reported NAV; do not count both the Voltr strategy claim and its underlying holdings. Keep the user's wallet outside vault NAV. Apply the actual redemption/fee accounting, not a generic subtraction of request amounts. Unknown nonzero exposure produces an explicit reconciliation failure, not a hidden remainder.

Use coherent observation contexts or a documented bounded reconciliation method; disclose slots/ages instead of silently mixing snapshots. Before baseline, record numeric freshness limits and raw-unit rounding tolerances derived from program/SDK precision and runtime rules. Never widen them to mask a mismatch. Stale/error/unknown data is not zero; stale displayed estimates carry their last-update time and actions requiring fresh valuation are disabled. Catalog capability, current eligibility and actual allocation are distinct fields.

### R03 — deposit and LP receipt

Through the real app/server/SDK path, a valid user deposit previews USDC amount, estimated LP, program fees and wallet-paid SOL costs; prepares the correctly bound unsigned transaction; and is signed by that wallet. Rejected signatures cause no submission. Invalid precision, zero/negative/over-balance amount, changed wallet or expired quote/blockhash is rejected or explicitly re-quoted before signing. Use enforceable SDK price/min-output bounds if supported; otherwise label previews as estimates and disclose the actual execution semantics rather than claiming guaranteed shares.

After submission, status follows the exact signature. Finalized transaction-scoped effects prove the intended USDC debit, vault credit and LP credit under the program's fee/rounding rules. Refresh state only as success when those effects are verified; RPC acceptance alone is not a deposit receipt.

### R04 — withdrawal request, restoration and claim

The real flow supports partial withdrawal and withdraw-all using correct LP/request semantics. Existing receipts are discovered after reconnect/reload; enforce actual program constraints on additional requests rather than creating a fictional queue. A successful request proves the correct user's LP escrow and receipt creation. A request does not itself prove LP burn or USDC payout.

Display receipt eligibility time, waiting state and liquidity restoration independently. A cooldown countdown reaching zero alone cannot enable an unconditional claim. Check current receipt ownership, program eligibility and available liquidity, and preflight the claim; handle races with other claims by refreshing the state without promising funds. Worker restoration comes from its existing journal plus chain evidence, never a browser-created manager job.

Finalized claim effects prove receipt consumption according to the deployed program, escrowed LP burn and USDC credit to the requesting wallet. Do not require token-account rent closure if that program leaves an empty account. Recover accurately after timeout or reload; a consumed receipt is not proof that this browser's submitted transaction succeeded without its signature/effects.

### R05 — recovery and wallet isolation

Drive outcome-critical slices through real components with controlled failures: wallet changes during a quote/sign request, signature refusal, lost submission response, blockhash expiry, stale NAV, RPC failure, insufficient claim liquidity and two different wallets' pending receipts. Invalidate wallet-scoped data when accounts change. No foreign position/receipt action, double credit, duplicate blind send, premature success or worker invocation is allowed.

Persist only nonsensitive recovery identifiers if needed. A missing signature response is an ambiguous state to reconcile against account/transaction evidence, not permission to build and send a replacement immediately. No production fault injection is required; controlled failure evidence and actual live evidence are labelled separately.

### R06 — bounded reads and observable service state

Vault-wide data is shared/cached; wallet reads are scoped. A measured run with two viewer sessions demonstrates shared vault observation reuse and a configured finite RPC/retry budget, with refresh on relevant transaction outcomes. Configure numeric polling/cache, freshness and per-request timeout bounds before baseline; stop hidden-tab refresh and back off errors. Do not scan every Kamino market per visitor. Read-only database access stays in the owning server module with least-privilege credentials, or use a bounded existing service endpoint.

Show last successful vault observation and worker observation separately. Never infer healthy withdrawal service from an HTTP 200 or a process existing. Stale worker observation must be visible and prevent new deposits when active servicing is required; it must not globally disable a currently eligible on-chain withdrawal claim.

### R07 — deployed browser behavior and partner usability

The actual URL identifies `loyal-vault-demo` and matches the verified source/build. Hosting performs the production build; verify server routes and client hydration on that deployment. Scoped lint and app type checks pass; report unrelated baseline errors without modifying their code.

Apply the **Partner Journey rubric** in a real browser at desktop and narrow mobile widths: connect/disconnect works; amount fields and actions are keyboard accessible; wallet position, fees and network are legible; request deadline and liquidity status are understandable; loading/error/empty/pending states work; no clipped primary action; address copy and transaction links resolve to the bound accounts/signatures. Capture observed behavior/screenshots with URL and source identity. This rubric is functional acceptance; a separate subjective design-approval gate is not required.

### R08 — complete live proof and operational handoff

Under a separately recorded authorization, one partner-style wallet completes a deployed-app mainnet journey: deposit, finalized LP receipt, observed nonzero Kamino exposure attributable to this vault, partial request/claim, then withdrawal of its remaining shares. Prove at least one request actually requires and receives worker liquidity restoration; a wholly idle-vault round trip does not prove that requirement. Distinguish pooled exposure from a claim that individual deposited coins can be tracked through a pool.

A live receipt may already satisfy the waiting period when the verifier runs. Match each relevant action to the candidate app/runtime source and immutable deployment interval; reused evidence must prove unchanged behavior and be supplemented with fresh current-state reads. Check transaction-scoped deltas, fees/rounding, LP/receipt terminal state and absence of unresolved demo submissions. Do not drain unrelated users' assets or demand that the entire shared vault be flat.

Handoff records the deployed URL, vault/strategy identities, standing servicing configuration, observation/incident owner, and bounded recovery procedure for held withdrawals. A later worker deployment may not silently invalidate the app's binding or conceal changed accounting. Phase 3 completion alone is not a certificate of ongoing service readiness.

## External gates — declared before implementation

| Gate                                 | Owner                                        | Resume condition                                                                                                                                                                                                      |
| ------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current runtime bindings/read access | Yield runtime maintainer + environment owner | Validated deployed manifest, RPC and least-privilege observation access are available; current NAV/withdrawal semantics verified. Historical or incomplete files do not satisfy this.                                 |
| Main-based issue branch              | Implementation coordinator/user              | Actual Linear identifier is available for the required branch naming; a clean isolated branch from verified main is recorded. No issue creation is implied.                                                           |
| Persistent deposit/exit servicing    | Yield operator                               | Explicit ongoing operating envelope/configuration supports the demo's amounts and restoration while preserving the single writer. It must remain valid beyond Phase 3 goal closure.                                   |
| Hosting deployment                   | Deployment owner/user                        | Target project/URL, environment and permission to deploy the reviewed candidate are recorded; hosted build succeeds. No purchase or domain acquisition is implicit.                                                   |
| Live wallet/funding                  | User/operator                                | Exact wallet, vault, actions, amount/fee/count caps and expiry are authorized; wallet has sufficient USDC and SOL, and an eligible lane has capacity. Shrink the trial to fit limits; never raise caps automatically. |
| Receipt timing/liquidity             | Voltr chain state + yield operator           | Actual receipt is eligible and required liquidity is restored. Record its earliest recheck time; do not poll indefinitely or change the program's waiting period.                                                     |
| Protocol/accounting incompatibility  | User + runtime/protocol owner                | Measured conflict is resolved within existing semantics, or user explicitly approves the smallest required scope change. No silent adaptor or policy expansion.                                                       |

These gates can block live completion while local implementation proceeds. A missing local endpoint is FAIL, not an external gate. Any newly discovered prerequisite that should have been preflighted is recorded as a contract defect, with evidence. Do not mask a solvable implementation failure by relabelling it BLOCKED.

Default diagnostic bounds: 30 seconds per RPC, three attempts for transient read failure, two minutes per controlled check and browser stage, and 15 minutes for one hosting-deployment observation. Actual withdrawal waiting follows chain time and is not forced into those bounds. Record an evidence-based finite adjustment before retrying a diagnostic; never alter economic or acceptance limits.

## Implementation architecture and interface handoff

Keep `src/app` as page/HTTP orchestration and `src/features/vault/{domain,server,ui}` as the feature boundary. Wallet provider belongs in a client scope. Server code holds RPC/read-model configuration, never operational signing material. Pin the Voltr SDK version compatible with the deployed program; adapt its instruction representation at one boundary instead of copying layouts throughout React.

Freeze a small typed interface after R00 preflight and before parallel implementation:

- `GET /api/vault`: identity, fees/terms, LP accounting, disjoint allocation components, catalog availability and freshness/reconciliation status.
- `GET /api/position?wallet=…`: public wallet USDC/LP state and its receipt/claim eligibility. Public chain reads do not require an invented login/session database.
- `POST /api/transactions/prepare`: discriminated `deposit | request-withdraw | claim` request; pinned unsigned transaction, preview, observation identity and expiry. No arbitrary program/accounts/recipient input. Claim amount/recipient come from the verified receipt/program.
- `GET /api/transactions/status?signature=…&wallet=…`: verifies exact wallet/vault/action effects and reports submitted/confirmed/finalized/reconciled or typed failure/unknown. This endpoint is read-only and does not invent a new financial event database.

All monetary fields cross JSON as raw decimal strings with mint/decimals; valuation includes quote unit/source/slot/time. Return explicit unavailable reasons and separate on-chain truth from optional cached operational context. Endpoint names above are the proposed shared implementation interface; acceptance is their behavior, not source-string presence.

## Bounded implementation assignments (sequential under one worker)

The following were written for GLM subagents. Under the current assignment they are executed sequentially by **one** implementation worker; the concurrency limit below is retained as the cap for any future parallel authorization. No subagents are launched by this contract. Use the model identifier actually available in the target harness; do not silently substitute another model. Keep at most three implementation agents active together and one coordinator controlling integration.

**Coordinator — preflight, verifier and integration.** Adopt this contract; read applicable repository instructions; establish branch/base and R00; create the sole verifier bootstrap and capture the complete baseline. Freeze the interface and numeric measurement parameters. Own the verifier, root workspace/lock files, configuration, deployment integration and cross-repository coordination. Collect agent patches and behavioral evidence, resolve boundaries, and run fast/full verification. A GLM agent must not edit the acceptance contract to pass its own work.

**Agent A — read model and accounting.** Own `src/features/vault/domain` and read-side server modules/routes. Implement R00/R02/R06 against current account/SDK/runtime state, including LP escrow, coherent valuation, reconciliation and unknown exposure. Provide the typed interface and a real read-only slice before handing it to B/C. Do not write manager state. Request any minimal worker observation export through the coordinator; do not edit the Phase 3 worktree.

**Agent B — user transactions and recovery.** After A's interface is frozen, own transaction server modules/routes and the UI-independent client transaction state machine. Implement R01/R03/R04/R05 with the pinned SDK, exact account restrictions, wallet binding and signature/effect reconciliation. Prove negative behavior through focused real-component slices. Never use the operational signer, send live transactions or add a sponsor.

**Agent C — partner page and wallet UI.** After the shared interface is frozen, own page/client providers and `src/features/vault/ui`. Implement overview, allocation, wallet balances, deposit/request/claim, pending receipt state and activity links under R02–R07. Use B's state machine and A's values; do not duplicate NAV or instruction construction. Development fixtures must be visibly isolated from the live app and cannot satisfy verifier evidence.

Agents return: changed files, observed behavior/evidence, remaining failing condition IDs and concrete dependencies. No invented PASS claims, broad refactors, new policies, direct deployment or money movement. An agent blocked on an interface finishes independent work and reports the dependency instead of creating a parallel implementation.

Sequence: coordinator baseline/preflight → A's contract/read slice → B and C work independently alongside A's accounting completion → coordinator integrates and verifies local behavior → authorized hosted deployment → authorized live journey → full verifier and handoff. All-three-agent concurrency is useful only after shared contracts exist.

At each iteration run cheap falsifiers and affected slices; do not repeat unchanged expensive checks. On completion report which durable invariants were promoted into existing validation and retire temporary goal-specific checks rather than creating a permanent stack of historical verifier prerequisites. Keep the final proof report and this contract as the completion record.

## Pilot cutover (2026-09-16)

The pilot client uses strategy-two config `DCpR24Eb6xCWxDyaZvCBTkadkxCB2vkqJN1EfYNWtLxY` and its strategy authority. The deployed worker pins config v2 and ticket v1; repository v3 source is not evidence of a deployed upgrade. Config bytes 416–471 are reserved and must be zero. These bytes do not contain a report sequence, observed slot or NAV. NAV freshness remains unknown until matching consumed-report evidence is available. Deposits remain unavailable pending current-release service and lifecycle verification.

The current strategy receipt is version 2, 192 bytes. Its custody-tracking value at offset 128 is decoded and disclosed separately; it is not added to measured allocation. Reserved receipt ranges 123–127 and 136–191 must remain zero. Config bounds are pinned to 1,000,000,000,000 raw maximum reported NAV and 32 slots, matching the worker. These are adaptor bounds, not the smaller 100 USDC pilot deposit limit.

Read-only verification at finalized slot 447474064 attributed the current receipt and manager USDC account (both recorded zero), and rejected mutated config reserved bytes and receipt version/padding. Scoped lint and typecheck passed. This is account-reader verification, not deposit readiness or a lifecycle test.

Run `bun scripts/verify-pilot-accounts.ts --live` from the demo app for the bounded finalized account-reader check. It uses the configured read-only RPC (public mainnet by default), verifies genesis and the current coherent batch, then mutates local copies to prove numeric config bounds and receipt version/padding are rejected. The retained verifier passed at finalized slot 447474257. It does not send transactions or prove deposit readiness.

Deposit preparation also requires a positive on-chain Voltr cap no larger than 100,000,000 raw USDC (100 USDC). A smaller cap remains effective. This gate does not lower the chain cap itself and cannot replace its installation: concurrent deposits and direct wallet calls must be limited by Voltr. The preflight verifier covers an oversized/zero/negative cap, exact remaining capacity, and a one-unit overflow, while retaining withdrawal-claim checks. All 20 checks pass locally.

### Pilot report ticket read — 2026-09-16

`verify-pilot-accounts.ts --live` now checks the v1 ticket in the same finalized batch as the vault/config/receipt/custody. At slot 447487174 it was unarmed with consumed sequence zero. The decoder requires explicit non-executable evidence and rejects identity, reserved-byte and armed-state mutations. This establishes neither report age nor NAV: matching consumed-report transaction/journal evidence remains required. Typecheck and scoped lint passed. The fast verifier still fails missing release/lifecycle gates and currently exposes an empty-LP withdrawal-arithmetic assumption in R02; do not report readiness from the account-reader pass.


### Empty-vault verifier correction — 2026-09-16

The demo verifier now distinguishes an empty circulating LP supply/asset balance from a funded withdrawal snapshot. It requires both positive withdrawal helpers to refuse with the pinned SDK supply/assets error when empty, and preserves the existing withdrawal/receipt arithmetic assertions for funded snapshots. It does not fabricate an LP supply or turn the unavailable quote into a zero payout. The fast verifier completes R02 without the prior `Invalid LP supply` exception and retains FAIL for the actual missing deployment/accounting/lifecycle gates. Typecheck and scoped lint pass. This is a verifier correction, not a deposit-readiness change.


### Consumed-report wire decoder — 2026-09-16

Added a narrow client decoder for the current zero-capital `REPORT_NAV` transaction: one pinned delegate/Squads/NAV-policy instruction, exact two-instruction arm/Voltr payload, full pinned account arrays, identical report payloads, zero capital amount, supported report version, nonzero sequence/digest, sequence equal to observed slot and bounded NAV. It returns wire facts only and makes no signature validity, finality, consumed-report or freshness claim. The current Go `CompileBridgeMessage` generated the checked-in unsigned vector (`scripts/fixtures/client-report-compiler-vector.json`); it is artificial and never submitted. `verify-report-wire.ts` matches the current compiler report/message hash, rejects all 1,027 truncations and five amount/sequence/NAV/digest/mode mutations. Typecheck and scoped lint pass.

Fable confirmed the minimal next integration: existing server-side DB access locates the latest report signature; finalized transaction/trace verification supplies the evidence; each public and wallet-preparation coherent batch separately matches current disarmed ticket/sequence, receipt NAV and age. Candidate worker observation report fields must never supply consumed evidence. Post-report capital mutations, unresolved work, service/release readiness and cap checks remain separate deposit gates. The server integration below adds consumed-report evidence; deposits remain unavailable pending the other gates.


### Finalized consumed-report matching — local verification

Public vault and wallet observations now locate the report in the journal, then verify finalized transaction signature, message hash, slot and exact arm/Voltr/consume trace. The deployed v2 consume check includes all 78 bytes and nine accounts. Current disarmed ticket sequence, receipt NAV, accounting identity and slot bounds must match.

The optional read shares a three-second database/RPC deadline, also bounded by fifteen seconds from the start of the enclosing observation. RPC calls make one attempt. Expired evidence returns unknown. Controlled verification passes 107 cases, including consume payload/account mutations and expired observations. Typecheck and scoped lint pass. These fixtures establish neither a live report nor deposit readiness; current worker reconciliation, deployment identity, cap installation and the live lifecycle remain required.
