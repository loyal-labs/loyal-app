import assert from "node:assert/strict";

import { parseWithdrawalHealth, WITHDRAWAL_HEALTH_MAX_AGE_MS } from "../src/features/earn-max/voltr/withdrawal-health";

const now = Date.parse("2026-10-08T12:00:00Z");
const scope = { cluster: "mainnet-beta", program: "program", routeKey: "route", vault: "vault" };
const health = {
  ...scope, version: 1, status: "operator_attention", reason: "withdrawal_full_exit_unproven",
  observedAt: new Date(now - 1000).toISOString(), observedSlot: 100,
  blockedSince: new Date(now - 5000).toISOString(),
};
assert.equal(parseWithdrawalHealth(health, scope, now).status, "operator_attention");
for (const field of ["cluster", "program", "routeKey", "vault"] as const) {
  const result = parseWithdrawalHealth({ ...health, [field]: "other" }, scope, now);
  assert.equal(result.status, "unavailable", `${field} mismatch must fail closed`);
  assert.equal(result.lastKnownAttention, false, "foreign state cannot become this vault's attention");
}
for (const patch of [
  { observedAt: new Date(now + 1).toISOString() },
  { observedAt: new Date(now - WITHDRAWAL_HEALTH_MAX_AGE_MS - 1).toISOString() },
  { observedAt: "invalid" }, { observedSlot: 0 }, { observedSlot: 0.5 },
  { blockedSince: new Date(now + 1).toISOString() }, { blockedSince: null },
]) {
  const result = parseWithdrawalHealth({ ...health, ...patch }, scope, now);
  assert.equal(result.status, "unavailable", "invalid/stale evidence cannot look current");
  assert.equal(result.lastKnownAttention, true, "stale attention must not look recovered");
}
for (const value of [null, [], {}, { ...health, version: 2 }, { ...health, status: "claimable" }]) {
  assert.equal(parseWithdrawalHealth(value, scope, now).status, "unavailable");
}
assert.equal(parseWithdrawalHealth({ ...health, status: "none" }, scope, now).status, "unavailable");
assert.equal(parseWithdrawalHealth({ ...health, status: "waiting", blockedSince: null }, scope, now).status, "waiting");
assert.equal(parseWithdrawalHealth({ ...health, status: "unavailable", lastKnownAttention: true }, scope, now).lastKnownAttention, true);
console.log("PASS: withdrawal health rejects foreign/stale/invalid evidence and preserves known attention");
