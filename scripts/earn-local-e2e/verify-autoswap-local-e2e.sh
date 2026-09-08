#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
routing_root="$(cd "${LOYAL_YIELD_ROUTING_ROOT:?Use scripts/verify-earn-local-e2e.sh --routing-root PATH}" && pwd)"
app_root=""
policy_commitment="finalized"
scratch_dir="$(mktemp -d "/tmp/ask-2168-autoswap-local-e2e.XXXXXX")"
postgres_data="$scratch_dir/postgres"
postgres_socket="$scratch_dir/postgres-socket"
postgres_log="$scratch_dir/postgres.log"
validator_log="$scratch_dir/validator.log"
realtime_log="$scratch_dir/realtime.log"
program_config_json="$scratch_dir/program-config.json"
state_json="$scratch_dir/state.json"
setup_events_json="$scratch_dir/setup-sse.json"
close_events_json="$scratch_dir/close-sse.json"
close_transactions="$scratch_dir/close.transactions.ndjson"
database_name="ask_2168_autoswap_client_local_e2e"
base_port="$(python3 "$script_dir/find-local-ports.py" 23000 1500)"
rpc_port="$base_port"
faucet_port="$((base_port + 2))"
gossip_port="$((base_port + 3))"
dynamic_start="$((base_port + 4))"
dynamic_end="$((base_port + 40))"
realtime_port="$((base_port + 50))"
postgres_port="$((base_port + 60))"
validator_pid=""
realtime_pid=""
listener_pid=""
postgres_started=0
auth_secret="ask-2168-local-e2e-auth-secret-0000000000000000000000000000"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

cleanup() {
  if [[ -n "$listener_pid" ]]; then
    kill "$listener_pid" >/dev/null 2>&1 || true
    wait "$listener_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$realtime_pid" ]]; then
    kill "$realtime_pid" >/dev/null 2>&1 || true
    wait "$realtime_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$validator_pid" ]]; then
    kill "$validator_pid" >/dev/null 2>&1 || true
    wait "$validator_pid" >/dev/null 2>&1 || true
  fi
  if [[ "$postgres_started" -eq 1 ]]; then
    "$pg_bindir/pg_ctl" -D "$postgres_data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$scratch_dir" 2>/dev/null || {
    sleep 0.2
    rm -rf "$scratch_dir"
  }
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-root)
      app_root="${2:-}"
      shift 2
      ;;
    --policy-commitment)
      policy_commitment="${2:-}"
      shift 2
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -n "$app_root" ]] || fail "--app-root is required"
[[ "$policy_commitment" == "confirmed" || "$policy_commitment" == "finalized" ]] ||
  fail "--policy-commitment must be confirmed or finalized"
app_root="$(cd "$app_root" && pwd)"
[[ "$app_root" != "$routing_root" ]] || fail "app and routing worktrees must be separate"

if [[ -x /opt/homebrew/opt/postgresql@17/bin/postgres ]]; then
  pg_bindir=/opt/homebrew/opt/postgresql@17/bin
else
  pg_bindir="$(pg_config --bindir)"
fi

for command_name in bun cargo curl jq solana-test-validator; do
  command -v "$command_name" >/dev/null || fail "$command_name is required"
done
for postgres_command in initdb pg_ctl psql; do
  [[ -x "$pg_bindir/$postgres_command" ]] || fail "$postgres_command is required"
done

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

psql_verify() {
  "$pg_bindir/psql" -X --set=ON_ERROR_STOP=1 \
    --host="$postgres_socket" --port="$postgres_port" --username="$(id -un)" \
    --dbname="$database_name" "$@"
}

sql_scalar() {
  psql_verify -A -t --command="$1" | tr -d '[:space:]'
}

echo "== Isolated database and local chain"
(
  cd "$routing_root"
  NEON_DATABASE_URL="$database_url" NO_DNA=1 \
    python3 "$script_dir/local-e2e-schema.py"
)
read -r program_config treasury < <(
  cd "$routing_root"
  cargo run --quiet -p loyal-local-e2e --bin autoswap-local-genesis -- "$program_config_json"
)

(
  cd "$routing_root"
  solana-test-validator \
    --reset \
    --ledger "$scratch_dir/ledger" \
    --rpc-port "$rpc_port" \
    --faucet-port "$faucet_port" \
    --gossip-port "$gossip_port" \
    --dynamic-port-range "$dynamic_start-$dynamic_end" \
    --bpf-program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG \
      crates/squads-test-harness/fixtures/squads/squads_smart_account_program.so \
    --account "$program_config" "$program_config_json"
) >"$validator_log" 2>&1 &
validator_pid=$!

validator_ready=0
for _ in $(seq 1 200); do
  if curl --silent --fail \
    --header 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    "http://127.0.0.1:$rpc_port" | jq -e '.result == "ok"' >/dev/null 2>&1; then
    validator_ready=1
    break
  fi
  sleep 0.1
done
if [[ "$validator_ready" -ne 1 ]]; then
  tail -80 "$validator_log" >&2 || true
  fail "isolated Solana validator did not become healthy"
fi
pass "isolated PostgreSQL and Solana validator are ready"

echo "== Web submits the two setup transactions"
(
  cd "$app_root/apps/web"
  bun run scripts/verify-autoswap-local-chain.ts setup \
    --rpc-url "http://127.0.0.1:$rpc_port" \
    --treasury "$treasury" \
    --output "$state_json"
)
[[ "$(wc -l < "$state_json.transactions.ndjson" | tr -d '[:space:]')" == "2" ]] ||
  fail "web setup did not produce two finalized chain transactions"
pass "web client setup executed and finalized both policy shards"

