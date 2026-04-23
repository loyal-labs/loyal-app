# Frontend Flags V1 And Feature Registry Design

## Summary

Build an internal platform in the monorepo that serves two related purposes:

1. Runtime feature flag management for the Loyal web app in `frontend`
2. Cross-app feature tracking in `admin` so the team can see which capabilities exist in:
   - Telegram mini-app
   - Website
   - Mobile
   - Browser extension

This is intentionally a reduced v1. The admin data model and UI should already be ready for all apps, but runtime flag delivery and evaluation should only be wired for `frontend`.

## Goals

- Provide one internal source of truth for runtime flags used by `frontend`
- Provide one internal source of truth for feature presence across all apps
- Keep features and flags as separate concepts
- Support rich per-app feature status in admin:
  - `missing`
  - `planned`
  - `in_progress`
  - `implemented`
  - `live`
- Support manual evidence on feature status:
  - code paths
  - branch names
  - PR URLs
  - Linear issues
  - commit SHAs
  - docs links
- Keep the admin UI ready for future app integrations without pretending those apps are wired at runtime today

## Non-Goals

- No mobile, extension, or Telegram runtime flag consumption in v1
- No shared `packages/flags` package in v1
- No percentage rollouts in v1
- No experimentation platform behavior
- No automatic inference of feature status from code, PRs, or branches
- No realtime push transport in v1

## Product Model

### Features

A feature is a product capability such as:

- `extensive_token_list`
- `private_send`
- `wallet_receive_qr`

Features answer:

> Is this capability present in app X, and what evidence supports that claim?

### Flags

A flag is a runtime switch such as:

- `wallet_new_send_flow`
- `show_beta_portfolio`

Flags answer:

> Should this behavior be enabled in `frontend` for audience Y and environment Z?

### Why They Stay Separate

Features and flags must not be the same record.

- Many features will not need a runtime flag
- Many flags will be temporary rollout controls
- Feature tracking is a product/system inventory concern
- Flag evaluation is a runtime delivery concern

The system should allow linking features to flags, but neither should depend on the other to exist.

## Architecture

### `packages/db-core`

Owns shared schema and exported types for:

- `features`
- `feature_app_statuses`
- `feature_evidence`
- `flags`
- `feature_flag_links`

### `admin`

Owns internal CRUD UI and server actions for:

- feature list and detail
- per-app feature statuses
- evidence management
- flags management
- linking features to flags

The admin UI must present all four apps from day one:

- `telegram_miniapp`
- `website`
- `mobile`
- `extension`

### `app`

Owns the runtime manifest endpoint for v1.

For v1, this endpoint only publishes flags relevant to `frontend` runtime consumption.

### `frontend`

Owns the only v1 runtime consumer.

It should:

- fetch the published manifest
- cache it locally in memory
- evaluate flags for the current environment and audience
- expose small local helpers for reading flag state

This logic should live in `frontend` for now and can be extracted later when a second app needs the same runtime behavior.

## Data Model

### `features`

Purpose: canonical capability registry.

Suggested fields:

- `id`
- `key` unique stable slug
- `title`
- `description`
- `owner`
- `notes`
- `createdAt`
- `updatedAt`

### `feature_app_statuses`

Purpose: track a feature independently per app.

Suggested fields:

- `id`
- `featureId`
- `app`
- `status`
- `statusNote`
- `createdAt`
- `updatedAt`

Enums:

- `app`
  - `telegram_miniapp`
  - `website`
  - `mobile`
  - `extension`
- `status`
  - `missing`
  - `planned`
  - `in_progress`
  - `implemented`
  - `live`

Constraint:

- unique `(featureId, app)`

### `feature_evidence`

Purpose: attach manual proof to a feature-app status.

Suggested fields:

- `id`
- `featureAppStatusId`
- `type`
- `label`
- `value`
- `note`
- `createdAt`
- `updatedAt`

Enums:

