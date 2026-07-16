# Loyal observability pilot

This project deploys the first Loyal observability milestone: one self-hosted
ClickStack all-in-one service on Render. It is deliberately independent from
the Bun workspace and does not yet receive telemetry from frontend, mobile, or
extension clients.

## What this milestone deploys

- HyperDX UI and API on Render's public `PORT=8080` HTTPS route.
- ClickHouse, MongoDB, and the OpenTelemetry collector in the same container.
- One 10 GB Render persistent disk mounted at `/var/lib/clickhouse`.
- One Pro instance in the dedicated `loyal-observability / test` environment.
- Generated Render secrets for authenticated UI sessions and deterministic
  internal smoke ingestion. Secret values are never stored in this repository.
- A gated in-container verifier that writes one unique OTLP marker on its first
  boot, then queries the same marker without resending after later restarts.

Render publishes only the web service port. ClickHouse (`8123`/`9000`), MongoDB
(`27017`), and OTLP (`4317`/`4318`) are not public endpoints in this milestone.

On Render, the wrapper derives ClickStack's `FRONTEND_URL` from Render's
automatically injected `RENDER_EXTERNAL_URL`. HyperDX uses this origin for
post-login redirects, CORS, and secure session-cookie scope. Render startup
fails before serving traffic if that value is missing or is not a canonical,
non-loopback HTTPS origin. Local Docker runs retain ClickStack's normal
`http://localhost:8080` fallback.

## Implementation plan

1. **Pilot infrastructure (this milestone):** validate the pinned image and
   single-disk wrapper locally, link this Blueprint in Render, and prove that a
   marker survives a container/service restart.
2. **Collection boundary (next):** add a small authenticated public telemetry
   intake or gateway. Do not expose raw ClickHouse, MongoDB, or collector ports.
3. **App instrumentation (next):** add a shared observability client with
   platform-specific transports for frontend, mobile, and extension; define
   redaction, sampling, release/environment tags, and offline buffering.
4. **Operations (after signal quality is proven):** add retention policies,
   alerts, dashboards, backup/restore drills, capacity thresholds, and an
   upgrade runbook. Split the all-in-one components before treating it as
   production infrastructure.

## Verify locally

Requirements: Docker, `curl`, Node.js, `rg`, Git, and an authenticated Render
CLI. The script creates temporary Docker resources and removes them afterward.

```sh
./observability/scripts/verify.sh --local
```

This validates deployment isolation, validates the Blueprint, builds the exact
pinned image, starts ClickStack, posts a unique OTLP log on loopback, queries it
from ClickHouse, recreates the container with the same volume, and queries it
again. The non-secret result is written to `observability/smoke-result.json`
and ignored by Git.

Run only the static/isolation/Blueprint checks with:

```sh
./observability/scripts/verify.sh
```

## Deploy on Render

1. Commit and push this directory plus the package-release path exclusion.
2. In Render, create a Blueprint from
   `https://github.com/loyal-labs/loyal-app.git` and set **Blueprint Path** to
   `observability/render.yaml`.
3. Review the Pro instance and 10 GB disk charge, then apply the Blueprint.
4. Wait for `loyal-clickstack` to report `live` and verify
   `https://<service>.onrender.com/api/health`.
5. Run an internal OTLP marker/query from the Render shell, restart the service,
   and query the same marker again before accepting the deployment.

The pilot Blueprint enables the in-container verifier so this proof does not
depend on account-level SSH setup. Render logs emit a non-secret
`CLICKSTACK_SMOKE_RESULT` JSON record with `stage=initial` on the first boot and
`stage=persisted` after a restart.

Render watches only `observability/**`. Existing Vercel projects already watch
their own app/package paths, extension CI watches only its extension/package
paths, and package release now ignores observability-only commits.
`observability/smoke-result.json` is explicitly ignored by Render because it is
a local, Git-ignored verification artifact rather than deployable input.

## Persistence and rollback

ClickHouse owns `/var/lib/clickhouse`. The wrapper also places MongoDB at
`/var/lib/clickhouse/.clickstack/mongodb`, allowing all database state to fit
beneath Render's single disk mount. ClickHouse server log files remain
ephemeral; the wrapper forwards readiness plus fatal/critical server lines to
Render Logs without persisting Render's internal port-probe noise.

To roll back code, revert the deployment commit and let the Blueprint redeploy
the previous immutable image. Do not delete or reduce the disk. Before an image
downgrade or destructive schema change, take an application-consistent export;
Render disk snapshots alone are not a database-safe backup.

## Cost and limitations

The Blueprint uses a Pro web-service instance (4 GB RAM, 2 CPU) because that is
ClickStack's minimum test sizing, plus a 10 GB paid disk. Check current Render
pricing before applying because pricing can change.

This is a non-production pilot. ClickStack's all-in-one image shares one failure
and resource boundary across ClickHouse, MongoDB, the collector, and HyperDX.
The disk forces one instance, prevents zero-downtime deploys, and needs a real
database backup strategy. External telemetry ingestion is intentionally absent,
so creating a HyperDX account only validates the UI until the next milestone.

References:

- https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/all-in-one
- https://render.com/docs/blueprint-spec
- https://render.com/docs/monorepo-support
- https://render.com/docs/disks
