#!/usr/bin/env bash
# App-owned orchestration; routing supplies production Rust workers and SBF fixtures.
set -euo pipefail
app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
routing_root=""
suite="all"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --routing-root) routing_root="${2:?--routing-root requires a path}"; shift 2 ;;
    --suite) suite="${2:?--suite requires all, autoswap, autodeposit, earn-client, or mobile}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
[[ -n "$routing_root" ]] || { echo "--routing-root is required" >&2; exit 1; }
export LOYAL_YIELD_ROUTING_ROOT="$(cd "$routing_root" && pwd)"
[[ -f "$LOYAL_YIELD_ROUTING_ROOT/crates/loyal-yield-store/Cargo.toml" ]] || {
  echo "Expected a loyal-yield-routing checkout" >&2; exit 1;
}
case "$suite" in
  all) suites=(autoswap autodeposit earn-client mobile) ;;
  autoswap|autodeposit|earn-client|mobile) suites=("$suite") ;;
  *) echo "Unknown suite: $suite" >&2; exit 1 ;;
esac
printf 'App revision: %s\nRouting revision: %s\n' \
  "$(git -C "$app_root" rev-parse HEAD)" "$(git -C "$LOYAL_YIELD_ROUTING_ROOT" rev-parse HEAD)"
for current in "${suites[@]}"; do
  if [[ "$current" == mobile ]]; then
    report="${LOCAL_E2E_MOBILE_REPORT:-$(mktemp -d /tmp/earn-mobile-evidence.XXXXXX)/result.json}"
    LOCAL_E2E_MOBILE_REPORT="$report" bash "$app_root/scripts/earn-local-e2e/verify-earn-client-local-e2e.sh" --app-root "$app_root"
    printf 'Mobile evidence: %s\n' "$report"
  else
    # An exported mobile-report variable must not silently replace the SDK suite.
    env -u LOCAL_E2E_MOBILE_REPORT bash "$app_root/scripts/earn-local-e2e/verify-$current-local-e2e.sh" --app-root "$app_root"
  fi
done
