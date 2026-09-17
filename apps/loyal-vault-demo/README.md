# loyal-vault-demo

Local partner demo for the fixed Loyal/Backyard mainnet Voltr USDC vault. The
acceptance contract is [the adopted verifier plan](../../docs/loyal-vault-demo-verifier.md).
The capped pilot client is deployed with deposits disabled. Implementation and live acceptance remain in progress; partner-fund readiness is not established.

Run from the repository root:

```sh
bun install --ignore-scripts
bun run --cwd apps/loyal-vault-demo dev --hostname 127.0.0.1 --port 3037
bun run --cwd apps/loyal-vault-demo typecheck
bun run --cwd apps/loyal-vault-demo lint
bun run --cwd apps/loyal-vault-demo verify:demo --tier full --report /tmp/loyal-vault-demo-report.json
```

Do not run a local frontend production build. A successful typecheck or local
browser check does not satisfy the full acceptance contract.

## Connections and ownership

- Server reads use `LOYAL_VAULT_DEMO_RPC_URL` when injected through the approved
  secret environment; otherwise they use Solana's public mainnet endpoint.
  Never put private RPC credentials in a client variable or plaintext env file.
- The browser uses the explicitly approved public transport
  `https://solana-rpc.publicnode.com`, including future wallet-authorized
  submissions. It verifies mainnet genesis before prompting a wallet. The
  original Solana public endpoint returned HTTP 403 in the local browser;
  PublicNode returned the expected mainnet genesis. Transport approval does
  not authorize an agent to sign or submit a live transaction.
- The server only reads and prepares unsigned transactions. The wallet signs;
  the browser checks the exact message and signature, persists nonsensitive
  recovery identifiers, then makes one submission attempt.
- The existing Go manager remains the sole money-routing worker. Deposits are
  unavailable until its standing servicing observation is integrated and current.
  Eligible claims depend on the on-chain receipt and idle liquidity.

## Recovery and current limits

The browser retains wallet, signature, action, message fingerprint and blockhash
expiry, blockhash and creation time in wallet-scoped storage. It never stores a key or signed transaction.
A Web Lock protects the final persistence/submission gate across tabs. Modern
HTTPS/localhost browsers with Web Locks and Ed25519 verification are required.

Unreadable or malformed recovery metadata blocks new preparation and signing;
it is never treated as an absent transaction or automatically deleted.

Unknown submission outcomes remain pending and are checked by signature. Recent
expired operations can be released only after finalized blockhash invalidity
and a subsequent history search still show no transaction. Browser validity uses
`isBlockhashValid`: PublicNode was observed returning a slot from `getBlockHeight`,
inconsistent with the expiry height in its own `getLatestBlockhash` response. Older ambiguous records remain pending
for investigation; an old absent history result is not proof of nonexecution.

`/api/kamino` discovers obligations owned by the pinned smart account using a
server-side owner scan, with a 15-second shared cache and a 30-second failure
backoff. It decodes raw collateral and scaled debt amounts, shows update slots,
and reports unsupported accounts as unknown. The dashboard displays these
observations separately from strategy accounting. Stored reserve conversions use the pinned Kamino SDK, round collateral down
and debt up, and reread funded obligations plus reserves in one batch. Current
valuations, standing worker observation, deployment, and the authorized live
deposit/restoration/withdrawal journey remain unfinished.
Strategy receipt accounting values are explicitly reported values, not
independently reconciled Kamino exposure.

Worker observations use `LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL` on the server
only. Observation access is provisioned by `sql/provision-observation-readonly.sql`
(as database owner): it creates one LOGIN role, `loyal_vault_demo_observation`,
whose only privileges are `SELECT` on three route-pinned, column-filtered views —
`loyal_yield.pilot_route_observation` (lease columns, ten admitted servicing
observation fields, pilot-activation and manual-hold booleans; never the raw
state/observation JSON), `loyal_yield.pilot_operations` (journal metadata
leaves), and `loyal_yield.pilot_report_locators` (reconciled REPORT_NAV
signature, message hash and confirmed slot). There are no base-table, write,
schema-creation or role-administration grants; the role is also forced to
`default_transaction_read_only` with a bounded statement timeout. Generate the
credential out of band and set it with `ALTER ROLE ... PASSWORD` or the Neon
console; never commit, log or widen it. All three readers pin
`rwa-multiply:ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh`, use read-only
transactions, and never select signed wire or full route state.
`GET /api/worker` returns 503 while access is unconfigured or invalid. Lease,
observation freshness, route demand and latest journal action are disclosures;
none enables deposits or substitutes for receipt/chain verification. Database
access and a live worker comparison have not yet been verified.

The coherent vault batch includes the smart account’s canonical USDC ATA. Its
amount is included only when adaptor configuration and strategy receipt bindings
match this vault; missing canonical custody is disclosed as absent at that slot.
Measured custody totals exclude manager-reported strategy receipt values. Those
records appear separately in the dashboard. Partial custody totals cannot prove
full allocation reconciliation, even if they happen to equal reported NAV.

