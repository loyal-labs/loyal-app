#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
routing_root="$(cd "${LOYAL_YIELD_ROUTING_ROOT:?Use scripts/verify-earn-local-e2e.sh --routing-root PATH}" && pwd)"
git_common_dir="$(git -C "$routing_root" rev-parse --path-format=absolute --git-common-dir)"
shared_routing_root="$(dirname "$git_common_dir")"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$shared_routing_root/target}"
app_root=""
scratch_dir="$(mktemp -d "/tmp/ask-2212-client-earn-local-e2e.XXXXXX")"
postgres_data="$scratch_dir/postgres"
postgres_socket="$scratch_dir/postgres-socket"
postgres_log="$scratch_dir/postgres.log"
validator_log="$scratch_dir/validator.log"
realtime_log="$scratch_dir/realtime.log"
genesis_dir="$scratch_dir/genesis"
genesis_manifest="$scratch_dir/genesis.json"
state_json="$scratch_dir/state.json"
projected_earn_state_json="$scratch_dir/projected-earn-state.json"
initial_transactions="$scratch_dir/initial.ndjson"
topup_transaction="$scratch_dir/topup.ndjson"
partial_transaction="$scratch_dir/partial.ndjson"
full_transaction="$scratch_dir/full.ndjson"
route_policy_transaction="$scratch_dir/route-policy.json"
setup_policy_transaction="$scratch_dir/setup-policy.json"
initial_deposit_transaction="$scratch_dir/initial-deposit.json"
subscribe_request_json="$scratch_dir/subscribe-request.json"
sse_events_json="$scratch_dir/sse-events.json"
database_name="ask_2212_client_earn_local_e2e"
base_port="$(python3 "$script_dir/find-local-ports.py" 25800 1000)"
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
auth_secret="ask-2212-local-e2e-auth-secret-0000000000000000000000000000"
run_started_at=$SECONDS
last_timing_at=$SECONDS

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

timing() {
  local now=$SECONDS
  echo "TIMING: $* took $((now - last_timing_at))s (total $((now - run_started_at))s)"
  last_timing_at=$now
}

cleanup() {
  local status=$?
  if [[ "$status" -ne 0 && "${KEEP_E2E_ON_FAILURE:-0}" == "1" ]]; then
    echo "KEEP_E2E_ON_FAILURE: runtime retained at $scratch_dir" >&2
    echo "KEEP_E2E_ON_FAILURE: database=${database_url:-unavailable} rpc=http://127.0.0.1:$rpc_port" >&2
    while true; do sleep 300; done
  fi
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
  rm -rf "$scratch_dir" 2>/dev/null || true
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-root)
      app_root="${2:-}"
      shift 2
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -n "$app_root" ]] || fail "--app-root is required"
app_root="$(cd "$app_root" && pwd)"
[[ "$app_root" != "$routing_root" ]] || fail "app and routing worktrees must be separate"
[[ -f "$app_root/apps/web/scripts/verify-earn-client-local-chain.ts" ]] ||
  fail "app worktree is missing the client Earn local-chain driver"

if [[ -x /opt/homebrew/opt/postgresql@17/bin/postgres ]]; then
  pg_bindir=/opt/homebrew/opt/postgresql@17/bin
else
  pg_bindir="$(pg_config --bindir)"
fi

for command_name in bun cargo cargo-build-sbf curl jq solana-test-validator; do
  command -v "$command_name" >/dev/null || fail "$command_name is required"
done
for postgres_command in initdb pg_ctl psql; do
  [[ -x "$pg_bindir/$postgres_command" ]] || fail "$postgres_command is required"
done

mkdir -p "$postgres_socket" "$genesis_dir"
"$pg_bindir/initdb" -D "$postgres_data" -A trust --no-locale -E UTF8 >/dev/null
"$pg_bindir/pg_ctl" -D "$postgres_data" -l "$postgres_log" \
  -o "-F -k '$postgres_socket' -p $postgres_port -c listen_addresses=127.0.0.1" \
  -w start >/dev/null
postgres_started=1
"$pg_bindir/psql" -X --set=ON_ERROR_STOP=1 \
  --host="$postgres_socket" --port="$postgres_port" --username="$(id -un)" \
  --dbname=postgres --command="CREATE DATABASE $database_name" >/dev/null
database_url="postgresql://$(id -un)@127.0.0.1:${postgres_port}/${database_name}"
app_earn_migrations="$app_root/apps/web/src/lib/yield-optimization/migrations"

