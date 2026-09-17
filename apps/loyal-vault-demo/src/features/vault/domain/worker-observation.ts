export type WorkerObservation = Readonly<{
  source: "yield-worker-journal";
  observedAt: string;
  observedSlot: string;
  leaseActive: boolean;
  freshness: "fresh" | "stale";
  routeStatus: "idle" | "positioned" | "withdrawal_pending";
  operation: { action: string; status: string; updatedAt: string } | null;
}>;

/** A lease proves ownership, not healthy servicing; freshness is independent. */
export function parseWorkerObservation(row: Record<string, unknown>): WorkerObservation {
  const { observed_at: at, observed_slot: slot, lease_active: lease, route_status: state, database_now: now } = row;
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at)) || typeof now !== "string" ||
      !Number.isFinite(Date.parse(now)) || typeof slot !== "string" || !/^[1-9][0-9]{0,19}$/.test(slot) ||
      BigInt(slot) > (1n << 64n) - 1n || typeof lease !== "boolean" ||
      !["idle", "positioned", "withdrawal_pending"].includes(String(state))) throw new Error("Invalid worker observation");
  const age = Date.parse(now) - Date.parse(at);
  if (age < -2_000) throw new Error("Worker observation is in the future");
  let operation: WorkerObservation["operation"] = null;
  if (row.operation_action !== null) {
    if (typeof row.operation_action !== "string" || !/^[A-Z_]{1,64}$/.test(row.operation_action) ||
        typeof row.operation_status !== "string" || !["decided", "built", "simulated", "signed", "broadcast_intent", "submitted", "confirmed", "reconciled", "failed", "reconciling", "manual_recovery", "held"].includes(row.operation_status) ||
        typeof row.operation_updated_at !== "string" || !Number.isFinite(Date.parse(row.operation_updated_at))) throw new Error("Invalid worker operation");
    operation = { action: row.operation_action, status: row.operation_status, updatedAt: row.operation_updated_at };
  }
  return { source: "yield-worker-journal", observedAt: at, observedSlot: slot, leaseActive: lease,
    freshness: age <= 60_000 ? "fresh" : "stale", routeStatus: state as WorkerObservation["routeStatus"], operation };
}
