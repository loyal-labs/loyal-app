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

bun run verify:insufficient-sol:e2e

echo "PASS: ASK-2234 shows the exact top-up message, emits INFO without a global error, and submits no deposit"