psql_verify() {
  "$pg_bindir/psql" -X --set=ON_ERROR_STOP=1 \
    --host="$postgres_socket" --port="$postgres_port" --username="$(id -un)" \
    --dbname="$database_name" "$@"
}

sql_scalar() {
  psql_verify -A -t --command="$1" | tr -d '[:space:]'
}

assert_position_amount() {
  local expected="$1"
  local actual
  actual="$(sql_scalar "SELECT current_amount_raw FROM loyal_yield.user_yield_positions WHERE settings = '$(jq -r .settingsPda "$state_json")' AND vault_index = 1 ORDER BY id DESC LIMIT 1")"
  [[ "$actual" == "$expected" ]] || fail "projected Earn amount is $actual, expected $expected"
}

echo "== Build isolated protocol fixture and database"
(
  cd "$routing_root"
  cargo build-sbf \
    --manifest-path crates/mock-yield-protocols-program/Cargo.toml \
    --sbf-out-dir target/deploy
  NEON_DATABASE_URL="$database_url" NO_DNA=1 \
    python3 "$script_dir/local-e2e-schema.py"
  cargo run --quiet -p loyal-local-e2e --bin earn-client-local-genesis -- \
    "$genesis_dir" "$genesis_manifest"
) >/dev/null
psql_verify --file="$app_earn_migrations/0001_add_user_yield_deposit_positions.sql" >/dev/null
psql_verify --file="$app_earn_migrations/0004_add_verifiable_earn_holdings.sql" >/dev/null
psql_verify --file="$app_earn_migrations/0011_add_packed_withdrawal_reserve_metadata.sql" >/dev/null
psql_verify --file="$app_earn_migrations/0012_add_withdrawal_source_metadata.sql" >/dev/null
psql_verify --command="
  DROP TRIGGER IF EXISTS user_yield_positions_realtime_event
    ON loyal_yield.user_yield_positions;
  CREATE TRIGGER user_yield_positions_realtime_event
    AFTER INSERT OR UPDATE ON loyal_yield.user_yield_positions
    FOR EACH ROW
    EXECUTE FUNCTION loyal_yield.emit_user_yield_position_realtime_event();

  DROP TRIGGER IF EXISTS user_yield_position_holding_events_realtime_event
    ON loyal_yield.user_yield_position_holding_events;
  CREATE TRIGGER user_yield_position_holding_events_realtime_event
    AFTER INSERT ON loyal_yield.user_yield_position_holding_events
    FOR EACH ROW
    EXECUTE FUNCTION loyal_yield.emit_user_yield_holding_event_realtime_event();
" >/dev/null
[[ -f "$routing_root/target/deploy/mock_yield_protocols_program.so" ]] ||
  fail "mock Kamino SBF program was not built"
[[ -n "$(sql_scalar "SELECT max(version) FROM loyal_yield.schema_migrations")" ]] ||
  fail "isolated database migrations did not apply"
psql_verify --command="
  INSERT INTO loyal_yield.realtime_configuration (singleton, solana_env)
  VALUES (TRUE, 'mainnet-beta')
  ON CONFLICT (singleton) DO UPDATE SET solana_env = EXCLUDED.solana_env;
" >/dev/null
pass "isolated database and client-executable Kamino fixture are ready"
timing "database and fixture setup"

program_config="$(jq -r .addresses.programConfig "$genesis_manifest")"
usdc_mint="$(jq -r .addresses.usdcMint "$genesis_manifest")"
collateral_mint="$(jq -r .addresses.collateralMint "$genesis_manifest")"
reserve_liquidity_supply="$(jq -r .addresses.reserveLiquiditySupply "$genesis_manifest")"
vault_collateral_ata="$(jq -r .addresses.vaultCollateralAta "$genesis_manifest")"
reserve="$(jq -r .addresses.reserve "$genesis_manifest")"
obligation="$(jq -r .addresses.obligation "$genesis_manifest")"
market="$(jq -r .addresses.market "$genesis_manifest")"
treasury="$(jq -r .addresses.treasury "$genesis_manifest")"

