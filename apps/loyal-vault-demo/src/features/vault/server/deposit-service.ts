import { neon } from "@neondatabase/serverless";
import type { NavFreshnessView, ServiceStateView } from "../domain/types";
import { VAULT_IDENTITY } from "../domain/identity";
import type { VaultCore } from "./coherent-batch";
import { RPC_BOUNDS } from "./config";

// Public enablement is a release decision; runtime evidence is checked afresh
// even when it is enabled. This reader never changes the worker or its budget.
export function closedDepositService(reason = "Pilot deposits are not open yet."): ServiceStateView {
  return { deposits: "unavailable", depositsReason: reason, withdrawals: "read-only",
    withdrawalsNote: "Eligible withdrawals can be claimed by the wallet when vault liquidity is available." };
}

// Only selected public projections and booleans leave the database. The current
// report must also be the newest reconciled action: a later mutation invalidates
// readiness even while the prior report remains inside its slot window.
export const DEPOSIT_SERVICE_SQL = `SELECT
 clock_timestamp()::text AS database_now,
 (r.lease_owner=$2 AND r.lease_expires_at>clock_timestamp()) IS TRUE AS release_active,
 r.state->'observation' AS observation,
 (r.state->'phase3'->>'closed'='false'
  AND r.state->'phase3'->'pilot'->>'schema'='voltr-rwa-pilot-budget/v1'
  AND r.state->'phase3'->'pilot'->>'authorityId'='01a0a776-cb66-7333-99eb-7e6927c1e114'
  AND r.state->'pilotBudgetActivation'->'authority'=r.state->'phase3'->'pilot') IS TRUE AS pilot_active,
 NOT EXISTS(SELECT 1 FROM loyal_yield.backyard_manual_recovery_latches l
   WHERE l.route_key=r.route_key AND l.cleared_at IS NULL) AS no_manual_hold,
 NOT EXISTS(SELECT 1 FROM loyal_yield.multiply_operations p WHERE p.route_key=r.route_key
   AND p.status IN ('prepared','signed_persisted','broadcast_intent','confirmed','reconciliation_pending',
     'decided','built','simulated','signed','submitted','reconciling')) AS no_pending,
 last.action AS last_action, last.transaction_signature AS last_signature,
 last.confirmed_slot::text AS last_confirmed_slot
 FROM loyal_yield.multiply_route_states r
 LEFT JOIN LATERAL (SELECT action,transaction_signature,confirmed_slot
   FROM loyal_yield.multiply_operations o WHERE o.route_key=r.route_key
   AND o.engine_version='backyard_rwa_v1' AND o.status='reconciled'
   AND o.expected_effects->>'journalStrategyConfig'=$3
   ORDER BY confirmed_slot DESC NULLS LAST,updated_at DESC,operation_id COLLATE "C" DESC LIMIT 1) last ON true
 WHERE r.route_key=$1 LIMIT 1`;

export type DepositServiceCore = Pick<VaultCore, "slot" | "assetTotalValue" | "idleCustodyRaw" | "managerCustody"> & {
  vault: { vaultConfiguration: Pick<VaultCore["vault"]["vaultConfiguration"], "maxCap"> };
};

export function matchDepositService(core: DepositServiceCore, report: NavFreshnessView, row: Record<string, unknown>): ServiceStateView {
  const closed = () => closedDepositService("Deposits are paused while current vault servicing and accounting are verified.");
  if (report.status !== "fresh" || !report.reportSignature || !report.reportConfirmedSlot ||
      row.release_active !== true || row.pilot_active !== true || row.no_manual_hold !== true || row.no_pending !== true ||
      row.last_action !== "REPORT_NAV" || row.last_signature !== report.reportSignature ||
      row.last_confirmed_slot !== String(report.reportConfirmedSlot)) return closed();
  const o = row.observation;
  if (!o || typeof o !== "object" || Array.isArray(o)) return closed();
  const v = o as Record<string, unknown>;
  const now = typeof row.database_now === "string" ? Date.parse(row.database_now) : NaN;
  const at = typeof v.observedAt === "string" ? Date.parse(v.observedAt) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(at) || now-at < -2_000 || now-at > 15_000 ||
      !Number.isSafeInteger(v.observedSlot) || Number(v.observedSlot)<core.slot-32 || Number(v.observedSlot)>core.slot+32 ||
      v.navFresh !== true || !["idle", "positioned"].includes(String(v.routeStatus)) ||
      v.aumRaw !== core.assetTotalValue.toString() || v.voltrIdleRaw !== core.idleCustodyRaw.toString() ||
      !core.managerCustody || v.squadsIdleRaw !== core.managerCustody.amountRaw.toString() ||
      v.computedStrategyNavRaw !== report.lastNavRaw || v.reportedNavRaw !== report.lastNavRaw ||
      Number(v.observedSlot) < report.reportConfirmedSlot || v.voltrStrategyIdleRaw !== "0") return closed();
  if (core.vault.vaultConfiguration.maxCap <= 0n || core.vault.vaultConfiguration.maxCap > 100_000_000n ||
      core.assetTotalValue >= core.vault.vaultConfiguration.maxCap) return closedDepositService("The pilot vault is at its deposit limit.");
  return { ...closedDepositService(), deposits: "available", depositsReason: "Current vault servicing and accounting are verified." };
}

export async function readDepositService(core: VaultCore, report: NavFreshnessView, startedAt: number): Promise<ServiceStateView> {
  if (process.env.LOYAL_VAULT_DEMO_DEPOSITS_ENABLED !== "1") return closedDepositService();
  const image = process.env.LOYAL_VAULT_DEMO_WORKER_IMAGE;
  const service = process.env.LOYAL_VAULT_DEMO_WORKER_SERVICE_ID;
  const url = process.env.LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL;
  if (!image || !/^sha-[a-f0-9]{40}$/.test(image) || !service || !/^srv-[a-z0-9]+$/.test(service) || !url || report.status !== "fresh") {
    return closedDepositService("Current vault servicing is unavailable.");
  }
  const deadline = Math.min(performance.now()+2_000, startedAt+RPC_BOUNDS.maxStalenessMs);
  try {
    const remaining = Math.floor(deadline-performance.now());
    if (remaining <= 0) return closedDepositService("Refresh the vault before depositing.");
    const sql = neon(url);
    const [rows] = await sql.transaction([sql.query(DEPOSIT_SERVICE_SQL, [
      `rwa-multiply:${VAULT_IDENTITY.manager}`, `render:${service}:${image}`, VAULT_IDENTITY.adaptorConfigStrategy,
    ])], { readOnly: true, isolationLevel: "RepeatableRead", fetchOptions: { signal: AbortSignal.timeout(remaining) } });
    if (performance.now() >= deadline || rows.length !== 1) return closedDepositService("Current vault servicing is unavailable.");
    return matchDepositService(core, report, rows[0]!);
  } catch { return closedDepositService("Current vault servicing is unavailable."); }
}
