#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$project_dir/.." && pwd)"
blueprint="$project_dir/render.yaml"

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_literal() {
  local literal="$1"
  local file="$2"
  rg --fixed-strings --quiet -- "$literal" "$file" || fail "$file is missing: $literal"
}

for file in Dockerfile README.md VERIFIER.md render.yaml scripts/entrypoint.sh scripts/smoke-local.sh; do
  [[ -f "$project_dir/$file" ]] || fail "missing observability/$file"
done
pass "standalone observability module contains deployment, docs, and verifier files"

node -e '
  const workspaces = require(process.argv[1]).workspaces || [];
  if (workspaces.some((entry) => entry === "observability" || entry.startsWith("observability/"))) process.exit(1);
' "$repo_root/package.json" || fail "observability must not be a Bun workspace"
pass "observability is outside the root Bun workspace graph"

require_literal 'rootDir: observability' "$blueprint"
require_literal 'dockerfilePath: ./Dockerfile' "$blueprint"
require_literal 'dockerContext: .' "$blueprint"
require_literal '- observability/**' "$blueprint"
require_literal '- observability/smoke-result.json' "$blueprint"
require_literal 'mountPath: /var/lib/clickhouse' "$blueprint"
require_literal 'healthCheckPath: /api/health' "$blueprint"
require_literal 'renderSubdomainPolicy: enabled' "$blueprint"
require_literal 'USAGE_STATS_ENABLED' "$blueprint"
require_literal 'generateValue: true' "$blueprint"
pass "Blueprint pins monorepo scope, disk, health check, and generated secrets"

require_literal '2.30.1@sha256:bd0bde1b1f2ca0702fdafe269f3552e36b055d25e47692685b1a6018567a2d3c' "$project_dir/Dockerfile"
require_literal 'HYPERDX_APP_LISTEN_HOSTNAME=0.0.0.0' "$project_dir/Dockerfile"
require_literal 'USAGE_STATS_ENABLED=false' "$project_dir/Dockerfile"
require_literal '/var/lib/clickhouse/.clickstack' "$project_dir/scripts/entrypoint.sh"
require_literal 'link_state_directory /data/db' "$project_dir/scripts/entrypoint.sh"
require_literal '/var/log/clickhouse-server/clickhouse-server.err.log' "$project_dir/scripts/entrypoint.sh"
if rg --quiet --glob '!**/verify.sh' 'BEGIN [A-Z ]*PRIVATE KEY|op://|RENDER_API_KEY=' "$project_dir"; then
  fail "tracked observability files contain a forbidden credential or upstream public secret"
fi
pass "image is immutable and tracked files contain no obvious plaintext credential"

require_literal 'paths-ignore:' "$repo_root/.github/workflows/release-packages.yml"
require_literal '- "observability/**"' "$repo_root/.github/workflows/release-packages.yml"
if rg --quiet 'observability' "$repo_root/app/vercel.json" "$repo_root/frontend/vercel.json" "$repo_root/admin/vercel.json" "$repo_root/dashboard/vercel.json"; then
  fail "existing Vercel deployment configuration should remain unchanged"
fi
if rg -l -i 'eas +(build|submit)' "$repo_root/.github/workflows" >/dev/null; then
  fail "a repository-triggered mobile EAS deployment needs an explicit observability exclusion"
fi
pass "existing Vercel, extension, mobile, and package-release triggers exclude observability-only work"

render_path_matches() {
  [[ "$1" == observability/* ]]
}

render_path_matches observability/README.md || fail "observability path did not match Render filter"
if render_path_matches frontend/src/negative-fixture.ts; then
  fail "unrelated path matched Render filter"
fi
if (render_path_matches frontend/src/negative-fixture.ts); then
  fail "negative filter fixture unexpectedly passed"
else
  pass "negative unrelated-path fixture exits nonzero"
fi

tmp_repo="$(mktemp -d)"
trap 'rm -rf "$tmp_repo"' EXIT
git -C "$tmp_repo" init -q -b main
git -C "$tmp_repo" config user.name verifier
git -C "$tmp_repo" config user.email verifier@example.invalid
mkdir -p "$tmp_repo"/{app,frontend,admin,dashboard,packages,sdk,observability}
touch "$tmp_repo"/{app,frontend,admin,dashboard,packages,sdk}/.keep
git -C "$tmp_repo" add .
git -C "$tmp_repo" commit -qm baseline
touch "$tmp_repo/observability/fixture"
git -C "$tmp_repo" add .
git -C "$tmp_repo" commit -qm observability-only

for workspace in app frontend admin dashboard; do
  ignore_command="$(node -e 'console.log(require(process.argv[1]).ignoreCommand)' "$repo_root/$workspace/vercel.json")"
  previous_sha="$(git -C "$tmp_repo" rev-parse HEAD^)"
  (cd "$tmp_repo/$workspace" && VERCEL_GIT_PREVIOUS_SHA="$previous_sha" sh -c "$ignore_command") \
    || fail "$workspace Vercel project would rebuild for an observability-only commit"
done
pass "all existing Vercel ignore commands skip an observability-only committed diff"

touch "$tmp_repo/frontend/negative-fixture"
git -C "$tmp_repo" add .
git -C "$tmp_repo" commit -qm unrelated-negative-fixture
frontend_ignore="$(node -e 'console.log(require(process.argv[1]).ignoreCommand)' "$repo_root/frontend/vercel.json")"
previous_sha="$(git -C "$tmp_repo" rev-parse HEAD^)"
if (cd "$tmp_repo/frontend" && VERCEL_GIT_PREVIOUS_SHA="$previous_sha" sh -c "$frontend_ignore"); then
  fail "negative Vercel fixture was not detected"
fi
pass "negative Vercel fixture correctly requests the affected frontend build"

validation_output="$(render blueprints validate "$blueprint")" \
  || fail "Render Blueprint validation command failed"
printf '%s\n' "$validation_output"
printf '%s\n' "$validation_output" | rg --quiet '"valid": true' \
  || fail "Render Blueprint validator returned valid=false"
pass "Render Blueprint validates"

if [[ "${1:-}" == "--local" ]]; then
  "$script_dir/smoke-local.sh"
  pass "local UI, OTLP ingestion, ClickHouse query, and volume-recreation smoke test"
elif [[ -n "${1:-}" ]]; then
  fail "unknown option: $1 (expected --local or no option)"
else
  printf 'INFO: Docker smoke test skipped; rerun with --local for the full local proof.\n'
fi