To include the checked-in controlled browser recovery cases in the sole verifier,
start the local dev server and run:

```sh
LOYAL_VAULT_DEMO_BROWSER_BASE_URL=http://127.0.0.1:3037 bun run verify:demo --tier full --report /tmp/loyal-vault-demo-report.json
```

The harness requires the existing `agent-browser` CLI, Node and Bun. It opens an
isolated browser, supplies synthetic API observations, and intercepts every
nonlocal request. Its test wallet replays static signatures for fixed invalid
blockhashes; the verifier has no private key and performs no cryptographic
signing. It checks disconnect during quote preparation and signing, signature
refusal, lost-response tracking with reconnect, expiry without automatic
resubmission, competing tabs, account switching during signing, and pending
transaction isolation between two accounts, and manual refresh of all four data
sources. These controlled checks do not prove a live lifecycle. Test-only code lives under `scripts/browser`, outside app routes.

## Hosting preparation

The candidate Vercel Root Directory is `apps/loyal-vault-demo`. Its checked-in
`vercel.json` installs from the repository root with the frozen Bun lockfile,
builds only the demo's workspace dependencies through Turbo, and then builds
Next.js on the host. Do not execute that production build locally.

The isolated Vercel project is `loyal-vault-pilot` (`prj_8ejszAxfkHoSnzHeP1dicwig8D9O`,
scope `loyals-projects-4b3ed656`). Release `14ab1dd5` is deployed; its page and
vault API returned HTTP 200 with the expected identity and 100-USDC cap. The
restricted-view reader is now provisioned; a deployment of the current source is in progress.
Keep the RPC URL and least-privilege worker observation database URL in server-only hosting variables;
neither has a `NEXT_PUBLIC_` equivalent. The approved public browser RPC needs no
secret. Do not attach operational signer credentials or start another worker.
A preview can demonstrate unavailable-service states, but it does not establish
partner-fund readiness. The full verifier still requires hosted identity,
hydration, bounded reads, and the separately authorized live vault journey.

The dashboard's Refresh button and finalized transaction outcomes refresh the
vault and wallet views plus Kamino positions and servicing observations. Server
cache windows still apply; requesting a refresh does not claim a new chain slot.

The inspected Go runtime (`backyardrwa/nav_observe.go`) computes total vault NAV
as idle USDC plus strategy equity. Strategy equity includes disjoint strategy
and smart-account token custody, collateral value, and debt subtraction. The
Voltr SDK accounts for accrued fees through LP supply and values escrowed shares
against reported vault value; pending requests are not an additional blanket
subtraction from measured custody. These source rules do not explain the current
custody/report discrepancy or prove which runtime is deployed. Keep that
mismatch visible until transaction history and current reporting reconcile it;
do not insert an unexplained balancing amount into allocation.

After a failed vault or servicing read, the UI retains the last successful fetch
time for that data source, while clearing unavailable data. Fetch time is not
NAV freshness or proof that the manager remains active. The controlled browser
harness exercises vault failure and recovery and checks that balances are hidden
until a successful response returns.

Kamino rows also show recorded collateral/debt USD values, conservative net equity
and unweighted LTV from the obligation's stored `marketValueSf` fields. These
values retain the obligation update slot and freshness label. Missing values on
nonzero positions produce unavailable valuation. This historical display does
not supply current transaction prices, liquidation thresholds, or USDC NAV
reconciliation; collateral rounds down, debt and LTV round up.

Deposit preflight refuses unknown or exceeded vault capacity as well as stale or
unavailable NAV. Claim preflight remains based on the wallet's receipt, escrow,
on-chain deadline and sufficient idle USDC. The sole verifier includes focused
boundary checks for these gates; they do not replace the live withdrawal proof.

Controlled visibility checks exercise the actual read hooks with successful
fixture responses: scheduled requests stop for longer than the five-second
poll interval when hidden and resume when visible. The verifier intercepts all
requests; this is browser component evidence, not a production RPC budget or
native operating-system visibility measurement.

The browser verifier also displays distinct receipts for two controlled accounts
and returns one wallet's prepared transaction to the other. The real client
rejects that foreign quote before opening a signing prompt, preserves the first
wallet's pending recovery record, and makes no additional submission attempt.

With the local browser harness enabled, R05 now evaluates direct wallet changes
during quote preparation and signing, signature refusal, ambiguous submission,
expiry, RPC failure, distinct receipts and foreign-quote rejection, together with
NAV/liquidity preflight and recovery-storage invariants. R05 passed in the full
local verifier run; overall acceptance remains FAIL pending the other conditions.

A controlled finalized-failure response exercises the transaction-outcome refresh
path: all four data sources refresh, the matching recovery record clears, another
wallet's record remains, and no retry is sent. Production outcome reconciliation
and multi-viewer RPC consumption still require their own evidence.

