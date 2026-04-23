# DIY Feature Flags And Feature Registry Design

## Summary

Build an internal platform that serves two related but distinct purposes across the monorepo:

1. Runtime feature flag management for all apps:
   - Telegram mini-app (`app`, Next.js)
   - Website (`frontend`, Next.js)
   - Mobile (`mobile`, React Native / Expo)
   - Browser extension (`extension`, HTML + JS)
2. Product capability tracking so the team can answer:
   - which features exist in which apps
   - what evidence supports that status
   - which runtime flags, if any, control those features

The system should live inside the existing repo and use the existing admin app as the management UI. It should avoid third-party platform cost and keep v1 intentionally narrow.

## Goals

- Provide one internal source of truth for runtime flags across all apps.
- Provide one internal source of truth for feature presence by app.
- Support lightweight operational updates without redeploying apps.
- Keep v1 targeting simple:
  - app
  - environment
  - audience (`all`, `public`, `team`)
- Attach manual evidence to feature status:
  - file paths
  - branch names
  - PR URLs
  - Linear issue links or IDs
  - commit SHAs
  - docs links
- Reuse existing monorepo patterns:
  - schema in `packages/db-core`
  - admin CRUD in `admin`
  - shared runtime logic in a new package

## Non-Goals

- No percentage rollouts in v1.
- No experimentation or analytics platform behavior.
- No automatic inference of feature status from PRs, branches, commits, or file paths.
- No realtime push transport in v1 (WebSocket/SSE).
- No dynamic targeting engine beyond app/environment/audience.
- No external SaaS dependency for core functionality.

## Product Model

The platform should treat `features` and `flags` as separate first-class concepts.

### Features

A feature represents a product capability, for example:

- `extensive_token_list`
- `private_send`
- `wallet_receive_qr`

The question a feature answers is:

> Is this capability present in app X, and what evidence supports that claim?

### Flags

A flag represents a runtime switch, for example:

- `wallet_new_send_flow`
- `show_beta_portfolio`

The question a flag answers is:

> Should this behavior be enabled for audience Y in app X and environment Z?

### Evidence

Evidence is attached to a feature's status for a specific app. It does not determine status automatically. It exists to make the status credible and auditable.

## Architecture

### Packages And Apps

#### `packages/db-core`

Owns shared schema and exported types for:

- features
- feature app statuses
- feature evidence
- flags
- feature-flag links

#### `packages/flags`

New shared package that owns:

- flag manifest types
- evaluation context types
- pure client-side evaluation logic
- typed access helpers
- caching and hydration primitives shared by apps where practical

This package must stay runtime-agnostic and should not depend on Next.js, Expo, or extension-specific APIs directly.

#### `admin`

Owns internal management UI and server actions for:

- Features
- per-app feature status
- evidence CRUD
- Flags
- feature-flag linking
- manifest publishing metadata

#### Runtime apps

All runtime apps consume only the published flag manifest and the shared evaluator from `packages/flags`.

## Data Model

### `features`

Purpose: canonical capability registry.

Suggested fields:

- `id`
- `key` unique, stable slug
- `title`
- `description`
- `owner`
- `notes`
- `createdAt`
- `updatedAt`

### `feature_app_statuses`

Purpose: track a feature independently for each app.

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

Purpose: attach manual proof to a specific feature-app status.

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

Examples:

- `path` -> `frontend/src/components/wallet-sidebar/all-tokens-view.tsx`
- `branch` -> `task/diy-feature-flags-admin`
- `pr` -> `https://github.com/.../pull/123`
- `linear` -> `ASK-123`
- `commit` -> `abc1234`

### `flags`

Purpose: runtime switch definitions.

Suggested fields:

- `id`
- `key` unique
- `description`
- `enabled`
- `audience`
- `targetApps` JSONB string array
- `targetEnvironments` JSONB string array
- `notes`
- `createdAt`
- `updatedAt`

Enum:

- `audience`
  - `all`
  - `public`
  - `team`

For v1, `targetApps` and `targetEnvironments` should be stored as JSONB arrays instead of a normalized join table to keep CRUD and manifest generation simple.

### `feature_flag_links`

Purpose: optional many-to-many link between product capabilities and runtime switches.

Suggested fields:

- `id`
- `featureId`
- `flagId`
- `createdAt`

Constraint:

- unique `(featureId, flagId)`

## Manifest Design

Only flags are delivered to runtime apps.

### Manifest shape

```json
{
  "version": "2026-04-10T12:00:00.000Z",
  "generatedAt": "2026-04-10T12:00:00.000Z",
  "flags": [
    {
      "key": "wallet_new_send_flow",
      "enabled": true,
      "audience": "team",
      "targetApps": ["website", "extension"],
      "targetEnvironments": ["development", "preview"],
      "updatedAt": "2026-04-10T11:58:00.000Z"
    }
  ]
}
```

### Versioning

V1 will use the ISO timestamp of the most recently updated flag row as `version`. `generatedAt` will be the current manifest generation time.

