#!/bin/sh
set -eu

PORT="${PORT:-8080}"
if [ "$PORT" != "8080" ]; then
  echo "ClickStack expects Render PORT=8080; received PORT=$PORT" >&2
  exit 64
fi

: "${EXPRESS_SESSION_SECRET:?EXPRESS_SESSION_SECRET is required}"
: "${INGESTION_API_KEY:?INGESTION_API_KEY is required}"

configure_render_frontend_url() {
  [ "${RENDER:-}" = "true" ] || return 0

  candidate="${FRONTEND_URL:-${RENDER_EXTERNAL_URL:-}}"
  if [ -z "$candidate" ]; then
    echo "Render must provide FRONTEND_URL or RENDER_EXTERNAL_URL" >&2
    exit 66
  fi

  canonical_url="$(node -e '
    const raw = process.argv[1];
    let url;
    try {
      url = new URL(raw);
    } catch {
      process.exit(1);
    }

    const hostname = url.hostname.toLowerCase();
    const isLoopback =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.startsWith("127.");
    const hasUnexpectedParts =
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      (url.pathname !== "" && url.pathname !== "/") ||
      (url.port !== "" && url.port !== "443");

    if (url.protocol !== "https:" || isLoopback || hasUnexpectedParts) {
      process.exit(1);
    }
    process.stdout.write(url.origin);
  ' "$candidate")" || {
    echo "ClickStack external frontend URL must be a canonical non-loopback HTTPS origin" >&2
    exit 66
  }

  export FRONTEND_URL="$canonical_url"
  echo "Configured ClickStack external frontend origin from Render"
}

configure_render_frontend_url

# HyperDX derives its fallback origin from the internal application port. The
# public local origin is nginx on PORT, so make that boundary explicit too.
if [ "${RENDER:-}" != "true" ] && [ -z "${FRONTEND_URL:-}" ]; then
  export FRONTEND_URL="http://localhost:$PORT"
fi

export PORT
export HYPERDX_APP_PORT="8081"
export HYPERDX_APP_LISTEN_HOSTNAME="127.0.0.1"
export USAGE_STATS_ENABLED="false"

state_root="/var/lib/clickhouse/.clickstack"
mongo_state="$state_root/mongodb"

link_state_directory() {
  link_path="$1"
  target_path="$2"

  mkdir -p "$target_path"

  if [ -L "$link_path" ]; then
    if [ "$(readlink "$link_path")" = "$target_path" ]; then
      return
    fi
    rm "$link_path"
  elif [ -d "$link_path" ]; then
    # Preserve any image-provided seed files on the first boot. On Render the
    # source directory is ephemeral and the target lives on the attached disk.
    cp -a "$link_path/." "$target_path/"
    rm -rf "$link_path"
  elif [ -e "$link_path" ]; then
    echo "Refusing to replace non-directory state path: $link_path" >&2
    exit 65
  fi

  ln -s "$target_path" "$link_path"
}

link_state_directory /data/db "$mongo_state"

# Upstream redirects each component away from stdout. Follow those files so
# Render Logs contains ClickHouse, MongoDB, collector, and HyperDX output.
component_logs="/var/log/clickhouse.log /var/log/mongod.log /var/log/otel-collector.log /var/log/app.log"
clickhouse_fatal_logs="/var/log/clickhouse-server/clickhouse-server.log /var/log/clickhouse-server/clickhouse-server.err.log"
# Follow only newly appended lines so startup never replays historical output.
(tail -n 0 -F $component_logs \
  | awk '!/^==> .* <==$/ && !/SSLHandshakeFailed|end connection/ { print; fflush() }') &
tail_pid=$!
(tail -n 0 -F $clickhouse_fatal_logs \
  | awk '/<Fatal>|<Critical>/ { print; fflush() }') &
fatal_tail_pid=$!
nginx_pid=""
stack_pid=""
collector_auth_ready_file="/tmp/loyal-clickstack-collector-auth-ready"

cleanup() {
  kill "$tail_pid" 2>/dev/null || true
  kill "$fatal_tail_pid" 2>/dev/null || true
  if [ -n "$nginx_pid" ]; then
    kill "$nginx_pid" 2>/dev/null || true
  fi
  if [ -n "$stack_pid" ]; then
    kill "$stack_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# tini -g forwards SIGTERM to this shell's entire process group, including all
# services started by the upstream script and nginx, so databases can flush.
nginx -t -c /etc/nginx/nginx.conf
rm -f "$collector_auth_ready_file"
bash /etc/local/entry.sh &
stack_pid=$!
nginx -g 'daemon off;' &
nginx_pid=$!

wait_for_collector_authentication() {
  # Keep only ingestion closed until the collector proves that its own key
  # enforcement is active. HyperDX remains reachable so a fresh installation
  # can create its first user/team without an authentication bootstrap deadlock.
  auth_probe='{"resourceLogs":[]}'
  last_status="unreachable"
  attempt=0

  while true; do
    if ! kill -0 "$stack_pid" 2>/dev/null; then
      echo "ClickStack exited before collector authentication became ready" >&2
      return 1
    fi

    last_status="$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' \
      -X POST 'http://127.0.0.1:4318/v1/logs' \
      -H 'Content-Type: application/json' \
      --data "$auth_probe" || true)"
    case "$last_status" in
      401|403)
        : > "$collector_auth_ready_file"
        echo "Collector authentication is active; public log ingestion is enabled"
        return 0
        ;;
    esac

    attempt=$((attempt + 1))
    if [ $((attempt % 60)) -eq 0 ]; then
      echo "Waiting for authenticated collector configuration; HyperDX UI remains available"
    fi
    sleep 1
  done
}

wait_for_collector_authentication

if [ "${CLICKSTACK_INTERNAL_SMOKE_ENABLED:-false}" = "true" ]; then
  # Keep a failed security, ingestion, or persistence smoke from becoming a
  # deceptively healthy Render instance.
  /usr/local/bin/loyal-clickstack-smoke-live
fi

while kill -0 "$stack_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 1
done

set +e
if ! kill -0 "$stack_pid" 2>/dev/null; then
  wait "$stack_pid"
  status=$?
  echo "ClickStack exited with status $status" >&2
else
  wait "$nginx_pid"
  status=$?
  echo "nginx exited with status $status" >&2
fi
set -e

exit "$status"
