import assert from "node:assert/strict";
import { parseWorkerObservation } from "../src/features/vault/domain/worker-observation";
export function verifyWorkerObservation(): { passed: number } {
  const row = { database_now: "2026-09-05T03:00:30Z", observed_at: "2026-09-05T03:00:00Z", observed_slot: "444000000", lease_active: true, route_status: "withdrawal_pending", operation_action: null, operation_status: null, operation_updated_at: null };
  let passed = 0;
  assert.equal(parseWorkerObservation(row).freshness, "fresh"); passed++;
  assert.equal(parseWorkerObservation({ ...row, lease_active: false }).leaseActive, false); passed++;
  assert.equal(parseWorkerObservation({ ...row, database_now: "2026-09-05T03:02:00Z" }).freshness, "stale"); passed++;
  for (const patch of [{ observed_at: "2026-09-05T04:00:00Z" }, { observed_slot: "-1" }, { observed_slot: "18446744073709551616" }, { lease_active: "true" }, { route_status: "ready" }, { operation_action: "VOLTR_RESTORE_IDLE", operation_status: "complete", operation_updated_at: row.observed_at }]) {
    assert.throws(() => parseWorkerObservation({ ...row, ...patch })); passed++;
  }
  const submitted = parseWorkerObservation({ ...row, operation_action: "VOLTR_RESTORE_IDLE", operation_status: "submitted", operation_updated_at: row.observed_at });
  assert.equal(submitted.operation?.status, "submitted");
  assert(!("claimReady" in submitted)); passed++;
  return { passed };
}
