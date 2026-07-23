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

for file in AUTH-REDIRECT-VERIFIER.md Dockerfile FRONTEND-ERRORS-VERIFIER.md README.md VERIFIER.md nginx.conf render.yaml scripts/entrypoint.sh scripts/smoke-auth-redirect.sh scripts/smoke-live.sh scripts/smoke-local.sh; do
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
require_literal 'CLICKSTACK_INTERNAL_SMOKE_ENABLED' "$blueprint"
require_literal 'generateValue: true' "$blueprint"
require_literal 'value: "8081"' "$blueprint"
require_literal 'value: 127.0.0.1' "$blueprint"
[[ "$(rg --count '^[[:space:]]+- type: (web|pserv|worker|cron|keyvalue)$' "$blueprint")" == "2" ]] \
  || fail "observability Blueprint must retain exactly two services"
pass "Blueprint pins monorepo scope, disk, health check, and generated secrets"

# Telegram relay. Cooldown state is in-process, so a second instance
# double-posts every alert. Render reserves port 10000 on the private network
# and supports healthCheckPath on web services only.
require_literal 'name: loyal-clickstack-telegram-relay' "$blueprint"
require_literal 'rootDir: observability/telegram-relay' "$blueprint"
require_literal 'value: "3000"' "$blueprint"
rg --quiet 'healthCheckPath: /healthz' "$blueprint" \
  && fail "private services do not support healthCheckPath"
[[ "$(rg --after-context=20 'name: loyal-clickstack-telegram-relay' "$blueprint" | rg --count 'numInstances: 1')" == "1" ]] \
  || fail "telegram relay must stay pinned to numInstances: 1"
pass "Telegram relay pins single instance, non-reserved port, and no health check"

require_literal '2.31.0@sha256:b01cc48cb5aaf30d630865a88217c826ab86fb9828374201f6cd7c539d5beed1' "$project_dir/Dockerfile"
require_literal 'nginx=1.30.4-r0' "$project_dir/Dockerfile"
require_literal 'tini=0.19.0-r3' "$project_dir/Dockerfile"
require_literal 'HYPERDX_APP_PORT=8081' "$project_dir/Dockerfile"
require_literal 'HYPERDX_APP_LISTEN_HOSTNAME=127.0.0.1' "$project_dir/Dockerfile"
require_literal 'USAGE_STATS_ENABLED=false' "$project_dir/Dockerfile"
require_literal 'COPY nginx.conf /etc/nginx/nginx.conf' "$project_dir/Dockerfile"
require_literal '!nginx.conf' "$project_dir/.dockerignore"
require_literal '/var/lib/clickhouse/.clickstack' "$project_dir/scripts/entrypoint.sh"
require_literal 'link_state_directory /data/db' "$project_dir/scripts/entrypoint.sh"
require_literal '/var/log/clickhouse-server/clickhouse-server.err.log' "$project_dir/scripts/entrypoint.sh"
require_literal 'tail -n 0 -F' "$project_dir/scripts/entrypoint.sh"
require_literal 'RENDER_EXTERNAL_URL' "$project_dir/scripts/entrypoint.sh"
require_literal 'export FRONTEND_URL=' "$project_dir/scripts/entrypoint.sh"
require_literal 'export FRONTEND_URL="http://localhost:$PORT"' "$project_dir/scripts/entrypoint.sh"
require_literal 'wait_for_collector_authentication' "$project_dir/scripts/entrypoint.sh"
require_literal '401|403' "$project_dir/scripts/entrypoint.sh"
require_literal 'nginx -t -c /etc/nginx/nginx.conf' "$project_dir/scripts/entrypoint.sh"
require_literal "nginx -g 'daemon off;'" "$project_dir/scripts/entrypoint.sh"
require_literal 'CLICKSTACK_SMOKE_RESULT' "$project_dir/scripts/smoke-live.sh"
if rg --quiet 'loyal-clickstack-smoke-live[[:space:]]*&' "$project_dir/scripts/entrypoint.sh"; then
  fail "Render security smoke must fail the container instead of running detached"
fi

require_literal 'listen 0.0.0.0:8080' "$project_dir/nginx.conf"
require_literal 'proxy_pass http://127.0.0.1:8081' "$project_dir/nginx.conf"
require_literal 'location = /v1/logs' "$project_dir/nginx.conf"
require_literal 'proxy_pass http://127.0.0.1:4318/v1/logs' "$project_dir/nginx.conf"
require_literal 'location = /v1/metrics' "$project_dir/nginx.conf"
require_literal 'proxy_pass http://127.0.0.1:4318/v1/metrics' "$project_dir/nginx.conf"
require_literal 'location = /v1/traces' "$project_dir/nginx.conf"
require_literal 'proxy_pass http://127.0.0.1:4318/v1/traces' "$project_dir/nginx.conf"
require_literal 'location ^~ /v1/' "$project_dir/nginx.conf"
require_literal 'client_max_body_size 64k' "$project_dir/nginx.conf"
require_literal 'proxy_connect_timeout 1s' "$project_dir/nginx.conf"
require_literal 'proxy_send_timeout 5s' "$project_dir/nginx.conf"
require_literal 'proxy_read_timeout 5s' "$project_dir/nginx.conf"
require_literal 'proxy_hide_header Access-Control-Allow-Origin' "$project_dir/nginx.conf"
require_literal '!-f /tmp/loyal-clickstack-collector-auth-ready' "$project_dir/nginx.conf"
require_literal ': > "$collector_auth_ready_file"' "$project_dir/scripts/entrypoint.sh"
for signal in logs metrics traces; do
  require_literal "/v1/$signal" "$project_dir/scripts/entrypoint.sh"
