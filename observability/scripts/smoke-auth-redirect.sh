#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"
image="loyal-clickstack:auth-smoke"
external_origin="https://observability.example.test"
render_container="loyal-clickstack-auth-render-$$"
render_volume="$render_container"
local_container="loyal-clickstack-auth-local-$$"
local_volume="$local_container"
render_port="${CLICKSTACK_AUTH_RENDER_PORT:-18280}"
local_port="${CLICKSTACK_AUTH_LOCAL_PORT:-18380}"
tmp_dir="$(mktemp -d)"

cleanup() {
  docker rm -f "$render_container" "$local_container" >/dev/null 2>&1 || true
  docker volume rm "$render_volume" "$local_volume" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

fail() {
  echo "ClickStack authentication-origin smoke test failed: $1" >&2
  docker logs --tail 160 "$render_container" >&2 2>/dev/null || true
  exit 1
}

header_value() {
  local header_name="$1"
  local header_file="$2"
  awk -v name="$header_name" '
    tolower(substr($0, 1, length(name) + 1)) == tolower(name ":") {
      sub(/\r$/, "");
      sub(/^[^:]+:[[:space:]]*/, "");
      print;
      exit;
    }
  ' "$header_file"
}

header_values() {
  local header_name="$1"
  local header_file="$2"
  awk -v name="$header_name" '
    tolower(substr($0, 1, length(name) + 1)) == tolower(name ":") {
      sub(/\r$/, "");
      sub(/^[^:]+:[[:space:]]*/, "");
      print;
    }
  ' "$header_file"
}

wait_for_health() {
  local port="$1"
  local container="$2"
  for _ in $(seq 1 180); do
    if curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    if ! docker inspect "$container" --format '{{.State.Running}}' 2>/dev/null | grep -qx true; then
      fail "$container exited before health became ready"
    fi
    sleep 1
  done
  fail "$container did not become healthy"
}

docker build --tag "$image" "$project_dir"
docker volume create "$render_volume" >/dev/null
docker volume create "$local_volume" >/dev/null

assert_render_origin_rejected() {
  local label="$1"
  local origin="${2:-}"
  local args=(
    --rm
    --env RENDER=true
    --env PORT=8080
    --env EXPRESS_SESSION_SECRET=invalid-origin-session-secret
    --env INGESTION_API_KEY=invalid-origin-ingestion-key
  )

  if [ -n "$origin" ]; then
    args+=(--env "RENDER_EXTERNAL_URL=$origin")
  fi

  if docker run "${args[@]}" "$image" >/dev/null 2>&1; then
    fail "Render fixture accepted $label external URL"
  fi
}

assert_render_origin_rejected "a missing"
assert_render_origin_rejected "a malformed" "not-a-url"
assert_render_origin_rejected "a non-HTTPS" "http://observability.example.test"
assert_render_origin_rejected "a credentialed" "https://user:password@observability.example.test"
assert_render_origin_rejected "a query-bearing" "https://observability.example.test/?debug=true"
assert_render_origin_rejected "a fragment-bearing" "https://observability.example.test/#debug"
assert_render_origin_rejected "a path-bearing" "https://observability.example.test/hyperdx"
assert_render_origin_rejected "a localhost" "https://localhost"
assert_render_origin_rejected "an IPv4 loopback" "https://127.0.0.1"
assert_render_origin_rejected "an IPv6 loopback" "https://[::1]"

docker run --detach \
  --name "$render_container" \
  --mount "source=$render_volume,target=/var/lib/clickhouse" \
  --publish "127.0.0.1:${render_port}:8080" \
  --env RENDER=true \
  --env "RENDER_EXTERNAL_URL=$external_origin" \
  --env PORT=8080 \
  --env EXPRESS_SESSION_SECRET=auth-render-session-secret \
  --env INGESTION_API_KEY=auth-render-ingestion-key \
  --env USAGE_STATS_ENABLED=false \
  "$image" >/dev/null

wait_for_health "$render_port" "$render_container"

email="auth-smoke-$$@example.invalid"
password="Auth-smoke-password-2026!"
register_status="$(curl -sS -o "$tmp_dir/register-body" -w '%{http_code}' \
  -X POST "http://127.0.0.1:${render_port}/api/register/password" \
  -H 'X-Forwarded-Proto: https' \
  -H 'Content-Type: application/json' \
  --data "{\"email\":\"$email\",\"password\":\"$password\",\"confirmPassword\":\"$password\"}")"