### Delivery

Expose a single public runtime endpoint that returns the full manifest.

Example:

- `app/src/app/api/flags/manifest/route.ts`
- public URL shape: `/api/flags/manifest`

This route belongs in the `app` Next.js service because it already exposes public API routes and can act as the shared runtime backend for website, mobile, and extension consumers. The endpoint must return only non-sensitive runtime flag data.

## Evaluation Model

Evaluation happens client-side in `packages/flags`.

### Context shape

```ts
type FlagEvaluationContext = {
  app: "telegram_miniapp" | "website" | "mobile" | "extension";
  environment: "development" | "preview" | "production";
  isTeam: boolean;
};
```

### Evaluation rules

For each flag:

1. `enabled` must be `true`
2. current `app` must be in `targetApps`
3. current `environment` must be in `targetEnvironments`
4. audience must match:
   - `all` => true
   - `public` => true when `isTeam === false`
   - `team` => true when `isTeam === true`

### Trust model

`team` evaluation must rely on trusted app auth/session state, not local user-editable values.

If a runtime surface cannot determine trusted team membership, it must evaluate `team` flags as `false`.

## Refresh Strategy

V1 should use the approved "next refresh / within a few minutes" model.

### Website and Telegram mini-app

- fetch manifest on app bootstrap
- cache in memory
- refresh every 5 minutes while the app is active

### Mobile

- persist manifest locally
- refresh on app foreground
- refresh every 5 minutes while the app is active
- fall back to last known manifest when offline

### Extension

- background script fetches and stores manifest
- UI/content surfaces read from background-owned state or shared storage
- refresh on browser startup and every 5 minutes in the background

## Admin UI

### Features list

New route:

- `admin/src/app/(admin)/features/page.tsx`

Columns:

- feature key
- title
- website status
- telegram status
- mobile status
- extension status
- linked flags count

### Feature detail

New route:

- `admin/src/app/(admin)/features/[featureId]/page.tsx`

Sections:

- feature metadata
- per-app status cards
- evidence table per app status
- linked flags

### Flags list

New route:

- `admin/src/app/(admin)/flags/page.tsx`

Columns:

- key
- enabled
- audience
- target apps
- target environments
- linked features count
- updated at

### Forms and actions

Follow existing admin patterns:

- server actions in route-local `actions.ts`
- table + sheet/dialog editing
- `revalidatePath()` after mutations

The admins flow in `admin/src/app/(admin)/admins/*` is the baseline pattern to follow.

## Package Boundaries

### `packages/flags`

V1 exports:

- `types.ts`
- `evaluate-flag.ts`
- `evaluate-flags.ts`
- `get-flag-value.ts`
- `manifest-cache.ts`

V1 avoids framework-specific helpers in the core package. Adapters live alongside consuming apps when needed.

### `packages/db-core`

Add table definitions and exported inferred select/insert types.

### `admin`

Keep DB access through `admin/src/lib/core/database.ts` and shared schema imports only, consistent with existing repo guardrails.

## Operational Workflow

### Feature tracking flow

1. Create a feature record.
2. Set per-app status manually.
3. Attach evidence to each non-missing status.
4. Optionally link one or more flags.

### Flag management flow

1. Create or update a flag in admin.
2. Flag update changes manifest version.
3. Apps pick up new manifest on next refresh.

## Testing Strategy

### `packages/flags`

Unit tests:

- app matching
- environment matching
- audience matching
- all-false fallback behavior
- multi-flag evaluation

### `packages/db-core`

Type-level and schema sanity checks through existing package build/typecheck paths.

### `admin`

Server action tests:

- create/update/delete feature
- create/update/delete feature app status
- create/update/delete evidence
- create/update/delete flag
- create/delete feature-flag links

### Manifest endpoint

Tests:

- only returns active flag records
- serializes correct shape
- version changes when flags change

## Security and Privacy

- Feature evidence is internal metadata and should never be exposed to runtime clients.
- Runtime manifest should contain only what apps need to evaluate flags.
- Team gating must be based on trusted session state per app.
- Internal admin routes remain behind existing admin auth.

## Rollout Plan

### Phase A

- Add schema
- add `packages/flags`
- add manifest endpoint

### Phase B

- Add `Flags` admin UI
- add `Features` admin UI
- add evidence linking

### Phase C

- Integrate runtime flag consumption into:
  - website
  - telegram mini-app
  - mobile
  - extension

### Phase D

- add polish:
  - linked feature/flag views
  - manifest cache observability
  - stronger typed flag access helpers

## Deferred Ideas

Explicitly deferred from v1:

- percentage rollouts
- user-level allowlists
- realtime push updates
- automatic code or PR inference
- audit logs
- approval workflow
- change history UI

## Open Questions Resolved For V1

- Percentage rollouts: no
- Feature status automation: no
- Evidence is manual only: yes
- Feature and flag records are separate: yes
- Runtime updates can be next refresh / few minutes: yes
