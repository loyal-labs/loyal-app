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
  after authentication resolves, the visible account selection is restored,
  main-account USDC resolves, smart-account and vault balances load, the Earn
  state and position resolve, and React paints the result. An anonymous session
  paints no balance, so it is not observed at all rather than reported as a
  fast load.
- `interaction_to_preview` starts when the user submits a deposit, withdrawal,
  close, or Autodeposit close and ends after the prepared review is painted. A
  bypassed review uses `loyal.presentation=wallet`. Autodeposit setup drafts its
  review before preparing, so its observation instead starts at the confirmation
  and ends when preparation completes immediately before the wallet prompt, and
  always reports `loyal.presentation=wallet`.
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

## Verify

From the repository root:

```sh
bun run --cwd frontend verify:loading-metrics
./node_modules/.bin/tsc --noEmit --project frontend/tsconfig.json --pretty false
bun run --cwd frontend lint
```

Do not run a local frontend production build.
