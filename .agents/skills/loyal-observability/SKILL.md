---
name: loyal-observability
description: Investigate Loyal production incidents using the ClickStack MCP and, when needed, Render deployment evidence. Use for user reports, wallet or flow lookups, frontend or mobile errors, Earn and Autodeposit failures, regressions, missing telemetry, error-pattern comparisons, and production incident diagnosis in loyal-apps.
---

# Loyal Observability

Use ClickStack as the telemetry truth. Use Render only to check the ClickStack deployment or its infrastructure.

## Investigate

| Phase | Action |
| --- | --- |
| Scope | Establish the environment and a bounded UTC window. Ask only when they cannot be inferred. |
| Discover | List sources before assuming source IDs, tables, or schemas. |
| Find | Use the strongest identifier available. Prefer a flow ID, wallet, page session, error code, service, or operation. |
| Reconstruct | Order matching events by timestamp and follow each flow through its full attempt. |
| Correlate | Compare `service.version` with `loyal.client.build_id` when a deploy or stale client may matter. |
| Escalate | Check Render only when the evidence suggests an ingestion gap or infrastructure fault. |
| Broaden | Expand the time range gradually. Prefer semantic search and pattern tools, then bounded SQL. |
| Report | State the observed impact and timeline. Identify the failing stage, relevant version, likely cause, confidence, and unknowns. |

Read [references/telemetry.md](references/telemetry.md) for Loyal fields and flow interpretation. Read [references/setup.md](references/setup.md) only for installation or connection work.

## Evidence rules

Separate observed facts from inference. Include reproducible timestamps and identifiers, but never print credentials. A missing terminal event is ambiguous because the user may have left, closed the app, crashed, or lost connectivity. Alert silence only means there was no new notification. When expected telemetry is missing, distinguish absent application activity from broken ingestion.

Treat `chain.state=confirmed` with `persistence.state=failed` as an on-chain success followed by a Loyal recording failure. Resolve duplicate-action risk before recommending a retry.

## Safety

Default to read-only investigation. Require explicit approval before mutating ClickStack objects or changing Render state. Bound raw SQL by time and result size, and inspect unfamiliar source metadata first.

Do not expose financial values, signatures, transactions, request data, authentication material, query strings, or chat content. Wallet addresses are searchable by design but must remain scoped to the investigation.