(
  cd "$routing_root"
  solana-test-validator \
    --reset \
    --ticks-per-slot 8 \
    --ledger "$scratch_dir/ledger" \
    --rpc-port "$rpc_port" \
    --faucet-port "$faucet_port" \
    --gossip-port "$gossip_port" \
    --dynamic-port-range "$dynamic_start-$dynamic_end" \
    --bpf-program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG \
      crates/squads-test-harness/fixtures/squads/squads_smart_account_program.so \
    --bpf-program KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD \
      target/deploy/mock_yield_protocols_program.so \
    --account "$program_config" "$(jq -r .files.programConfig "$genesis_manifest")" \
    --account "$usdc_mint" "$(jq -r .files.usdcMint "$genesis_manifest")" \
    --account "$collateral_mint" "$(jq -r .files.collateralMint "$genesis_manifest")" \
    --account "$reserve_liquidity_supply" "$(jq -r .files.reserveLiquiditySupply "$genesis_manifest")" \
    --account "$vault_collateral_ata" "$(jq -r .files.vaultCollateralAta "$genesis_manifest")" \
    --account "$reserve" "$(jq -r .files.reserve "$genesis_manifest")" \
    --account "$obligation" "$(jq -r .files.obligation "$genesis_manifest")" \
    --account "$market" "$(jq -r .files.market "$genesis_manifest")"
) >"$validator_log" 2>&1 &
validator_pid=$!

validator_ready=0
for _ in $(seq 1 300); do
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
pass "isolated finalized Solana chain is ready"
timing "validator startup"

if [[ -n "${LOCAL_E2E_MOBILE_REPORT:-}" ]]; then
  (
    cd "$app_root/apps/mobile"
    bun run scripts/verify-earn-headless-local.ts \
      --rpc-url "http://127.0.0.1:$rpc_port" \
      --postgres-url "$database_url" --port "$realtime_port" \
      --genesis "$genesis_manifest" --treasury "$treasury" \
      --state "$state_json" --routing-root "$routing_root" \
      --output "$LOCAL_E2E_MOBILE_REPORT"
  )
  pass "headless production mobile actions, API, chain, routing projection and SSE"
  exit 0
fi

echo "== Initial deposit is built and submitted by the web client"
(
  cd "$app_root/apps/web"
  bun run scripts/verify-earn-client-local-chain.ts initial \
    --rpc-url "http://127.0.0.1:$rpc_port" \
    --treasury "$treasury" \
    --genesis "$genesis_manifest" \
    --state "$state_json" \
    --transaction "$initial_transactions"
)
[[ "$(wc -l < "$initial_transactions" | tr -d '[:space:]')" == "3" ]] ||
  fail "initial deposit did not produce route policy, setup policy, and deposit transactions"
sed -n '1p' "$initial_transactions" >"$route_policy_transaction"
sed -n '2p' "$initial_transactions" >"$setup_policy_transaction"
sed -n '3p' "$initial_transactions" >"$initial_deposit_transaction"
jq -e '.stage == "route_policy"' "$route_policy_transaction" >/dev/null
jq -e '.stage == "setup_policy"' "$setup_policy_transaction" >/dev/null
jq -e '.stage == "initial_deposit"' "$initial_deposit_transaction" >/dev/null
pass "web submitted both policy stages and the client-built initial deposit"
timing "initial client transactions through confirmed"

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

(
  cd "$app_root/apps/web"
  bun run scripts/verify-earn-client-local-chain.ts listen \
    --auth-secret "$auth_secret" \
    --events-url "http://127.0.0.1:$realtime_port/events" \
    --state "$state_json" \
    --output "$sse_events_json"
) &
listener_pid=$!

connected=0
for _ in $(seq 1 100); do
  if curl --silent --fail "http://127.0.0.1:$realtime_port/metrics" |
    grep -q '^loyal_realtime_active_connections 1$'; then
    connected=1
    break
  fi
  sleep 0.1
done
[[ "$connected" -eq 1 ]] || fail "web SSE consumer did not connect"
timing "realtime service and SSE connection"

process_update() {
  local transaction="$1"
  local subscribe_output="${2:-}"
  local projected_state_output="${3:-}"
  local command=(
    cargo run --quiet -p balance-sweep-ata-monitor --bin earn-client-local-e2e --
    --postgres-url "$database_url"
    --rpc-url "http://127.0.0.1:$rpc_port"
    --state "$state_json"
    --transaction "$transaction"
  )
  if [[ -n "$subscribe_output" ]]; then
    command+=(--subscribe-request-output "$subscribe_output")
  fi
  if [[ -n "$projected_state_output" ]]; then
    command+=(--projected-earn-state-output "$projected_state_output")
  fi
  (cd "$routing_root" && "${command[@]}")
}

wait_for_finalized() {
  local transaction="$1"
  (
    cd "$app_root/apps/web"
    bun run scripts/verify-earn-client-local-chain.ts wait-finalized \
      --rpc-url "http://127.0.0.1:$rpc_port" \
      --transaction "$transaction"
  )
}

