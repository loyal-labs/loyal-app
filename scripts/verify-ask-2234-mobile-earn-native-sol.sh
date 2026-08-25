#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root/apps/mobile"

deposit_source="src/lib/solana/earn/deposit.ts"
guard_line="$(rg -n -m 1 '^  assertNativeSolRequirement' "$deposit_source" | cut -d: -f1)"
connection_line="$(rg -n -m 1 '^  const connection = getConnection' "$deposit_source" | cut -d: -f1)"
test "$guard_line" -lt "$connection_line"

npx jest \
  src/lib/wallet/__tests__/insufficient-sol-error.test.ts \
  src/services/__tests__/lifecycle-rejection.test.ts \
  --runInBand

echo "PASS: ASK-2234 blocks underfunded Earn deposits before wallet submission and keeps them out of Errors alerts"
