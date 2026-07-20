#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"

image="loyal-clickstack:local-smoke"
container="loyal-clickstack-smoke-$$"
volume="loyal-clickstack-smoke-$$"
ui_port="${CLICKSTACK_UI_PORT:-18080}"
marker="loyal-clickstack-smoke-$(date -u +%Y%m%dT%H%M%SZ)-$$"
ingestion_key="local-$marker"
result_file="${CLICKSTACK_SMOKE_RESULT:-$project_dir/smoke-result.json}"
tmp_dir="$(mktemp -d)"
payload=""
metrics_payload=""
traces_payload=""
missing_status=""
wrong_status=""
correct_status=""
metrics_status=""
traces_status=""
method_status=""
path_status=""
query_status=""
oversized_status=""

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

fail_with_logs() {
  echo "Local ClickStack smoke test failed: $1" >&2
  docker logs --tail 250 "$container" >&2 2>/dev/null || true
  exit 1
}

report_http_response() {
  local signal="$1"
  local status="$2"
  local response_file="$3"
  local response_excerpt="<empty>"

  if [[ -s "$response_file" ]]; then
    response_excerpt="$(LC_ALL=C tr -cd '\11\12\15\40-\176' < "$response_file" | tr '\r\n' '  ' | cut -c1-512)"
    [[ -n "$response_excerpt" ]] || response_excerpt="<empty>"
  fi
  printf 'CLICKSTACK_SMOKE_HTTP_RESPONSE signal=%s status=%s body=%s\n' \
    "$signal" "$status" "$response_excerpt" >&2
}

run_container() {
  docker run --detach \
    --name "$container" \
    --mount "source=$volume,target=/var/lib/clickhouse" \
    --publish "127.0.0.1:${ui_port}:8080" \
    --env PORT=8080 \
    --env EXPRESS_SESSION_SECRET=local-smoke-session-secret \
    --env "INGESTION_API_KEY=$ingestion_key" \
    --env CLICKSTACK_INTERNAL_SMOKE_ENABLED=true \
    --env USAGE_STATS_ENABLED=false \
    "$image" >/dev/null
}

wait_for_ui() {
  for _ in $(seq 1 180); do
    if curl -fsS "http://127.0.0.1:${ui_port}/api/health" >/dev/null \
      && curl -fsSL "http://127.0.0.1:${ui_port}/" >/dev/null; then
      return 0
    fi
    if ! docker inspect "$container" --format '{{.State.Running}}' 2>/dev/null | grep -qx true; then
      fail_with_logs "container exited before the UI became ready"
    fi
    sleep 1
  done
  fail_with_logs "UI did not become ready within 180 seconds"
}

wait_for_internal_smoke() {
  local expected_stage="$1"

  for _ in $(seq 1 240); do
    docker logs --tail 250 "$container" > "$tmp_dir/internal-smoke-logs" 2>&1 || true
    if rg --fixed-strings --quiet \
      "\"status\":\"pass\",\"stage\":\"${expected_stage}\"" "$tmp_dir/internal-smoke-logs"; then
      return 0
    fi
    if ! docker inspect "$container" --format '{{.State.Running}}' 2>/dev/null | grep -qx true; then
      fail_with_logs "container exited before the $expected_stage internal smoke passed"
    fi
    sleep 1
  done
  fail_with_logs "$expected_stage internal smoke did not pass within 240 seconds"
}

bootstrap_local_team() {
  local email="collector-smoke-$$@example.invalid"
  local password="Local-collector-smoke-2026!"
  local status

  # A pristine ClickStack collector is permissive until the first HyperDX team
  # exists. Register a synthetic user inside this disposable volume, then prove
  # that the public ingestion route stays closed until key enforcement appears.
  status="$(curl -sS -o "$tmp_dir/register-body" -w '%{http_code}' \
    -X POST "http://127.0.0.1:${ui_port}/api/register/password" \
    -H 'Content-Type: application/json' \
    --data "{\"email\":\"$email\",\"password\":\"$password\",\"confirmPassword\":\"$password\"}" || true)"
  assert_status "local HyperDX team bootstrap" "$status" 200
}

