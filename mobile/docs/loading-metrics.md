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
  result close the metric. Blur, wallet replacement, and the bounded morph
  timeout close an abandoned attempt as failed rather than dropping it.

Every Earn attempt gets a random flow UUID and exactly one terminal outcome.
App load gets a random process-session UUID. Allowed dimensions are operation,
phase, outcome, platform, normalized path, flow/session IDs, environment, and
release. Wallet addresses, amounts, signatures, query strings, response data,
and arbitrary extra fields are rejected.
