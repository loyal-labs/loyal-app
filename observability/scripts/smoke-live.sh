#!/bin/sh
set -eu

state_root="/var/lib/clickhouse/.clickstack"
marker_file="$state_root/render-smoke-marker"
health_url="http://127.0.0.1:${PORT:-8080}/api/health"
otlp_url="http://127.0.0.1:4318/v1/logs"

fail() {
  printf 'CLICKSTACK_SMOKE_RESULT {"status":"fail","reason":"%s"}\n' "$1" >&2
  exit 1
}

if [ -s "$marker_file" ]; then
  marker="$(cat "$marker_file")"
  stage="persisted"
else
  marker="loyal-clickstack-render-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  stage="initial"
fi

case "$marker" in
  *[!A-Za-z0-9._:-]*) fail "invalid persisted marker" ;;
esac

health_status=""
for _ in $(seq 1 300); do
  health_status="$(curl -sS -o /dev/null -w '%{http_code}' "$health_url" || true)"
  case "$health_status" in
    2*|3*) break ;;
  esac
  sleep 1
done
case "$health_status" in
  2*|3*) ;;
  *) fail "UI health timeout" ;;
esac

query_count() {
  clickhouse-client \
    --query "SELECT count() FROM default.otel_logs WHERE Body = '$marker' FORMAT TSVRaw" \
    2>/dev/null || true
}

if [ "$stage" = "initial" ]; then
  seconds="$(date +%s)"
  payload="$(printf '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"loyal-clickstack-render-smoke"}}]},"scopeLogs":[{"scope":{"name":"loyal-clickstack-render-verifier"},"logRecords":[{"timeUnixNano":"%s000000000","severityText":"INFO","body":{"stringValue":"%s"}}]}]}]}' "$seconds" "$marker")"

  accepted="false"
  for _ in $(seq 1 120); do
    status="$(curl -sS -o /dev/null -w '%{http_code}' \
      -X POST "$otlp_url" \
      -H 'Content-Type: application/json' \
      -H "Authorization: $INGESTION_API_KEY" \
      --data "$payload" || true)"
    case "$status" in
      2*) accepted="true"; break ;;
    esac
    sleep 1
  done
  [ "$accepted" = "true" ] || fail "OTLP receiver timeout"
fi

count="0"
for attempt in $(seq 1 180); do
  count="$(query_count)"
  case "$count" in
    ''|*[!0-9]*) count="0" ;;
  esac
  [ "$count" -gt 0 ] && break

  # The receiver can accept before its ClickHouse exporter is configured.
  if [ "$stage" = "initial" ] && [ $((attempt % 5)) -eq 0 ]; then
    curl -sS -o /dev/null \
      -X POST "$otlp_url" \
      -H 'Content-Type: application/json' \
      -H "Authorization: $INGESTION_API_KEY" \
      --data "$payload" || true
  fi
  sleep 1
done
[ "$count" -gt 0 ] || fail "marker query timeout"

if [ "$stage" = "initial" ]; then
  marker_tmp="$marker_file.$$"
  printf '%s\n' "$marker" > "$marker_tmp"
  mv "$marker_tmp" "$marker_file"
fi

printf 'CLICKSTACK_SMOKE_RESULT {"status":"pass","stage":"%s","marker":"%s","health_status":%s,"count":%s}\n' \
  "$stage" "$marker" "$health_status" "$count"