done
[[ "$(rg --count 'client_max_body_size 64k' "$project_dir/nginx.conf")" == "3" ]] \
  || fail "public proxy must define one 64 KiB body limit per OTLP endpoint"
[[ "$(rg --count 'location = /v1/' "$project_dir/nginx.conf")" == "3" ]] \
  || fail "public proxy must define exactly three exact OTLP endpoint locations"
if rg --quiet 'location = /v1/workflows' "$project_dir/nginx.conf"; then
  fail "the nonexistent /v1/workflows path must not be proxied"
fi
# Non-upgrade requests must resolve to an empty value so nginx omits the
# Connection header entirely.
require_literal "    '' '';" "$project_dir/nginx.conf"
require_literal \
  'proxy_set_header Connection $connection_upgrade;' \
  "$project_dir/nginx.conf"
require_literal 'metrics_probe_payload=' "$project_dir/scripts/smoke-live.sh"
require_literal 'traces_probe_payload=' "$project_dir/scripts/smoke-live.sh"
require_literal 'for signal in metrics traces' "$project_dir/scripts/smoke-live.sh"
require_literal 'default.otel_logs' "$project_dir/scripts/smoke-live.sh"
require_literal 'default.otel_logs' "$project_dir/scripts/smoke-local.sh"
require_literal 'loyal.clickstack.smoke' "$project_dir/scripts/smoke-local.sh"
require_literal 'traceId' "$project_dir/scripts/smoke-local.sh"
require_literal 'send_signal_canaries' "$project_dir/scripts/smoke-local.sh"
require_literal '/v1/metrics' "$project_dir/scripts/smoke-live.sh"
require_literal '/v1/traces' "$project_dir/scripts/smoke-live.sh"
require_literal 'CLICKSTACK_SMOKE_HTTP_RESPONSE' "$project_dir/scripts/smoke-live.sh"
require_literal 'CLICKSTACK_INTERNAL_SMOKE_ENABLED=true' "$project_dir/scripts/smoke-local.sh"
nginx_log_format="$(awk '/log_format loyal/{capture=1} capture{print} capture && /;/{exit}' "$project_dir/nginx.conf")"
if rg --quiet '\$request\b|\$args\b|\$http_referer|\$http_user_agent|\$http_authorization' <<<"$nginx_log_format"; then
  fail "proxy access logs or config reference sensitive request metadata"
fi
if rg --quiet --ignore-case 'add_header[[:space:]]+Access-Control-Allow' "$project_dir/nginx.conf"; then
  fail "public proxy must not add collector CORS response headers"
fi
if rg --quiet -- '--publish[^[:cntrl:]]*(4318|8123|9000|27017)' "$project_dir/scripts/smoke-local.sh"; then
  fail "local smoke must not publish collector or database ports"
fi
pass "single public proxy exposes only bounded authenticated logs, metrics, and traces endpoints"

sh -n "$project_dir/scripts/entrypoint.sh" "$project_dir/scripts/smoke-live.sh"
bash -n "$project_dir/scripts/smoke-local.sh" "$project_dir/scripts/smoke-auth-redirect.sh"
pass "observability shell scripts pass syntax checks"

if rg --quiet --glob '!**/verify.sh' 'BEGIN [A-Z ]*PRIVATE KEY|op://|RENDER_API_KEY=' "$project_dir"; then
  fail "tracked observability files contain a forbidden credential or upstream public secret"
fi
pass "image is immutable and tracked files contain no obvious plaintext credential"

[[ -f "$repo_root/frontend/scripts/verify-observability.ts" ]] \
  || fail "missing focused frontend observability verifier"
if rg --quiet 'NEXT_PUBLIC_[A-Z0-9_]*(INGESTION|OBSERVABILITY)[A-Z0-9_]*(KEY|TOKEN)' \
  "$repo_root/frontend"; then
  fail "frontend contains a browser-exposed observability credential name"
fi
bun "$repo_root/frontend/scripts/verify-observability.ts"
pass "frontend error contract, privacy, failure, and wiring verifier passes"

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
git -C "$tmp_repo" config commit.gpgsign false
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
  pass "local production startup smoke, OTLP canaries, log query, and volume-recreation test"
  "$script_dir/smoke-auth-redirect.sh"
  pass "hosted authentication redirects, CORS, cookies, and local fallback smoke test"
elif [[ -n "${1:-}" ]]; then
  fail "unknown option: $1 (expected --local or no option)"
else
  printf 'INFO: Docker smoke test skipped; rerun with --local for the full local proof.\n'
fi