build_payloads() {
  # Semantic metrics and traces payload checks belong in this disposable test,
  # not in the production startup gate.
  seconds="$(date +%s)"
  payload="{\"resourceLogs\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"loyal-clickstack-smoke\"}}]},\"scopeLogs\":[{\"scope\":{\"name\":\"loyal-clickstack-verifier\"},\"logRecords\":[{\"timeUnixNano\":\"${seconds}000000000\",\"severityText\":\"INFO\",\"body\":{\"stringValue\":\"$marker\"}}]}]}]}"
  metrics_payload="{\"resourceMetrics\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"loyal-clickstack-smoke\"}}]},\"scopeMetrics\":[{\"scope\":{\"name\":\"loyal-clickstack-verifier\"},\"metrics\":[{\"name\":\"loyal.clickstack.smoke\",\"gauge\":{\"dataPoints\":[{\"timeUnixNano\":\"${seconds}000000000\",\"asInt\":\"1\",\"attributes\":[{\"key\":\"smoke.marker\",\"value\":{\"stringValue\":\"$marker\"}}]}]}}]}]}]}"
  traces_payload="{\"resourceSpans\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"loyal-clickstack-smoke\"}}]},\"scopeSpans\":[{\"scope\":{\"name\":\"loyal-clickstack-verifier\"},\"spans\":[{\"traceId\":\"11111111111111111111111111111111\",\"spanId\":\"2222222222222222\",\"name\":\"$marker\",\"kind\":1,\"startTimeUnixNano\":\"${seconds}000000000\",\"endTimeUnixNano\":\"${seconds}001000000\",\"status\":{\"code\":1}}]}]}]}"
}

assert_status() {
  local label="$1"
  local actual="$2"
  shift 2
  local expected

  for expected in "$@"; do
    if [[ "$actual" == "$expected" ]]; then
      return 0
    fi
  done
  fail_with_logs "$label returned HTTP $actual (expected: $*)"
}

assert_public_boundary() {
  for _ in $(seq 1 180); do
    missing_status="$(curl -sS -o /dev/null -w '%{http_code}' \
      -X POST "http://127.0.0.1:${ui_port}/v1/logs" \
      -H 'Content-Type: application/json' \
      --data "$payload" || true)"
    if [[ "$missing_status" == "401" || "$missing_status" == "403" ]]; then
      break
    fi
    if ! docker inspect "$container" --format '{{.State.Running}}' 2>/dev/null | grep -qx true; then
      fail_with_logs "container exited before authenticated ingestion became ready"
    fi
    sleep 1
  done
  assert_status "missing ingestion credential" "$missing_status" 401 403

  wrong_status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${ui_port}/v1/logs" \
    -H 'Content-Type: application/json' \
    -H 'Authorization: deliberately-wrong-ingestion-key' \
    --data "$payload" || true)"
  assert_status "wrong ingestion credential" "$wrong_status" 401 403

  method_status="$(curl -sS -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:${ui_port}/v1/logs" \
    -H "Authorization: $ingestion_key" || true)"
  assert_status "non-POST log request" "$method_status" 405

  path_status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${ui_port}/v1/not-supported" \
    -H 'Content-Type: application/json' \
    -H "Authorization: $ingestion_key" \
    --data "$payload" || true)"
  assert_status "unsupported OTLP path" "$path_status" 404

  query_status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${ui_port}/v1/logs?unexpected=true" \
    -H 'Content-Type: application/json' \
    -H "Authorization: $ingestion_key" \
    --data "$payload" || true)"
  assert_status "query-bearing log path" "$query_status" 404

  dd if=/dev/zero bs=1024 count=65 2>/dev/null | tr '\0' 'x' > "$tmp_dir/oversized-body"
  oversized_status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${ui_port}/v1/logs" \
    -H 'Content-Type: application/json' \
    -H "Authorization: $ingestion_key" \
    --data-binary "@$tmp_dir/oversized-body" || true)"
  assert_status "oversized log request" "$oversized_status" 413

  cors_status=""
  for _ in $(seq 1 60); do
    cors_status="$(curl -sS -o /dev/null -D "$tmp_dir/cors-headers" -w '%{http_code}' \
      -X POST "http://127.0.0.1:${ui_port}/v1/logs" \
      -H 'Content-Type: application/json' \
      -H 'Origin: https://untrusted.example.test' \
      -H "Authorization: $ingestion_key" \
      --data "$payload" || true)"
    if [[ "$cors_status" =~ ^2 ]]; then
      break
    fi
    sleep 1
  done
  if [[ ! "$cors_status" =~ ^2 ]]; then
    fail_with_logs "CORS probe never reached an accepted authenticated response"
  fi
  if rg --quiet --ignore-case '^Access-Control-Allow-' "$tmp_dir/cors-headers"; then
    fail_with_logs "public log response exposed a permissive CORS header"
  fi

  published_ports="$(docker inspect "$container" --format '{{json .HostConfig.PortBindings}}')"
  if rg --quiet '4318|8123|9000|27017' <<<"$published_ports"; then
    fail_with_logs "collector or database port was published by the container"
  fi
}

