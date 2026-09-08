#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
routing_root="$(cd "${LOYAL_YIELD_ROUTING_ROOT:?Use scripts/verify-earn-local-e2e.sh --routing-root PATH}" && pwd)"
app_root=""
scratch_dir="$(mktemp -d "/tmp/ask-2211-autodeposit-local-e2e.XXXXXX")"
postgres_data="$scratch_dir/postgres"
postgres_socket="$scratch_dir/postgres-socket"
postgres_log="$scratch_dir/postgres.log"
validator_log="$scratch_dir/validator.log"
realtime_log="$scratch_dir/realtime.log"
setup_log="$scratch_dir/setup.log"
program_config_json="$scratch_dir/program-config.json"
usdc_mint_json="$scratch_dir/usdc-mint.json"
state_json="$scratch_dir/state.json"
subscribe_request_json="$scratch_dir/subscribe-request.json"
sse_event_json="$scratch_dir/setup-sse.json"
close_sse_event_json="$scratch_dir/close-sse.json"
close_subscribe_request_json="$scratch_dir/close-subscribe-request.json"
close_transactions_json="$scratch_dir/close-transactions.ndjson"
close_ready="$scratch_dir/close-ready"
pending_floor_ready="$scratch_dir/pending-floor-ready"
reconciliation_regression_json="$scratch_dir/earn-reconciliation-regression.json"
database_name="ask_2211_autodeposit_client_local_e2e"
base_port="$(python3 "$script_dir/find-local-ports.py" 24500 1200)"
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
setup_pid=""
postgres_started=0
auth_secret="ask-2211-local-e2e-auth-secret-0000000000000000000000000000"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

cleanup() {
  if [[ -n "$setup_pid" ]]; then
    kill "$setup_pid" >/dev/null 2>&1 || true
    wait "$setup_pid" >/dev/null 2>&1 || true
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
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -n "$app_root" ]] || fail "--app-root is required"
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
[[ -d "$app_root/node_modules" ]] ||
  fail "app worktree dependencies are required as a read-only package source"
[[ -f "$routing_root/crates/loyal-local-e2e/scripts/verify-autodeposit-local-chain.ts" ]] ||
  fail "routing worktree is missing the Autodeposit local-chain verifier"
[[ -f "$routing_root/crates/squads-test-harness/fixtures/subscriptions/subscriptions_program.so" ]] ||
  fail "subscriptions program fixture is missing"

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
psql_verify --file="$app_root/apps/web/src/lib/yield-optimization/migrations/0001_add_user_yield_deposit_positions.sql" >/dev/null
psql_verify --file="$app_root/apps/web/src/lib/yield-optimization/migrations/0004_add_verifiable_earn_holdings.sql" >/dev/null
psql_verify --command="
  CREATE TABLE loyal_yield.balance_sweep_policies (
    id BIGSERIAL PRIMARY KEY,
    settings TEXT NOT NULL,
    authority TEXT NOT NULL,
    policy_seed BIGINT NOT NULL,
    policy_account TEXT NOT NULL UNIQUE,
    policy_type TEXT NOT NULL DEFAULT 'subscription_sweep',
    vault_index SMALLINT NOT NULL,
    vault_pubkey TEXT NOT NULL,
    delegated_signers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    threshold INTEGER NOT NULL,
    liquidity_mint TEXT,
    subscription_authority TEXT,
    subscription_delegatee TEXT,
    wallet_usdc_ata TEXT,
    vault_usdc_ata TEXT,
    max_amount_per_period BIGINT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_slot BIGINT NOT NULL,
    last_seen_signature TEXT NOT NULL,
    closed_at TIMESTAMPTZ,
    close_signature TEXT,
    close_slot BIGINT
  );
  ALTER TABLE loyal_yield.balance_sweep_targets
    ADD COLUMN balance_sweep_policy_id BIGINT;
" >/dev/null
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.schema_migrations WHERE version = 65")" == "1" ]] ||
  fail "isolated database did not apply Autodeposit target cluster migration 65"
psql_verify --command="
  INSERT INTO loyal_yield.realtime_configuration (singleton, solana_env)
  VALUES (TRUE, 'mainnet-beta')
  ON CONFLICT (singleton) DO UPDATE SET solana_env = EXCLUDED.solana_env;
  INSERT INTO loyal_yield.balance_sweep_targets (
    settings, authority, policy_seed, policy_account, vault_index, vault_pubkey,
    wallet, token_mint, wallet_token_ata, vault_token_ata, delegated_signers,
    threshold, max_amount_per_period, desired_active, chain_status,
    last_seen_slot, last_seen_signature
  ) VALUES (
    'migration-check-settings', 'migration-check-authority', 1,
    'migration-check-policy', 1, 'migration-check-vault',
    'migration-check-wallet', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'migration-check-wallet-ata',
    'migration-check-vault-ata', ARRAY[]::TEXT[], 1, 1, TRUE, 'pending',
    1, 'migration-check-signature'
  );
