#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_root="$(cd "$script_dir/../../.." && pwd)"
routing_root=""
scratch_dir="$(mktemp -d "/tmp/ask-2168-autoswap-mainnet-e2e.XXXXXX")"
postgres_data="$scratch_dir/postgres"
postgres_socket="$scratch_dir/postgres-socket"
postgres_log="$scratch_dir/postgres.log"
monitor_log="$scratch_dir/monitor.log"
database_name="ask_2168_autoswap_mainnet_e2e"
postgres_port="$((24500 + RANDOM % 1200))"
monitor_pid=""
postgres_started=0

fail() {
  echo "FAIL: $*" >&2
  if [[ -f "$monitor_log" ]]; then
    tail -80 "$monitor_log" >&2 || true
  fi
  exit 1
}

pass() {
  echo "PASS: $*"
}

cleanup() {
  if [[ -n "$monitor_pid" ]]; then
    kill "$monitor_pid" >/dev/null 2>&1 || true
    wait "$monitor_pid" >/dev/null 2>&1 || true
  fi
  if [[ "$postgres_started" -eq 1 ]]; then
    "$pg_bindir/pg_ctl" -D "$postgres_data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$scratch_dir"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --routing-root)
      routing_root="${2:-}"
      shift 2
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -n "$routing_root" ]] || fail "--routing-root is required"
routing_root="$(cd "$routing_root" && pwd)"
[[ "$routing_root" != "$app_root" ]] || fail "app and routing worktrees must be separate"
[[ "${AUTOSWAP_E2E_ACK:-}" == "mainnet-autoswap-isolated-setup-delete" ]] ||
  fail "AUTOSWAP_E2E_ACK must acknowledge the isolated mainnet setup/delete test"
[[ -n "${AUTOSWAP_E2E_SETTINGS_PDA:-}" ]] ||
  fail "AUTOSWAP_E2E_SETTINGS_PDA is required"
[[ -n "${NEON_DATABASE_URL:-}" ]] || fail "NEON_DATABASE_URL is required for read-only schema cloning"
[[ -n "${SOLANA_TESTING_PK:-}" ]] || fail "SOLANA_TESTING_PK is required"
[[ -n "${DEPLOYMENT_PK:-}" ]] || fail "DEPLOYMENT_PK is required"
[[ -n "${LASERSTREAM_ENDPOINT:-}" ]] || fail "LASERSTREAM_ENDPOINT is required"
[[ -n "${HELIUS_API_KEY:-}" ]] || fail "HELIUS_API_KEY is required"
rpc_url="${AUTOSWAP_E2E_RPC_URL:-${SOLANA_RPC_URL:-}}"
[[ -n "$rpc_url" ]] || fail "AUTOSWAP_E2E_RPC_URL or SOLANA_RPC_URL is required"

if [[ -x /opt/homebrew/opt/postgresql@18/bin/postgres ]]; then
  pg_bindir=/opt/homebrew/opt/postgresql@18/bin
elif [[ -x /opt/homebrew/opt/postgresql@17/bin/postgres ]]; then
  pg_bindir=/opt/homebrew/opt/postgresql@17/bin
else
  pg_bindir="$(pg_config --bindir)"
fi

for command_name in bun cargo jq; do
  command -v "$command_name" >/dev/null || fail "$command_name is required"
done
for postgres_command in initdb pg_ctl pg_dump psql; do
  [[ -x "$pg_bindir/$postgres_command" ]] || fail "$postgres_command is required"
done

echo "== Resolve and validate the isolated mainnet identity"
identity="$({
  cd "$app_root/apps/web"
  NEXT_PUBLIC_SOLANA_ENV=mainnet AUTOSWAP_E2E_RPC_URL="$rpc_url" \
    bun run scripts/verify-autoswap-mainnet-e2e.ts --identity
})"
wallet_address="$(jq -er '.walletAddress' <<<"$identity")"
settings="$(jq -er '.settings' <<<"$identity")"
vault_pubkey="$(jq -er '.vaultPubkey' <<<"$identity")"
[[ "$wallet_address" != "AJk8mx24W8mSzUQNUciqwC6uVuPPwpip9waj9pwgKfiY" ]] ||
  fail "the customer wallet must never be used as the isolated test signer"
pass "the disposable signer controls the explicit Settings account"

echo "== Clone only the production Yield schema into disposable PostgreSQL"
mkdir -p "$postgres_socket"
"$pg_bindir/initdb" -D "$postgres_data" -A trust --no-locale -E UTF8 >/dev/null
"$pg_bindir/pg_ctl" -D "$postgres_data" -l "$postgres_log" \
  -o "-F -k '$postgres_socket' -p $postgres_port -c listen_addresses=127.0.0.1" \
  -w start >/dev/null
postgres_started=1
"$pg_bindir/psql" -X --set=ON_ERROR_STOP=1 \
  --host="$postgres_socket" --port="$postgres_port" --username="$(id -un)" \
  --dbname=postgres --command="CREATE DATABASE $database_name" >/dev/null
database_url="postgresql://$(id -un)@127.0.0.1:${postgres_port}/${database_name}"

psql_local() {
  "$pg_bindir/psql" -X --set=ON_ERROR_STOP=1 \
    --host="$postgres_socket" --port="$postgres_port" --username="$(id -un)" \
    --dbname="$database_name" "$@"
}