`GET /api/holdings` discovers both SPL and Token-2022 accounts for the fixed smart
account, then rereads token accounts and mints in one finalized batch. Discovery
is bounded to 50 accounts per program and 100 combined token/mint accounts, with
a 15-second shared cache and 30-second failure backoff. Unknown layouts, ownership,
mint metadata or regressing slots fail visibly. Nonzero balances are displayed
separately, without assuming token pegs, transfer availability or NAV attribution.
The holdings panel participates in manual and finalized-outcome refreshes.

Holdings discovery passes its latest observed slot as `minContextSlot` to the
final batch. A lagging node may receive one retry with the same slot floor;
a returned older slot is rejected. Holdings RPC calls allow two attempts of
six seconds each, with 400 ms between attempts. No weaker commitment or older
snapshot is substituted to make a read succeed.

Known cash-token labels (USDC, PYUSD, USDG and CASH) are keyed by exact mint from
the runtime/fleet catalog. Other mints remain visible as unknown tokens with
explorer links. Labels do not imply a $1 peg, a price quote, supported routing,
or exclusive attribution of that smart-account balance to this vault.

The full verifier can measure actual shared reads with
`LOYAL_VAULT_DEMO_VERIFY_READ_BUDGET=1`. It starts an isolated local Next dev
server on port 3038 (which must be free), uses two disconnected browser
sessions with controlled visible documents, and counts only allowlisted read
methods through a loopback relay to Solana's public mainnet RPC. It makes no
transaction submissions. The 11-second polling window permits at most 15
combined upstream requests; the whole run is capped at 60. The owned server
and browser are stopped afterward. This proves local sharing, not a distributed
hosting cache or native OS visibility behavior. No production build is run.

## Deposit release gate

Deposits remain closed unless `LOYAL_VAULT_DEMO_DEPOSITS_ENABLED=1` and the
server pins `LOYAL_VAULT_DEMO_WORKER_SERVICE_ID` plus an immutable
`LOYAL_VAULT_DEMO_WORKER_IMAGE=sha-<40-character commit>`. Set these only after
the released financed lifecycle and rotation acceptance passes.

Both the public read and fresh wallet preparation check the same gate: active
release lease, activated pilot budget, no manual hold or pending transaction,
matching fresh consumed report, no later reconciled action, current worker
NAV/custody matching the chain batch, and remaining capacity under 100 USDC.
Missing evidence closes deposits. Withdrawal request and eligible claim paths
remain independent. The service read uses a two-second deadline within the
existing total observation deadline; it does not reuse the display-only worker
cache for authorization.

The observation database role needs no direct table access for this gate: the
manual-hold and pilot-activation evidence arrives through the pinned
`loyal_yield.pilot_route_observation` view, and the newest reconciled operation
through `loyal_yield.pilot_operations` (see
`sql/provision-observation-readonly.sql`). Never grant signed-wire or signer
access to this role. `scripts/verify-deposit-service.ts` exercises the
admission conditions with controlled inputs; it is not live readiness proof.

## Restricted-reader rollout checkpoint (2026-09-17)

The three reader queries passed against production data using the new role inside
a transaction that was rolled back. Only the three pilot views were selectable;
unrelated routes returned no rows, and base-table access, writes and schema
creation were denied. The initial test left no role or views installed. Automatic approval
review required explicit approval to create the persistent login and store its
generated connection credential in this pilot project under the server-only
`LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL` variable (Production and Preview).
The user subsequently approved provisioning and credential delivery. The restricted
role and views are now installed. An actual login verified all three queries,
read-only defaults, a five-second timeout and no base-table access; the generated
credential was delivered directly to the approved Vercel variable without a file.

The sole verifier now independently evaluates offered deposits against a fresh
chain batch, a consumed report verified against that same batch, and fresh worker
evidence inside one bounded deadline. Controlled checks accept one valid row and
reject 37 altered variants. The fast-tier run remains FAIL: these checks do not
replace funded wallet flow, rotation, deployed reader access or browser evidence.

## Browser acceptance follow-up (2026-09-17)

The release checkout omitted `scripts/browser/wallet.json`, which prevented the
recovery harness from starting. Restored the original public-only fixture after
checking its field allowlist, both Ed25519 signatures, and exact equality with the
current claim builder at the two fixed invalid blockhashes. It contains public
keys and pre-signed test messages only; no private key or new signing operation.

The full verifier at this source now records R05 PASS: all 14 recovery scenarios
pass with zero network submissions. The two-browser read-budget check also passes
(shared immediate reads; two upstream requests in the 11-second window). R00 now
checks actual consumed-report proof instead of rejecting reserved zero config
fields unconditionally. It correctly fails while the consumed ticket is missing.
Overall release acceptance remains FAIL pending live and hosted evidence.