" >/dev/null
psql_verify --file="$routing_root/crates/loyal-yield-store/migrations/0065_autodeposit_target_cluster.sql" >/dev/null
[[ "$(sql_scalar "SELECT cluster FROM loyal_yield.balance_sweep_targets WHERE policy_account = 'migration-check-policy'")" == "mainnet-beta" ]] ||
  fail "migration 65 did not repair a null-cluster Autodeposit target"
psql_verify --command="DELETE FROM loyal_yield.balance_sweep_targets WHERE policy_account = 'migration-check-policy'" >/dev/null
pass "migration 65 repairs existing null-cluster Autodeposit targets"
read -r program_config treasury usdc_mint < <(
  cd "$routing_root"
  cargo run --quiet -p loyal-local-e2e --bin autodeposit-local-genesis -- \
    "$program_config_json" "$usdc_mint_json"
)
[[ "$usdc_mint" == "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ]] ||
  fail "genesis helper returned an unexpected USDC mint"

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
    --bpf-program De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44 \
      crates/squads-test-harness/fixtures/subscriptions/subscriptions_program.so \
    --account "$program_config" "$program_config_json" \
    --account "$usdc_mint" "$usdc_mint_json"
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

echo "== Web client builds and submits Autodeposit setup"
(
  cd "$routing_root"
  NODE_PATH="$app_root/node_modules:$app_root/apps/web/node_modules" \
  LOYAL_APP_ROOT="$app_root" \
    bun run crates/loyal-local-e2e/scripts/verify-autodeposit-local-chain.ts setup \
    --rpc-url "http://127.0.0.1:$rpc_port" \
    --treasury "$treasury" \
    --close-ready "$close_ready" \
    --close-output "$close_transactions_json" \
    --output "$state_json"
) >"$setup_log" 2>&1 &
setup_pid=$!
setup_ready=0
for _ in $(seq 1 1200); do
  if [[ -s "$state_json" && -s "$state_json.transactions.ndjson" ]]; then
    setup_ready=1
    break
  fi
  if ! kill -0 "$setup_pid" >/dev/null 2>&1; then
    cat "$setup_log" >&2 || true
    fail "web setup driver exited before publishing finalized setup"
  fi
  sleep 0.1
done
if [[ "$setup_ready" -ne 1 ]]; then
  cat "$setup_log" >&2 || true
  fail "web setup driver did not publish finalized setup"
fi
[[ "$(wc -l < "$state_json.transactions.ndjson" | tr -d '[:space:]')" == "3" ]] ||
  fail "web setup did not produce the three expected finalized transactions"
jq -s -e \
  'map(.stage) == ["initialize_subscription_authority", "create_policy", "create_recurring_delegation"]' \
  "$state_json.transactions.ndjson" >/dev/null ||
  fail "web setup transaction sequence does not match the production stage machine"
pass "web client recovered a policy-only setup before projection and completed the delegation"

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
  cd "$routing_root"
  NODE_PATH="$app_root/node_modules:$app_root/apps/web/node_modules" \
  LOYAL_APP_ROOT="$app_root" \
    bun run crates/loyal-local-e2e/scripts/verify-autodeposit-local-chain.ts listen \
    --auth-secret "$auth_secret" \
    --events-url "http://127.0.0.1:$realtime_port/events" \
    --expected-reason "allowance_created" \
    --pending-floor-ready "$pending_floor_ready" \
    --postgres-url "$database_url" \
    --state "$state_json" \
    --output "$sse_event_json"
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

echo "== Emulated LaserStream notifications drive monitor reconciliation"
(
  cd "$routing_root"
  cargo run --quiet -p balance-sweep-ata-monitor \
    --bin autodeposit-targeted-account-local-e2e -- \
    --postgres-url "$database_url" \
    --rpc-url "http://127.0.0.1:$rpc_port" \
    --state "$state_json" \
    --transactions "$state_json.transactions.ndjson" \
    --pending-floor-ready "$pending_floor_ready" \
    --subscribe-request-output "$subscribe_request_json"
)
wait "$listener_pid"
listener_pid=""

[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.balance_sweep_targets WHERE desired_active AND chain_status = 'active' AND policy_account IS NOT NULL AND subscription_authority IS NOT NULL AND recurring_delegation IS NOT NULL")" == "1" ]] ||
  fail "monitor did not project exactly one active Autodeposit target"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.balance_sweep_targets WHERE desired_active AND chain_status = 'active' AND wallet_balance_floor_raw = 2000000")" == "1" ]] ||
  fail "pending Autodeposit floor did not survive confirmed activation"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.autodeposit_reconciliation_requests WHERE processed_slot >= requested_slot AND last_error IS NULL")" == "1" ]] ||
  fail "Autodeposit reconciliation request was not fully processed"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.earn_reconciliation_jobs WHERE consumer_name = 'ask-2211-local-autodeposit' AND completed_at IS NULL")" == "0" ]] ||
  fail "an emulated setup reconciliation job remained incomplete"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.earn_reconciliation_jobs WHERE consumer_name = 'ask-2211-local-autodeposit' AND completed_at IS NOT NULL AND last_error IS NULL")" -ge 3 ]] ||
  fail "setup notifications did not complete durably"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.realtime_events WHERE event_type = 'earn.autodeposit.configuration.changed' AND reason = 'allowance_created'")" == "1" ]] ||
  fail "chain activation did not emit exactly one allowance_created event"
