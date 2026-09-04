# Loyal telemetry reference

## Primary services and identifiers

| Field | Meaning |
| --- | --- |
| `ServiceName` | Includes `loyal-frontend` and `loyal-mobile` |
| `loyal.flow.id` | One operation attempt; use for a complete timeline |
| `loyal.wallet.address` | Authenticated wallet lookup |
| `loyal.flow.name` | Product flow |
| `loyal.flow.variant` | Flow mode, such as initial, resumed, or top-up |
| `loyal.flow.stage` | Last recorded step |
| `loyal.flow.outcome` | `started`, `observed`, `completed`, `failed`, or `cancelled` |
| `loyal.error.code` | Stable failure category |
| `loyal.error.detail` | Bounded underlying cause where available |
| `service.version` | Server-side deployment that ingested the event |
| `loyal.client.build_id` | Full Git SHA compiled into the browser bundle |
| `loyal.page_session.id` | Random identifier for one browser tab session |

## Flows

The recorded flows are `auth.sign_in`, `auth.smart_account_provisioning`, `earn.deposit`, `earn.withdrawal`, `earn.autodeposit.configuration`, and `earn.autodeposit.execute_now`.

Deposit variants include `initial`, `resumed`, and `top_up`. Autodeposit configuration variants include `setup`, `floor_update`, `pause`, `resume`, and `close`.

## Useful filters

```sql
ServiceName = 'loyal-frontend' AND SeverityText = 'error'
```

```sql
LogAttributes['loyal.flow.id'] = '<flow-id>'
```

```sql
LogAttributes['loyal.wallet.address'] = '<wallet>'
```

```sql
LogAttributes['loyal.flow.name'] = 'earn.deposit'
AND LogAttributes['loyal.flow.outcome'] = 'failed'
```

## Interpretation

| Signal | Meaning |
| --- | --- |
| `completed` | The flow finished. |
| `failed` | Loyal or a dependency failed. |
| `cancelled` | The user dismissed the flow or rejected a wallet prompt. |
| No terminal event | The user may have abandoned the flow, crashed, or lost connectivity. |
| `chain.state=confirmed` with `persistence.state=failed` | The chain action succeeded and Loyal persistence failed afterward. |
| `ChunkLoadError` | Recovery has not yet been evaluated. Check `loyal.chunk.recovery_action` and later events from the same page session. |