[ "$register_status" = "200" ] || fail "registration returned HTTP $register_status"

success_status="$(curl -sS -o /dev/null -D "$tmp_dir/success-headers" -w '%{http_code}' \
  -X POST "http://127.0.0.1:${render_port}/api/login/password" \
  -H 'X-Forwarded-Proto: https' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "email=$email" \
  --data-urlencode "password=$password")"
success_location="$(header_value Location "$tmp_dir/success-headers")"
success_cookies="$(header_values Set-Cookie "$tmp_dir/success-headers")"
[ "$success_status" = "303" ] || fail "successful login returned HTTP $success_status"
[ "$success_location" = "$external_origin/" ] || fail "successful login used the wrong redirect origin"
grep -qi 'Domain=observability\.example\.test' <<<"$success_cookies" || fail "session cookie used the wrong domain"
grep -qi 'Secure' <<<"$success_cookies" || fail "session cookie was not secure"
grep -qi 'SameSite=Lax' <<<"$success_cookies" || fail "session cookie did not use SameSite=Lax"

failure_status="$(curl -sS -o /dev/null -D "$tmp_dir/failure-headers" -w '%{http_code}' \
  -X POST "http://127.0.0.1:${render_port}/api/login/password" \
  -H 'X-Forwarded-Proto: https' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'email=missing@example.invalid&password=not-the-password')"
failure_location="$(header_value Location "$tmp_dir/failure-headers")"
[ "$failure_status" = "303" ] || fail "failed login returned HTTP $failure_status"
[ "$failure_location" = "$external_origin/login?err=authFail" ] || fail "failed login used the wrong redirect origin"

curl -sS -o /dev/null -D "$tmp_dir/cors-headers" \
  "http://127.0.0.1:${render_port}/api/health" \
  -H "Origin: $external_origin"
cors_origin="$(header_value Access-Control-Allow-Origin "$tmp_dir/cors-headers")"
[ "$cors_origin" = "$external_origin" ] || fail "CORS used the wrong origin"

if rg -i 'localhost' "$tmp_dir/success-headers" "$tmp_dir/failure-headers" "$tmp_dir/cors-headers" >/dev/null; then
  fail "hosted authentication headers contain localhost"
fi

docker run --detach \
  --name "$local_container" \
  --mount "source=$local_volume,target=/var/lib/clickhouse" \
  --publish "127.0.0.1:${local_port}:8080" \
  --env PORT=8080 \
  --env EXPRESS_SESSION_SECRET=auth-local-session-secret \
  --env INGESTION_API_KEY=auth-local-ingestion-key \
  --env USAGE_STATS_ENABLED=false \
  "$image" >/dev/null

wait_for_health "$local_port" "$local_container"
local_status="$(curl -sS -o /dev/null -D "$tmp_dir/local-headers" -w '%{http_code}' \
  -X POST "http://127.0.0.1:${local_port}/api/login/password" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'email=missing@example.invalid&password=not-the-password')"
local_location="$(header_value Location "$tmp_dir/local-headers")"
[ "$local_status" = "303" ] || fail "local failed login returned HTTP $local_status"
[ "$local_location" = "http://localhost:8080/login?err=authFail" ] \
  || fail "local fallback redirect changed (got $local_location)"

printf '{"status":"pass","success_redirect":"%s/","failure_redirect":"%s/login?err=authFail","cors_origin":"%s","secure_cookie":true,"local_fallback":true}\n' \
  "$external_origin" "$external_origin" "$external_origin"
