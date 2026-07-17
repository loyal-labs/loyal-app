# Verifier: Loyal ClickStack test deployment on Render

Run this verifier cold from `/Users/taequn/loyal/loyal-apps`. Report PASS or FAIL for every Required condition, include command/API evidence, and return overall PASS only when every Required condition passes. Do not weaken a condition because deployment is difficult.

## Required

1. Repository state and scope

- `git status --short` contains only the intended observability/deploy-isolation changes before commit, and is clean after the deployment commit.
- A standalone `observability/` project contains the ClickStack Render Blueprint, pinned Docker definition, startup/configuration, a repeatable verifier, and a README with deploy, rollback, persistence, cost/limitations, and test commands.
- It is not added to the root Bun workspaces and no frontend/app/admin/dashboard/mobile/extension runtime code or lockfile changed.
- No plaintext secret or credential exists in the diff or tracked observability files.

2. Deploy isolation

- Every observability Render service has `rootDir: observability` and a complete `buildFilter` whose positive paths are only `observability/**` and whose `ignoredPaths` is explicitly present.
- `observability/**`-only changes do not match existing Vercel, extension, mobile, package-release, or mirror deployment triggers; unrelated-path-only changes do not match the observability build filter. A checked-in script proves these cases and exits nonzero on a negative fixture.
- Existing Vercel deployment configuration is unchanged unless evidence proves an edit is required.

3. Static and local validation

- `render blueprints validate observability/render.yaml` exits 0.
- The Docker image is pinned by immutable digest, binds the ClickStack UI to `0.0.0.0:$PORT`, exposes no database port publicly, persists MongoDB and ClickHouse state beneath the one Render disk mount, disables upstream usage telemetry, and has a readiness check that fails when the UI is unavailable.
- `docker build` succeeds. A local container returns HTTP 200 for the UI; accepts valid authenticated OTLP logs, metrics, and traces canaries only on the exact bounded endpoints; keeps `/v1/workflows` and every other `/v1/*` path closed; stores the uniquely named log in ClickHouse; and retains that same log after recreating the container against the same volume.

4. Live Render end-state

- A separate Render project/environment for Loyal observability contains exactly the intended initial ClickStack test service; it is not placed in either yield-worker project.
- The service is sourced from the deployed repository commit, has one paid persistent disk, one instance, path-filtered auto-deploy, and only the nginx UI/gateway HTTP port is public. ClickHouse, MongoDB, and the collector's OTLP ports are not publicly reachable.
- The latest deploy status is `live`; its public HTTPS URL and configured health path return 2xx/3xx.
- From inside the live service, valid authenticated OTLP logs, metrics, and traces canaries are accepted through nginx, unsupported paths remain rejected, and a uniquely named log is queryable in ClickHouse. After one controlled service restart, the same log is still queryable.
- Recent deploy/runtime logs show ClickHouse, MongoDB, the OTel collector, and HyperDX running with no crash loop, fatal startup error, or repeated readiness failure.

5. Handoff quality

- The implementation plan clearly separates the gateway paths from later service instrumentation and higher-volume ingestion work.
- The final report gives the project/service identity, public UI URL, deployed commit, disk/instance choice, exact verification results, current non-production limitations, and any unavoidable manual account/bootstrap step. It does not print secrets.

## Nice to have

- A machine-readable smoke-test result artifact is produced without storing credentials.

## Verdict

Overall PASS only if all five Required sections pass. Otherwise overall FAIL, list each false condition, preserve this verifier unchanged, and continue the plan-do-verify loop unless blocked by user-only authentication or billing approval.
