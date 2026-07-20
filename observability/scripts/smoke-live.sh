#!/bin/sh
set -eu

state_root="/var/lib/clickhouse/.clickstack"
marker_file="$state_root/render-smoke-marker"
health_url="http://127.0.0.1:${PORT:-8080}/api/health"
otlp_url="http://127.0.0.1:${PORT:-8080}/v1/logs"
metrics_url="http://127.0.0.1:${PORT:-8080}/v1/metrics"
traces_url="http://127.0.0.1:${PORT:-8080}/v1/traces"
headers_file="/tmp/loyal-clickstack-smoke-headers-$$"
oversized_file="/tmp/loyal-clickstack-smoke-oversized-$$"
response_file="/tmp/loyal-clickstack-smoke-response-$$"

cleanup() {
  rm -f "$headers_file" "$oversized_file" "$response_file"
}
trap cleanup EXIT

fail() {
  printf 'CLICKSTACK_SMOKE_RESULT {"status":"fail","reason":"%s"}\n' "$1" >&2
  exit 1
}

report_http_response() {
  response_signal="$1"
  response_status="$2"
  response_excerpt="<empty>"

  if [ -s "$response_file" ]; then
    response_excerpt="$(LC_ALL=C tr -cd '\11\12\15\40-\176' < "$response_file" | tr '\r\n' '  ' | cut -c1-512)"
    [ -n "$response_excerpt" ] || response_excerpt="<empty>"
  fi
  printf 'CLICKSTACK_SMOKE_HTTP_RESPONSE signal=%s status=%s body=%s\n' \
    "$response_signal" "$response_status" "$response_excerpt" >&2
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

# Keep blocking startup checks schema-minimal. Full signal payload canaries run
# in smoke-local.sh so a canary construction bug cannot take down the service.
probe_payload='{"resourceLogs":[]}'
metrics_probe_payload='{"resourceMetrics":[]}'
traces_probe_payload='{"resourceSpans":[]}'

missing_status="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$otlp_url" \
  -H 'Content-Type: application/json' \
  --data "$probe_payload" || true)"
case "$missing_status" in
  401|403) ;;
  *) fail "missing ingestion credential was not rejected" ;;
esac

wrong_status="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$otlp_url" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: deliberately-wrong-ingestion-key' \
  --data "$probe_payload" || true)"
case "$wrong_status" in
  401|403) ;;
  *) fail "wrong ingestion credential was not rejected" ;;
esac

method_status="$(curl -sS -o /dev/null -w '%{http_code}' \
  "$otlp_url" \
  -H "Authorization: $INGESTION_API_KEY" || true)"
[ "$method_status" = "405" ] || fail "non-POST log request was not rejected"

path_status="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "http://127.0.0.1:${PORT:-8080}/v1/not-supported" \
  -H 'Content-Type: application/json' \
  -H "Authorization: $INGESTION_API_KEY" \
  --data "$probe_payload" || true)"
[ "$path_status" = "404" ] || fail "unsupported OTLP path was not rejected"

query_status="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$otlp_url?unexpected=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: $INGESTION_API_KEY" \
  --data "$probe_payload" || true)"
[ "$query_status" = "404" ] || fail "query-bearing log path was not rejected"

dd if=/dev/zero bs=1024 count=65 2>/dev/null | tr '\0' 'x' > "$oversized_file"
oversized_status="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$otlp_url" \
  -H 'Content-Type: application/json' \
  -H "Authorization: $INGESTION_API_KEY" \
  --data-binary "@$oversized_file" || true)"
[ "$oversized_status" = "413" ] || fail "oversized log request was not rejected"

correct_status=""
for _ in $(seq 1 120); do
  correct_status="$(curl -sS -o "$response_file" -D "$headers_file" -w '%{http_code}' \
    -X POST "$otlp_url" \
    -H 'Content-Type: application/json' \
    -H 'Origin: https://untrusted.example.test' \
    -H "Authorization: $INGESTION_API_KEY" \
    --data "$probe_payload" || true)"
  case "$correct_status" in
    2*) break ;;
  esac
  sleep 1
done
case "$correct_status" in
  2*) ;;
  *)
    report_http_response logs "$correct_status"
    fail "configured log ingestion returned HTTP $correct_status"
    ;;
esac
if grep -Eiq '^Access-Control-Allow-' "$headers_file"; then
  fail "public log response exposed a permissive CORS header"
fi

metrics_status=""
traces_status=""
for signal in metrics traces; do
  case "$signal" in
    metrics) signal_url="$metrics_url"; signal_payload="$metrics_probe_payload" ;;
    traces) signal_url="$traces_url"; signal_payload="$traces_probe_payload" ;;
  esac

  signal_status=""
  for _ in $(seq 1 120); do
    signal_status="$(curl -sS -o "$response_file" -w '%{http_code}' \
      -X POST "$signal_url" \
      -H 'Content-Type: application/json' \
      -H "Authorization: $INGESTION_API_KEY" \
      --data "$signal_payload" || true)"
    case "$signal_status" in
      2*) break ;;
      4*)
        report_http_response "$signal" "$signal_status"
        fail "$signal readiness probe returned HTTP $signal_status"
        ;;
    esac
    sleep 1
  done
  case "$signal_status" in
    2*) ;;
    *)
      report_http_response "$signal" "$signal_status"
      fail "$signal readiness probe returned HTTP $signal_status"
      ;;
  esac
  case "$signal" in
    metrics) metrics_status="$signal_status" ;;
    traces) traces_status="$signal_status" ;;
  esac
done

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

printf 'CLICKSTACK_SMOKE_RESULT {"status":"pass","stage":"%s","marker":"%s","health_status":%s,"auth":{"missing":%s,"wrong":%s,"correct":%s},"accepted":{"logs":%s,"metrics":%s,"traces":%s},"rejections":{"method":%s,"path":%s,"query":%s,"oversized":%s},"cors":false,"count":%s}\n' \
  "$stage" "$marker" "$health_status" "$missing_status" "$wrong_status" "$correct_status" \
  "$correct_status" "$metrics_status" "$traces_status" "$method_status" "$path_status" \
  "$query_status" "$oversized_status" "$count"
