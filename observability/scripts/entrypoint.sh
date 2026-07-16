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

export PORT
export HYPERDX_APP_PORT="$PORT"
export HYPERDX_APP_LISTEN_HOSTNAME="0.0.0.0"
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
smoke_pid=""

cleanup() {
  kill "$tail_pid" 2>/dev/null || true
  kill "$fatal_tail_pid" 2>/dev/null || true
  if [ -n "$smoke_pid" ]; then
    kill "$smoke_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# tini -g forwards SIGTERM to this shell's entire process group, including all
# four services started by the upstream script, so databases can flush cleanly.
bash /etc/local/entry.sh &
stack_pid=$!

if [ "${CLICKSTACK_INTERNAL_SMOKE_ENABLED:-false}" = "true" ]; then
  /usr/local/bin/loyal-clickstack-smoke-live &
  smoke_pid=$!
fi

set +e
wait "$stack_pid"
status=$?
set -e

exit "$status"
