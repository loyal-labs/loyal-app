# Frontend loading metrics

The Loyal frontend reports privacy-safe loading durations through the
same-origin `POST /api/observability/metrics` relay. The relay validates a
strict allowlist and exports OTLP JSON to the configured ClickStack
`/v1/metrics` endpoint with the server-only ingestion key.

The metric is a gauge named `loyal.frontend.loading.duration`, measured in
milliseconds. Each observation has these bounded dimensions:

| Attribute               | Values                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `loyal.operation`       | `page_load`, `earn.deposit`, `earn.withdrawal`, `earn.close`, `earn.autodeposit.setup`, `earn.autodeposit.close` |
| `loyal.phase`           | `balances_ready`, `interaction_to_preview`, `wallet_confirmation_to_ui`, `dependency`                            |
| `loyal.outcome`         | `completed`, `failed`                                                                                            |
| `loyal.dependency`      | `loyal_api`, `solana_rpc`, `third_party_api` for dependency observations                                         |
| `loyal.presentation`    | `in_app` or `wallet` for prepared-transaction visibility                                                         |
| `loyal.request.count`   | Number of matching Resource Timing entries in a dependency observation                                           |
| `loyal.flow.id`         | Random per-attempt UUID for Earn operations                                                                      |
| `loyal.page_session.id` | Random per-tab UUID                                                                                              |
| `url.path`              | Normalized frontend pathname without a query or fragment                                                         |

No wallet address, amount, transaction signature, request body, URL query, or
vendor response is accepted by the metric envelope.

## Boundaries

- `page_load` / `balances_ready` starts at browser navigation start and ends
  after authentication resolves, the connected account address and wallet
  holdings load, the Earn position resolves, and the facelift sidebar paints
  its final wallet, stablecoin, crypto, Earn, and total balances. An anonymous
  session paints no account balance, so it is not observed rather than reported
  as a fast load.
- `interaction_to_preview` starts when the user submits a deposit, withdrawal,
  close, or Autodeposit close and ends after the prepared review is painted. A
  bypassed review uses `loyal.presentation=wallet`. Autodeposit setup reports
  the draft review itself as `loyal.presentation=in_app`; dependency timing
  still covers the preparation work that begins after that draft is confirmed.
- `wallet_confirmation_to_ui` starts immediately after the wallet returns a
  submitted transaction, before chain confirmation, and ends after React paints
  the updated balance or Autodeposit state.
- `dependency` measures Resource Timing entries that begin during preparation,
  collected through a `PerformanceObserver` scoped to that window so a full
  Resource Timing buffer cannot silently zero the observation. Same-origin
  `/api/*` calls are Loyal API, the configured connection endpoint is Solana
  RPC, and other HTTP origins are third-party APIs. Durations are summed within
  each category, so a category total can exceed wall-clock time when requests
  overlap.

Loading telemetry is best-effort. A rejected, timed-out, or unavailable metrics
relay never blocks a user action.

## Mobile loading metrics

The Expo app reports the gauge `loyal.mobile.loading.duration` to the native-only
`POST /api/observability/mobile/metrics` relay. The relay accepts no browser
origin headers, validates the same strict contract as the app, and exports the
observation with `service.name=loyal-mobile`. Device-provided environment and
release values describe the installed binary or OTA release rather than the
Vercel relay deployment.

| Attribute              | Values                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loyal.operation`      | `app_load`, `earn.deposit`, `earn.withdrawal`, `earn.refund`, and Autodeposit `setup`, `floor_update`, `pause`, `resume`, `close`, or `execute_now` |
| `loyal.phase`          | `app_ready` for app startup; `interaction_to_ui` for an Earn action                                                                                 |
| `loyal.outcome`        | `completed`, `failed`                                                                                                                               |
| `loyal.flow.id`        | Random per-attempt UUID for Earn actions                                                                                                            |
| `loyal.app_session.id` | Random per-process UUID                                                                                                                             |
| `loyal.platform`       | `android`, `ios`                                                                                                                                    |
| `url.path`             | Normalized Expo Router pathname without a query or fragment                                                                                         |

`app_load` starts in `mobile/index.js`, before Expo Router is imported, and
ends after authentication, account address, wallet holdings, Earn position, and
Autodeposit state have resolved and the final screen has painted. Earn actions
start at the user's submit or confirm interaction and end after the confirmed
chain result is refreshed and painted. Failed terminal attempts are observed
once; retry attempts receive a new flow ID.

The mobile envelope rejects wallet addresses, token amounts, transaction
signatures, request bodies, and extra attributes. Telemetry remains best-effort
and cannot make a user action fail.
