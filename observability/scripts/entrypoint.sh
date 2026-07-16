#!/bin/sh
set -eu

PORT="${PORT:-8080}"
if [ "$PORT" != "8080" ]; then
  echo "ClickStack expects Render PORT=8080; received PORT=$PORT" >&2
  exit 64
fi

: "${EXPRESS_SESSION_SECRET:?EXPRESS_SESSION_SECRET is required}"
: "${INGESTION_API_KEY:?INGESTION_API_KEY is required}"

export PORT
export HYPERDX_APP_PORT="$PORT"
export HYPERDX_APP_LISTEN_HOSTNAME="0.0.0.0"
export USAGE_STATS_ENABLED="false"

state_root="/var/lib/clickhouse/.clickstack"
mongo_state="$state_root/mongodb"
clickhouse_log_state="$state_root/clickhouse-logs"

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
link_state_directory /var/log/clickhouse-server "$clickhouse_log_state"

# Upstream redirects each component away from stdout. Follow those files so
# Render Logs contains ClickHouse, MongoDB, collector, and HyperDX output.
component_logs="/var/log/clickhouse.log /var/log/clickhouse-server/clickhouse-server.log /var/log/clickhouse-server/clickhouse-server.err.log /var/log/mongod.log /var/log/otel-collector.log /var/log/app.log"
# Persistent database logs survive restarts. Follow only newly appended lines
# so each Render deploy does not replay the entire historical log volume.
tail -n 0 -F $component_logs &
tail_pid=$!
smoke_pid=""

cleanup() {
  kill "$tail_pid" 2>/dev/null || true
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