send_signal_canaries() {
  local signal
  local signal_payload
  local signal_status
  local response_file

  for signal in metrics traces; do
    case "$signal" in
      metrics) signal_payload="$metrics_payload" ;;
      traces) signal_payload="$traces_payload" ;;
    esac
    response_file="$tmp_dir/$signal-response"
    signal_status="$(curl -sS -o "$response_file" -w '%{http_code}' \
      -X POST "http://127.0.0.1:${ui_port}/v1/$signal" \
      -H 'Content-Type: application/json' \
      -H "Authorization: $ingestion_key" \
      --data "$signal_payload" || true)"
    if [[ ! "$signal_status" =~ ^2 ]]; then
      report_http_response "$signal" "$signal_status" "$response_file"
      fail_with_logs "$signal canary returned HTTP $signal_status"
    fi
    case "$signal" in
      metrics) metrics_status="$signal_status" ;;
      traces) traces_status="$signal_status" ;;
    esac
  done
}

send_marker() {
  for _ in $(seq 1 60); do
    correct_status="$(curl -sS -o /dev/null -w '%{http_code}' \
      -X POST "http://127.0.0.1:${ui_port}/v1/logs" \
      -H 'Content-Type: application/json' \
      -H "Authorization: $ingestion_key" \
      --data "$payload" || true)"
    if [[ "$correct_status" =~ ^2 ]]; then
      return 0
    fi
    sleep 1
  done
  fail_with_logs "collector did not accept the OTLP marker"
}

query_marker_count() {
  # The default ClickHouse user is intentionally restricted to container-local
  # connections. Query inside the service instead of publishing a database port.
  docker exec "$container" clickhouse-client \
    --query "SELECT count() FROM default.otel_logs WHERE Body = '$marker' FORMAT TSVRaw"
}

wait_for_marker() {
  local resend="${1:-false}"
  for attempt in $(seq 1 120); do
    count="$(query_marker_count 2>/dev/null || true)"
    if [[ "$count" =~ ^[1-9][0-9]*$ ]]; then
      return 0
    fi
    # The UI can become healthy just before the OpAMP supervisor receives its
    # collector configuration. Re-send the same marker until ClickHouse, not
    # the receiver's early HTTP response, proves successful ingestion.
    if [[ "$resend" == "true" ]] && (( attempt % 5 == 0 )); then
      send_marker
    fi
    sleep 1
  done
  fail_with_logs "OTLP marker was not queryable in ClickHouse"
}

docker build --tag "$image" "$project_dir"
docker volume create "$volume" >/dev/null

run_container
wait_for_ui
bootstrap_local_team
wait_for_internal_smoke initial
build_payloads
assert_public_boundary
send_signal_canaries
send_marker
wait_for_marker true
before_restart="$(query_marker_count)"

docker stop --time 60 "$container" >/dev/null
docker rm "$container" >/dev/null

run_container
wait_for_ui
wait_for_internal_smoke persisted
wait_for_marker false
after_restart="$(query_marker_count)"

printf '{"status":"pass","marker":"%s","health_status":200,"auth":{"missing":%s,"wrong":%s,"correct":%s},"accepted":{"logs":%s,"metrics":%s,"traces":%s},"rejections":{"method":%s,"path":%s,"query":%s,"oversized":%s},"cors":false,"private_ports":true,"internal_smoke":{"initial":true,"persisted":true},"count_before_restart":%s,"count_after_restart":%s}\n' \
  "$marker" "$missing_status" "$wrong_status" "$correct_status" "$correct_status" "$metrics_status" "$traces_status" "$method_status" "$path_status" "$query_status" "$oversized_status" \
  "$before_restart" "$after_restart" | tee "$result_file"