(
  cd "$routing_root"
  NEON_DATABASE_URL="$database_url" \
  REALTIME_AUTH_SECRET="$auth_secret" \
  REALTIME_ALLOWED_ORIGINS="http://127.0.0.1:3000" \
  REALTIME_HEARTBEAT_SECONDS=1 \
  PORT="$realtime_port" \
    cargo run --quiet -p loyal-yield-realtime
) >"$realtime_log" 2>&1 &
realtime_pid=$!

realtime_ready=0
for _ in $(seq 1 600); do
  if curl --silent --fail "http://127.0.0.1:$realtime_port/readyz" >/dev/null 2>&1; then
    realtime_ready=1
    break
  fi
  sleep 0.1
done
if [[ "$realtime_ready" -ne 1 ]]; then
  tail -80 "$realtime_log" >&2 || true
  fail "local realtime service did not become ready"
fi

start_web_listener() {
  local expected_reason="$1"
  local output="$2"
  (
    cd "$app_root/apps/web"
    bun run scripts/verify-autoswap-local-chain.ts listen \
      --auth-secret "$auth_secret" \
      --events-url "http://127.0.0.1:$realtime_port/events" \
      --expected-reason "$expected_reason" \
      --state "$state_json" \
      --output "$output"
  ) &
  listener_pid=$!

  local connected=0
  for _ in $(seq 1 100); do
    if curl --silent --fail "http://127.0.0.1:$realtime_port/metrics" |
      grep -q '^loyal_realtime_active_connections 1$'; then
      connected=1
      break
    fi
    sleep 0.1
  done
  [[ "$connected" -eq 1 ]] || fail "web SSE consumer did not connect"
}

echo "== Emulated LaserStream reconciles setup and web receives SSE"
start_web_listener "autoswap_installed" "$setup_events_json"
(
  cd "$routing_root"
  cargo run --quiet -p balance-sweep-ata-monitor \
    --bin autoswap-targeted-account-local-e2e -- \
    --postgres-url "$database_url" \
    --rpc-url "http://127.0.0.1:$rpc_port" \
    --state "$state_json" \
    --transactions "$state_json.transactions.ndjson" \
    --account-kind smart-account \
    --policy-commitment "$policy_commitment"
)
wait "$listener_pid"
listener_pid=""
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.cross_mint_swap_policies WHERE active AND start_eligible AND source_commitment = '$policy_commitment'")" == "2" ]] ||
  fail "LaserStream emulator did not persist both $policy_commitment policies"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.cross_mint_vault_opt_ins WHERE enabled")" == "1" ]] ||
  fail "targeted account reconciliation did not materialize the enabled Autoswap opt-in"
[[ "$(sql_scalar "SELECT to_regclass('loyal_yield.cross_mint_vault_controls') IS NULL")" == "t" ]] ||
  fail "duplicate cross_mint_vault_controls table exists"
jq -e '.event.reason == "autoswap_installed" and .refreshPlan.earnState == true and .refreshPlan.transactions == false' \
  "$setup_events_json" >/dev/null || fail "web SSE setup invalidation is incorrect"
pass "chain-derived setup reconciled and refreshed Autoswap state over SSE"

echo "== Backend pauses; web closes on-chain; LaserStream removes projection"
psql_verify --command="
  UPDATE loyal_yield.cross_mint_vault_opt_ins
  SET enabled = FALSE, generation = generation + 1, updated_at = now()
  WHERE enabled;
" >/dev/null
start_web_listener "autoswap_removed" "$close_events_json"
(
  cd "$app_root/apps/web"
  bun run scripts/verify-autoswap-local-chain.ts close \
    --rpc-url "http://127.0.0.1:$rpc_port" \
    --state "$state_json" \
    --output "$close_transactions"
)
(
  cd "$routing_root"
  cargo run --quiet -p balance-sweep-ata-monitor \
    --bin autoswap-targeted-account-local-e2e -- \
    --postgres-url "$database_url" \
    --rpc-url "http://127.0.0.1:$rpc_port" \
    --state "$state_json" \
    --transactions "$close_transactions" \
    --account-kind policy-deleted \
    --policy-commitment "$policy_commitment"
)
wait "$listener_pid"
listener_pid=""
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.cross_mint_vault_opt_ins")" == "0" ]] ||
  fail "complete finalized close left an Autoswap opt-in behind"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.cross_mint_swap_policies WHERE active")" == "0" ]] ||
  fail "complete finalized close left active Autoswap policies"
jq -e '.event.reason == "autoswap_removed" and .refreshPlan.earnState == true' \
  "$close_events_json" >/dev/null || fail "web SSE removal invalidation is incorrect"
pass "backend pause remained server-owned; web close reconciled from chain and SSE refreshed state"

for removed_route in \
  "$app_root/apps/web/src/app/api/smart-accounts/yield-optimization/cross-mint/policies/confirm/route.ts" \
  "$app_root/apps/web/src/app/api/smart-accounts/yield-optimization/cross-mint/delete/confirm/route.ts"; do
  [[ ! -e "$removed_route" ]] || fail "client-confirm database write route still exists: $removed_route"
done
pass "no Autoswap client confirmation API writes database state"
if [[ -n "${LOCAL_E2E_EVIDENCE_DIR:-}" ]]; then
  mkdir -p "$LOCAL_E2E_EVIDENCE_DIR"
  cp "$setup_events_json" "$close_events_json" "$close_transactions" "$LOCAL_E2E_EVIDENCE_DIR/"
  jq 'del(.walletSecretKey)' "$state_json" > "$LOCAL_E2E_EVIDENCE_DIR/state-public.json"
fi
pass "ASK-2168 isolated local Autoswap setup/close E2E"