jq -e \
  '.commitment == "confirmed" and (.transactions | length) == 0 and (.accounts.earn_autodeposit_wallet_atas | length) == 1 and (.accounts.earn_subscription_authorities | length) == 1 and (.accounts.earn_recurring_delegations | length) == 1' \
  "$subscribe_request_json" >/dev/null ||
  fail "refreshed monitor subscription is not confirmed and account-only"
jq -e \
  '.event.eventType == "earn.autodeposit.configuration.changed" and .event.reason == "allowance_created" and .refreshPlan.earnState == true and .refreshPlan.transactions == true and .ui.state == "created" and .ui.keepAmount == "2" and .ui.isOn == true and .ui.isPending == false' \
  "$sse_event_json" >/dev/null ||
  fail "web SSE did not refresh Autodeposit into the active UI state"
pass "monitor repaired a legacy queue blocker, projected the delegation, and refreshed active web state through SSE"

# The legacy-commitment regression above deliberately inserts a synthetic route
# policy at the subscription-authority address (seed 999). It is not an on-chain
# policy and must not keep that authority watched during the independent close
# assertion. Deactivate only this fixture row, never the real Autodeposit target.
psql_verify --command="
  UPDATE loyal_yield.route_policies SET active = FALSE
  WHERE last_seen_signature = 'legacy-policy-observation'
    AND policy_seed = 999
    AND policy_account = '$(jq -r .subscriptionAuthority "$state_json")';
" >/dev/null

echo "== Web client submits delete and SSE refreshes the removed state"
touch "$close_ready"
close_ready_on_chain=0
for _ in $(seq 1 1200); do
  if [[ -s "$close_transactions_json" ]]; then
    close_ready_on_chain=1
    break
  fi
  if ! kill -0 "$setup_pid" >/dev/null 2>&1; then
    cat "$setup_log" >&2 || true
    fail "web close driver exited before publishing the finalized close"
  fi
  sleep 0.1
done
if [[ "$close_ready_on_chain" -ne 1 ]]; then
  cat "$setup_log" >&2 || true
  fail "web close driver did not publish the finalized close"
fi
wait "$setup_pid"
setup_pid=""
[[ "$(wc -l < "$close_transactions_json" | tr -d '[:space:]')" == "1" ]] ||
  fail "web delete did not produce exactly one finalized transaction"
jq -s -e 'map(.stage) == ["close_autodeposit"]' \
  "$close_transactions_json" >/dev/null ||
  fail "web delete transaction did not use the Autodeposit close stage"

(
  cd "$routing_root"
  NODE_PATH="$app_root/node_modules:$app_root/apps/web/node_modules" \
  LOYAL_APP_ROOT="$app_root" \
    bun run crates/loyal-local-e2e/scripts/verify-autodeposit-local-chain.ts listen \
    --auth-secret "$auth_secret" \
    --events-url "http://127.0.0.1:$realtime_port/events" \
    --expected-reason "allowance_removed" \
    --expected-ui-state "deleted" \
    --postgres-url "$database_url" \
    --state "$state_json" \
    --output "$close_sse_event_json"
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
[[ "$connected" -eq 1 ]] || fail "web close SSE consumer did not connect"

(
  cd "$routing_root"
  cargo run --quiet -p balance-sweep-ata-monitor \
    --bin autodeposit-targeted-account-local-e2e -- \
    --postgres-url "$database_url" \
    --rpc-url "http://127.0.0.1:$rpc_port" \
    --state "$state_json" \
    --transactions "$close_transactions_json" \
    --pending-floor-ready "$pending_floor_ready" \
    --subscribe-request-output "$close_subscribe_request_json"
)
wait "$listener_pid"
listener_pid=""

[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.balance_sweep_targets WHERE chain_status = 'closed'")" == "1" ]] ||
  fail "monitor did not project exactly one deleted Autodeposit target"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.autodeposit_reconciliation_requests WHERE processed_slot >= requested_slot AND last_error IS NULL")" == "1" ]] ||
  fail "Autodeposit close reconciliation request was not fully processed"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.earn_reconciliation_jobs WHERE consumer_name = 'ask-2211-local-autodeposit' AND completed_at IS NULL")" == "0" ]] ||
  fail "an emulated close reconciliation job remained incomplete"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.earn_reconciliation_jobs WHERE consumer_name = 'ask-2211-local-autodeposit' AND completed_at IS NOT NULL AND last_error IS NULL")" -ge 4 ]] ||
  fail "Autodeposit close notification did not complete durably"
