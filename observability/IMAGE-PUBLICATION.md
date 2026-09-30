# Manual observability image publication

Source-only preparation: no workflow has run and no image digest is claimed here. A parent-reviewed publication commit must contain this workflow,
the selected ClickStack changes and the pinned relay base. Publish only that
reviewed ref; checkout and OCI revision labels use its exact `github.sha`.

The workflow builds `linux/amd64` from `observability/Dockerfile` and
`observability/telegram-relay/Dockerfile`, following existing checkout@v4,
setup-buildx@v3, login@v3, build-push@v6 and upload-artifact@v4 conventions.
It publishes only full `sha-<commit>` tags under
`ghcr.io/<lowercase-owner>/<lowercase-repository>/{clickstack,telegram-relay}`.
No moving release tag is published. GHCR tags can be overwritten on a rerun;
the exported `image@sha256:...` reference is the immutable deployment identity.

Each matrix job exports its image reference, digest, exact revision, platform and
run ID in a separate `hetzner-observability-<image>-<commit>-<attempt>` artifact.
Publication can partially succeed; require both receipts before parent handoff.
The digest is Buildx's output (potentially an OCI index with attestations).
Parent must independently resolve its linux/amd64 child/configuration, confirm
the exact revision label and retained source hashes, and review runtime identity
before updating any release manifest. Package visibility/pull access is a
separate boundary; this workflow does not change it.

ClickStack's existing context ignore excludes three current COPY inputs. The
workflow writes an ephemeral Dockerfile-specific ignore with precisely all
current COPY inputs, excluding relay files and untracked rehearsal evidence.
It does not alter the tracked context ignore or the ClickStack Dockerfile.

## Public Bun base provenance (2026-09-30)

Anonymous pull-scoped Docker Hub metadata resolution used `auth.docker.io` and
`registry-1.docker.io/v2/oven/bun/manifests/1.3.11-slim`. SHA-256 of each raw
manifest response matched its `Docker-Content-Digest` header. The official tag
index selected the descriptor with OS `linux` and architecture `amd64`:

- Index: `sha256:478281fdd196871c7e51ba6a820b7803a8ae97042ec86cdbc2e1c6b6626442d9`
- Pinned amd64 manifest: `sha256:49a1dfafe49d774e0b75a17bd596d5a8e49231c1fab76d9a30b6fc690c30f30e`
- Referenced configuration: `sha256:287f39d1be80099129bb282dda3c031d34bde2f0e60c3d139950e8981fd13022`

Only index/manifest metadata was fetched; configuration environment, layers and
local registry credentials were not read. ClickStack's upstream `b01cc48c...`
pin remains unchanged. Local relay tests passed (70 tests, Bun 1.3.14); container
execution with pinned Bun 1.3.11 remains unmeasured.

Publication, target pull/runtime, original-source equivalence, persistent restore,
relay singleton ownership, full V6 and cutover acceptance remain unresolved.
No host, source service or canonical manifest is changed by this preparation.

## First publication trigger

GitHub requires a workflow_dispatch file on the default branch before manual
dispatch receives events. The workflow therefore also accepts pushes only to
`codex/hetzner-clickstack-20260929`, and only when its own file or observability
files change. The parent-reviewed push is the first publication action; it
builds that exact pushed commit without a default-branch merge. Other branch
pushes do not publish these images. Review and signing access must precede the
push. Manual dispatch remains usable after default-branch registration is
verified. Neither trigger activates a host or updates a release manifest.

Provider contract: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