- `type`
  - `path`
  - `branch`
  - `pr`
  - `linear`
  - `commit`
  - `doc`

### `flags`

Purpose: runtime switch definitions.

Suggested fields:

- `id`
- `key` unique
- `description`
- `enabled`
- `audience`
- `targetEnvironments`
- `notes`
- `createdAt`
- `updatedAt`

Enum:

- `audience`
  - `all`
  - `public`
  - `team`

For v1, flags do not need `targetApps` because runtime delivery is only for `frontend`. The admin UI can still visually indicate that these are currently website/frontend flags.

### `feature_flag_links`

Purpose: optional many-to-many links between features and flags.

Suggested fields:

- `id`
- `featureId`
- `flagId`
- `createdAt`

Constraint:

- unique `(featureId, flagId)`

## Admin UX

### Features List

The primary feature view should be a capability matrix, not a flat list.

Required characteristics:

- one row per feature
- visible columns for all four apps
- each cell shows the feature status for that app
- filters or search by key/title/status

This UI is intentionally not scoped down. It should look like a multi-app operations tool from v1.

### Feature Detail

Each feature detail page should show:

- feature metadata
- one card or section per app
- current status and note for each app
- evidence entries for each app status
- linked flags

### Flags List

The flags view should support:

- creating flags
- editing key, description, audience, environments, notes
- enabling/disabling a flag
- linking flags to features

This page can be explicit that v1 runtime delivery is only active for `frontend`.

## Runtime Manifest

Only flags are published to runtime apps.

For v1, the manifest is frontend-only.

Suggested shape:

```json
{
  "version": "2026-04-10T12:00:00.000Z",
  "generatedAt": "2026-04-10T12:00:00.000Z",
  "flags": [
    {
      "key": "wallet_new_send_flow",
      "enabled": true,
      "audience": "team",
      "targetEnvironments": ["development", "preview"]
    }
  ]
}
```

Important behavior:

- only include enabled/defined flags intended for `frontend`
- version the payload so the client can cheaply detect changes
- keep the manifest intentionally simple

## Frontend Runtime Behavior

`frontend` should use a small local implementation rather than a shared cross-app package in v1.

Required behavior:

- fetch manifest from the server
- evaluate by:
  - `enabled`
  - `audience`
  - `environment`
- fail closed on malformed or missing flag data
- default unknown flags to `false`

Audience semantics:

- `all` -> everyone
- `public` -> non-team users
- `team` -> team users only

For v1, team/public membership should come from the best trusted auth/session signal already available in `frontend`. If trusted membership is unavailable, `team` should evaluate to `false`.

## Delivery Model

V1 does not need live push updates.

Acceptable behavior:

- fetch on app start
- refresh on navigation or after a short interval
- tolerate a short delay between admin changes and frontend visibility

This is enough for operational flag control without the complexity of WebSockets or SSE.

## Future Expansion Path

This design should leave a clean path for later work:

1. extract shared runtime evaluation from `frontend` into `packages/flags`
2. add app targeting to flags
3. wire Telegram mini-app runtime consumption
4. wire mobile runtime consumption
5. wire extension runtime consumption

The admin UI and schema should not need conceptual redesign when those phases arrive.

## Testing Expectations

V1 should include:

- schema-level tests or checks where existing repo patterns support them
- admin CRUD validation for:
  - features
  - app statuses
  - evidence
  - flags
  - feature-flag links
- frontend tests for local flag evaluation behavior
- manifest serialization tests

Critical cases:

- unknown flag returns `false`
- malformed manifest data fails closed
- `team` flags stay off without trusted team membership
- environment targeting works as expected

## Recommendation

This is the right v1 boundary:

- broad and honest admin model
- full multi-app feature tracking UI
- narrow runtime integration

It preserves the product and operational value you want now, while cutting out the highest-friction part of the original design: building a cross-app runtime platform before the second app actually needs it.
