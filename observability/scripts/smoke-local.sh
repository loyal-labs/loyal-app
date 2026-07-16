#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"

image="loyal-clickstack:local-smoke"
container="loyal-clickstack-smoke-$$"
volume="loyal-clickstack-smoke-$$"
ui_port="${CLICKSTACK_UI_PORT:-18080}"
otlp_port="${CLICKSTACK_OTLP_PORT:-14318}"
marker="loyal-clickstack-smoke-$(date -u +%Y%m%dT%H%M%SZ)-$$"
ingestion_key="local-${marker}"
result_file="${CLICKSTACK_SMOKE_RESULT:-$project_dir/smoke-result.json}"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail_with_logs() {
  echo "Local ClickStack smoke test failed: $1" >&2
  docker logs --tail 250 "$container" >&2 2>/dev/null || true
  exit 1
}

run_container() {
  docker run --detach \
    --name "$container" \
    --mount "source=$volume,target=/var/lib/clickhouse" \
    --publish "127.0.0.1:${ui_port}:8080" \
    --publish "127.0.0.1:${otlp_port}:4318" \
    --env PORT=8080 \
    --env EXPRESS_SESSION_SECRET=local-smoke-session-secret \
    --env "INGESTION_API_KEY=$ingestion_key" \
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

send_marker() {
  seconds="$(date +%s)"
  payload="{\"resourceLogs\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"loyal-clickstack-smoke\"}}]},\"scopeLogs\":[{\"scope\":{\"name\":\"loyal-clickstack-verifier\"},\"logRecords\":[{\"timeUnixNano\":\"${seconds}000000000\",\"severityText\":\"INFO\",\"body\":{\"stringValue\":\"$marker\"}}]}]}]}"

  for _ in $(seq 1 60); do
    status="$(curl -sS -o /dev/null -w '%{http_code}' \
      -X POST "http://127.0.0.1:${otlp_port}/v1/logs" \
      -H 'Content-Type: application/json' \
      -H "Authorization: $ingestion_key" \
      --data "$payload" || true)"
    if [[ "$status" =~ ^2 ]]; then
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
  for attempt in $(seq 1 120); do
    count="$(query_marker_count 2>/dev/null || true)"
    if [[ "$count" =~ ^[1-9][0-9]*$ ]]; then
      return 0
    fi
    # The UI can become healthy just before the OpAMP supervisor receives its
    # collector configuration. Re-send the same marker until ClickHouse, not
    # the receiver's early HTTP response, proves successful ingestion.
    if (( attempt % 5 == 0 )); then
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
send_marker
wait_for_marker
before_restart="$(query_marker_count)"

docker stop --time 60 "$container" >/dev/null
docker rm "$container" >/dev/null

run_container
wait_for_ui
wait_for_marker
after_restart="$(query_marker_count)"

printf '{"status":"pass","marker":"%s","health_status":200,"count_before_restart":%s,"count_after_restart":%s}\n' \
  "$marker" "$before_restart" "$after_restart" | tee "$result_file"