echo "== Finalized account updates project each client operation"
wait_for_finalized "$initial_transactions"
process_update "$route_policy_transaction"
process_update "$setup_policy_transaction" "" "$projected_earn_state_json"
process_update "$initial_deposit_transaction"
assert_position_amount 4000000
timing "initial transactions through finalized projection"

(
  cd "$app_root/apps/web"
  bun run scripts/verify-earn-client-local-chain.ts topup \
    --rpc-url "http://127.0.0.1:$rpc_port" --state "$state_json" \
    --transaction "$topup_transaction"
)
wait_for_finalized "$topup_transaction"
process_update "$topup_transaction"
assert_position_amount 6000000
timing "top-up through finalized projection"

(
  cd "$app_root/apps/web"
  bun run scripts/verify-earn-client-local-chain.ts partial \
    --rpc-url "http://127.0.0.1:$rpc_port" --state "$state_json" \
    --projected-state "$projected_earn_state_json" \
    --transaction "$partial_transaction"
)
wait_for_finalized "$partial_transaction"
[[ "$(jq -r .projectedPolicyRefreshCount "$state_json")" == "1" ]] ||
  fail "partial withdrawal did not recover the projected policy from a stale client snapshot"
pass "existing-position withdrawal recovered its LaserStream-projected policy"
process_update "$partial_transaction"
assert_position_amount 4000000
timing "partial withdrawal through finalized projection"

(
  cd "$app_root/apps/web"
  bun run scripts/verify-earn-client-local-chain.ts full \
    --rpc-url "http://127.0.0.1:$rpc_port" --state "$state_json" \
    --transaction "$full_transaction"
)
wait_for_finalized "$full_transaction"
process_update "$full_transaction" "$subscribe_request_json"
assert_position_amount 0
timing "full withdrawal through finalized projection"

wait "$listener_pid"
listener_pid=""

[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.user_yield_position_deposits")" == "2" ]] ||
  fail "projection did not persist initial and top-up deposits"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.user_yield_position_withdrawals")" == "2" ]] ||
  fail "projection did not persist partial and full withdrawals"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.earn_chain_mutations WHERE mutation_kind IN ('deposit', 'withdrawal')")" == "4" ]] ||
  fail "projection did not durably fence all four chain cash-flow mutations"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.earn_reconciliation_jobs WHERE consumer_name = 'ask-2212-local-client-earn' AND completed_at IS NOT NULL AND last_error IS NULL")" == "6" ]] ||
  fail "not every emulated LaserStream update completed durably"
[[ "$(sql_scalar "SELECT string_agg(event_type::text, ',' ORDER BY id) FROM loyal_yield.user_yield_position_holding_events")" == "deposit_initialized,deposit_top_up,withdrawal_partial,withdrawal_full" ]] ||
  fail "holding event sequence does not match initial/top-up/partial/full flow"

jq -e \
  '.commitment == "confirmed" and (.transactions | length) == 0 and (.accounts.earn_obligations | length) >= 1' \
  "$subscribe_request_json" >/dev/null ||
  fail "refreshed LaserStream request is not confirmed and account-only"
jq -e \
  '.transactionReasons == ["holding_event_deposit_initialized", "holding_event_deposit_top_up", "holding_event_withdrawal_partial", "holding_event_withdrawal_full"] and .refreshPlan.position == true and .refreshPlan.transactions == true and .refreshPlan.earnings == true' \
  "$sse_events_json" >/dev/null ||
  fail "web SSE invalidations or refresh plan are incorrect"
jq -e '.forbiddenApiRequests == [] and .kaminoRequestCount == 5 and .resumedInitialDeposit == true' "$state_json" >/dev/null ||
  fail "web flow called an Earn confirmation API or skipped a client instruction build"

pass "initial/top-up deposits and partial/full withdrawals projected 4M -> 6M -> 4M -> 0"
pass "finalized account updates emitted the expected SSE sequence and web refresh plan"
pass "web built every operation on-client and sent no confirmation or reconciliation API request"
if [[ -n "${LOCAL_E2E_EVIDENCE_DIR:-}" ]]; then
  mkdir -p "$LOCAL_E2E_EVIDENCE_DIR"
  cp "$sse_events_json" "$subscribe_request_json" "$projected_earn_state_json" \
    "$initial_transactions" "$topup_transaction" "$partial_transaction" \
    "$full_transaction" "$LOCAL_E2E_EVIDENCE_DIR/"
fi
pass "ASK-2212 isolated local web Earn deposit/withdraw E2E"
timing "durable state and client invalidation assertions"
