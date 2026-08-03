# Mobile loading metrics

The app reports privacy-safe loading gauges through
`POST /api/observability/mobile/metrics`. The relay validates a strict
allowlist and exports OTLP to ClickStack without exposing its ingestion key to
the app.

The gauge is `loyal.mobile.loading.duration`, in milliseconds. It records:

- `app_load`: process entry in `index.js` through wallet authentication, Earn
  position, token holdings, and Autodeposit reads, followed by the final paint.
- `earn.deposit`, `earn.withdrawal`, and `earn.refund`: interaction through the
  confirmed action, refreshed state, and final paint.
- Autodeposit `setup`, `floor_update`, `pause`, `resume`, `close`, and
  `execute_now`: interaction through the authoritative refreshed UI state. An
  execute-now attempt stays open until its resulting activity is observed.
  Both a completed worker result and an authoritative failed/released/canceled
  result close the metric; a missing terminal state remains open until timeout.

Every Earn attempt gets a random flow UUID and exactly one terminal outcome.
App load gets a random process-session UUID. Allowed dimensions are operation,
phase, outcome, platform, normalized path, flow/session IDs, environment, and
release. Wallet addresses, amounts, signatures, query strings, response data,
and arbitrary extra fields are rejected.

## Android emulator verifier

Prerequisites:

- Android SDK, `adb`, and an AVD (default: `SkyVerse_API_35`)
- JDK 21 (`JAVA_HOME` or the Homebrew `openjdk@21` location)
- Podman with its machine running
- the repository's current `observability/` directory (set
  `MOBILE_METRICS_CLICKSTACK_CONTEXT` when testing from an older mobile branch
  that predates that directory)
- a funded keypair explicitly approved for real Earn mutations

Run from `mobile/`:

```sh
MOBILE_E2E_WALLET_KEYPAIR=/absolute/path/to/keypair.json \
  bun run verify:loading-metrics:e2e
```

The verifier starts a disposable full ClickStack instance and a strict local
native relay. It launches the dev client, copies the key to the app-private
emulator sandbox, deletes both staging and app-private copies during
unconditional cleanup, and executes real deposit, Autodeposit setup/scheduled
execution/floor update/pause/resume/close, full withdrawal, and eligible refund
paths. It then queries the database for every mandatory metric and proves that
no wallet, amount, or signature dimensions were stored.

The verifier requires successful metrics for the app load and every directly
signed mobile policy/action path. Execute-now is asynchronous infrastructure:
the verifier accepts either a completed or failed terminal metric, reports the
observed outcome, and continues the remaining lifecycle. It still fails on an
ambiguous timeout, and the worker failure remains visible in lifecycle
telemetry rather than being reclassified as success.

To verify only the native relay, OTLP export, and real ClickStack table without
loading a wallet or starting an emulator, run:

```sh
bun run verify:loading-metrics:e2e --relay-only
```

The deposit defaults to $0.01 and can be raised with
`EXPO_PUBLIC_E2E_DEPOSIT_USD`. The verifier cleans up the Autodeposit and Earn
position it creates. It must only be run with an explicitly approved test
wallet because it signs and submits real transactions.