[[ "$(sql_scalar "SELECT count(*) FROM loyal_yield.realtime_events WHERE event_type = 'earn.autodeposit.configuration.changed' AND reason = 'allowance_removed'")" == "1" ]] ||
  fail "chain close did not emit exactly one allowance_removed event"
jq -e \
  '.event.eventType == "earn.autodeposit.configuration.changed" and .event.reason == "allowance_removed" and .refreshPlan.earnState == true and .refreshPlan.transactions == true and .ui.state == "deleted" and .ui.keepAmount == null and .ui.isOn == false and .ui.isPending == false' \
  "$close_sse_event_json" >/dev/null ||
  fail "web SSE did not refresh Autodeposit into the deleted UI state"
pass "web delete closed confirmed accounts, monitor projected removal, and SSE removed the UI rule"

if rg -q 'autodeposit/(setup|close)/confirm' \
  "$routing_root/crates/loyal-local-e2e/scripts/verify-autodeposit-local-chain.ts"; then
  fail "routing-owned client driver called an Autodeposit confirmation API"
fi
pass "routing-owned Autodeposit client submitted directly without a confirmation API"

for retired_web_prepare_route in \
  "$app_root/apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/setup/prepare/route.ts" \
  "$app_root/apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/close/prepare/route.ts"; do
  [[ ! -e "$retired_web_prepare_route" ]] ||
    fail "retired web Autodeposit prepare route still exists: $retired_web_prepare_route"
done

for retired_web_confirmation_route in \
  "$app_root/apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/setup/confirm/route.ts" \
  "$app_root/apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/close/confirm/route.ts"; do
  [[ ! -e "$retired_web_confirmation_route" ]] ||
    fail "retired web Autodeposit confirmation route still exists: $retired_web_confirmation_route"
done

for compatible_mobile_route in \
  "$app_root/apps/web/src/app/api/smart-accounts/mobile/earn/autodeposit/setup/prepare/route.ts" \
  "$app_root/apps/web/src/app/api/smart-accounts/mobile/earn/autodeposit/setup/confirm/route.ts" \
  "$app_root/apps/web/src/app/api/smart-accounts/mobile/earn/autodeposit/close/prepare/route.ts" \
  "$app_root/apps/web/src/app/api/smart-accounts/mobile/earn/autodeposit/close/confirm/route.ts"; do
  [[ -f "$compatible_mobile_route" ]] ||
    fail "released mobile Autodeposit contract is missing: $compatible_mobile_route"
done
pass "retired web prepare/confirm routes are absent and released mobile compatibility remains available"

echo "== Production-shaped Earn reconciliation regression load"
(
  cd "$routing_root"
  cargo run --quiet -p loyal-local-e2e --bin earn-reconciliation-regression -- \
    --postgres-url "$database_url" \
    --output "$reconciliation_regression_json"
)
jq -e '
  .transactionClassification.unrelatedSingleMintIsNoop
  and .transactionClassification.unrelatedMultiMintIsNoop
  and .transactionClassification.earnAnchoredSingleMintIsDetected
  and .transactionClassification.retryAlertEmissions == 1
  and .legacyUnknownPolicyAccepted
  and .mainnetRefundNormalized
  and .operationalAlerts == 0
' "$reconciliation_regression_json" >/dev/null ||
  fail "Earn reconciliation regression load did not complete alert-free"
pass "production-shaped reconciliation load drained with zero operational alerts"

pass "Autodeposit client driver remained isolated inside loyal-yield-routing"
if [[ -n "${LOCAL_E2E_EVIDENCE_DIR:-}" ]]; then
  mkdir -p "$LOCAL_E2E_EVIDENCE_DIR"
  cp "$sse_event_json" "$close_sse_event_json" "$subscribe_request_json" \
    "$close_subscribe_request_json" "$close_transactions_json" \
    "$reconciliation_regression_json" "$LOCAL_E2E_EVIDENCE_DIR/"
fi
pass "ASK-2211 isolated local Autodeposit setup, same-slot wakeup, delete, reconciliation, realtime, and SSE E2E"
