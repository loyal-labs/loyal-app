import { neon } from "@neondatabase/serverless";
import { VAULT_IDENTITY } from "./config";
import { createObservationCache } from "./single-flight";
import { parseWorkerObservation, type WorkerObservation } from "../domain/worker-observation";

// Existing fenced Go worker tables. No full state, signed wire, signer, lease
// owner, recovery reason or credentials are selected or returned to browsers.
export const WORKER_OBSERVATION_SQL = `SELECT
  clock_timestamp()::text AS database_now,
  (r.lease_owner IS NOT NULL AND r.lease_expires_at > clock_timestamp()) IS TRUE AS lease_active,
  r.state->'observation'->>'observedAt' AS observed_at,
  r.state->'observation'->>'observedSlot' AS observed_slot,
  r.state->'observation'->>'routeStatus' AS route_status,
  o.action AS operation_action, o.status AS operation_status,
  o.updated_at::text AS operation_updated_at
FROM loyal_yield.multiply_route_states r
LEFT JOIN LATERAL (
  SELECT action, status, updated_at FROM loyal_yield.multiply_operations
  WHERE route_key = r.route_key AND engine_version = 'backyard_rwa_v1'
  ORDER BY updated_at DESC, operation_id DESC LIMIT 1
) o ON true
WHERE r.route_key = $1 LIMIT 1`;

type Read = { ok: true; observation: WorkerObservation } | { ok: false; reason: string };
const cache = createObservationCache<Read>({
  ttlMs: 5_000, failureBackoffMs: 30_000, isFailure: value => !value.ok,
  load: async () => {
    const url = process.env.LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL;
    if (!url) return { ok: false, reason: "Worker observation access is not configured." };
    try {
      const sql = neon(url);
      const [rows] = await sql.transaction([
        sql.query(WORKER_OBSERVATION_SQL, [`rwa-multiply:${VAULT_IDENTITY.manager}`]),
      ], { readOnly: true, isolationLevel: "RepeatableRead", fetchOptions: { signal: AbortSignal.timeout(10_000) } });
      if (rows.length !== 1) return { ok: false, reason: "No worker observation is available for this vault." };
      return { ok: true, observation: parseWorkerObservation(rows[0]!) };
    } catch {
      return { ok: false, reason: "Worker observation is unavailable or could not be validated." };
    }
  },
});
export const getWorkerObservation = cache.read;