remote_pg_host="$(bun -e 'process.stdout.write(new URL(process.env.NEON_DATABASE_URL).hostname)')"
remote_pg_port="$(bun -e 'process.stdout.write(new URL(process.env.NEON_DATABASE_URL).port || "5432")')"
remote_pg_database="$(bun -e 'process.stdout.write(decodeURIComponent(new URL(process.env.NEON_DATABASE_URL).pathname.slice(1)))')"
remote_pg_user="$(bun -e 'process.stdout.write(decodeURIComponent(new URL(process.env.NEON_DATABASE_URL).username))')"
remote_pg_password="$(bun -e 'process.stdout.write(decodeURIComponent(new URL(process.env.NEON_DATABASE_URL).password))')"
remote_pg_sslmode="$(bun -e 'process.stdout.write(new URL(process.env.NEON_DATABASE_URL).searchParams.get("sslmode") || "require")')"
remote_pg_channel_binding="$(bun -e 'process.stdout.write(new URL(process.env.NEON_DATABASE_URL).searchParams.get("channel_binding") || "prefer")')"
PGHOST="$remote_pg_host" \
PGPORT="$remote_pg_port" \
PGDATABASE="$remote_pg_database" \
PGUSER="$remote_pg_user" \
PGPASSWORD="$remote_pg_password" \
PGSSLMODE="$remote_pg_sslmode" \
PGCHANNELBINDING="$remote_pg_channel_binding" \
  "$pg_bindir/pg_dump" \
  --schema-only --schema=loyal_yield --no-owner --no-privileges |
  psql_local >/dev/null

psql_local --set=wallet_address="$wallet_address" --set=settings="$settings" <<'SQL' >/dev/null
CREATE TABLE app_users (
  id BIGSERIAL PRIMARY KEY,
  subject_address TEXT NOT NULL UNIQUE
);
CREATE TABLE app_user_smart_accounts (
  user_id BIGINT NOT NULL REFERENCES app_users(id),
  solana_env TEXT NOT NULL,
  settings_pda TEXT NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (solana_env, settings_pda)
);
INSERT INTO app_users (subject_address) VALUES (:'wallet_address');
INSERT INTO app_user_smart_accounts (user_id, solana_env, settings_pda, state)
SELECT id, 'mainnet-beta', :'settings', 'ready'
FROM app_users
WHERE subject_address = :'wallet_address';
SQL
pass "disposable database contains one test-only smart-account watch target"

echo "== Start the production monitor against mainnet LaserStream and the disposable DB"
(
  cd "$routing_root"
  OBSERVABILITY_ENABLED=false \
  RUST_LOG=info \
  DISABLE_EARN_APY_REFRESH=true \
  DATABASE_URL="$database_url" \
  NEON_DATABASE_URL="$database_url" \
  TIMESCALEDB_URL="$database_url" \
  SOLANA_RPC_URL="$rpc_url" \
  BALANCE_SWEEP_UPDATE_SOURCE=laserstream \
  BALANCE_SWEEP_TARGET_REFRESH_SECONDS=600 \
  cargo run --quiet -p balance-sweep-ata-monitor \
    --bin balance-sweep-ata-monitor -- \
    --cluster mainnet-beta \
    --laserstream-replay-overlap-slots 128
) >"$monitor_log" 2>&1 &
monitor_pid=$!

monitor_ready=0
for _ in $(seq 1 600); do
  if grep -q "starting Laserstream ATA subscription" "$monitor_log"; then
    monitor_ready=1
    break
  fi
  kill -0 "$monitor_pid" >/dev/null 2>&1 || fail "mainnet LaserStream monitor exited during startup"
  sleep 0.5
done
[[ "$monitor_ready" -eq 1 ]] || fail "mainnet LaserStream monitor did not start within five minutes"
sleep 3
kill -0 "$monitor_pid" >/dev/null 2>&1 || fail "mainnet LaserStream monitor exited before setup"
pass "real LaserStream subscription is running with the isolated watch set"

echo "== Execute interrupted setup, resume, backend pause, and deletion on mainnet"
(
  cd "$app_root/apps/web"
  NEXT_PUBLIC_SOLANA_ENV=mainnet \
  AUTOSWAP_E2E_RPC_URL="$rpc_url" \
  AUTOSWAP_E2E_PROJECTION_DATABASE_URL="$database_url" \
  bun run scripts/verify-autoswap-mainnet-e2e.ts --execute
)

inactive_removed="$(psql_local -A -t --command="
  SELECT count(*)
  FROM loyal_yield.cross_mint_swap_policies
  WHERE settings = '$settings'
    AND vault_index = 1
    AND NOT active
    AND last_mutation = 'remove'
    AND source_commitment = 'finalized';
" | tr -d '[:space:]')"
remaining_opt_ins="$(psql_local -A -t --command="
  SELECT count(*)
  FROM loyal_yield.cross_mint_vault_opt_ins
  WHERE settings = '$settings' AND vault_index = 1;
" | tr -d '[:space:]')"
[[ "$inactive_removed" == "2" ]] || fail "isolated projection does not contain two finalized removals"
[[ "$remaining_opt_ins" == "0" ]] || fail "isolated projection retained the Autoswap opt-in"
kill -0 "$monitor_pid" >/dev/null 2>&1 || fail "mainnet LaserStream monitor stopped during the E2E"
pass "mainnet setup/delete reconciled exclusively through LaserStream into disposable PostgreSQL"
pass "ASK-2168 isolated mainnet Autoswap E2E"
