import { hostname } from "node:os";

import { neon } from "@neondatabase/serverless";

import { redactSecrets } from "./redact.ts";
import type { PersistedState } from "./relay.ts";

/**
 * Where the relay keeps the snapshot it restores on boot. Every method is
 * fail-open: a store that is unreachable, slow, or holding a lease owned by
 * another instance costs the duplicate messages the snapshot would have
 * prevented, and nothing more. It must never stop the relay from accepting a
 * webhook or posting an alert — the alerting path cannot depend on storage
 * being healthy.
 */
export interface StateStore {
  readonly kind: "none" | "file" | "database";
  /** Snapshot to restore, or `null` when there is nothing usable to restore. */
  load(): Promise<PersistedState | null>;
  save(state: PersistedState): Promise<void>;
  /**
   * Hand the write lease back at shutdown so the replacement instance does not
   * have to wait it out. Best-effort, like everything else here.
   */
  release(): Promise<void>;
}

/**
 * The tagged-template call shape shared by every Postgres client worth using
 * here, narrowed to what this module needs. Declaring it keeps the store
 * testable against a fake without a database.
 */
export type SqlExecutor = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown[]>;

export interface DatabaseStateStoreOptions {
  databaseUrl: string;
  /** Identifies the deployment, so two environments cannot share a row. */
  stateKey: string;
  /**
   * How long a claim stays valid without a write. Must exceed the sweep
   * interval by a healthy margin, or an instance loses the lease to itself
   * between snapshots.
   */
  leaseSeconds: number;
  /** Overridable so a test can assert what two instances do to each other. */
  owner?: string;
  /** Injected by tests; production always uses the Neon HTTP driver. */
  sql?: SqlExecutor;
}

const NULL_STORE: StateStore = {
  kind: "none",
  async load() {
    return null;
  },
  async save() {},
  async release() {},
};

export function createNullStateStore(): StateStore {
  return NULL_STORE;
}

/**
 * Snapshot on a mounted disk. Cheapest option, but it ties the relay to one
 * machine and makes Render stop the old instance before starting the new one.
 */
export function createFileStateStore(path: string): StateStore {
  return {
    kind: "file",
    async load() {
      try {
        const file = Bun.file(path);
        if (!(await file.exists())) {
          return null;
        }
        return (await file.json()) as PersistedState;
      } catch (error) {
        logStoreFailure("state_restore_failed", error, { store: "file" });
        return null;
      }
    },
    async save(state) {
      try {
        await Bun.write(path, JSON.stringify(state));
      } catch (error) {
        logStoreFailure("state_persist_failed", error, { store: "file" });
      }
    },
    async release() {},
  };
}

/**
 * Snapshot in the `telegram_relay_state` table, one row per `stateKey`.
 *
 * The schema lives in `packages/db-core/src/schema.ts`, but this service builds
 * from its own Render `rootDir`, so the monorepo is outside its Docker context
 * and it cannot import that package. The column names below are therefore
 * duplicated by hand: a rename there breaks this at runtime, not at build time.
 *
 * Writes are guarded by a lease because Render runs the old and new instance
 * concurrently during a deploy. Without it the instance being shut down writes
 * its final snapshot on SIGTERM *after* the new one has booted, restoring a
 * daily tally that is a few seconds stale on every single deploy.
 */
export function createDatabaseStateStore(
  options: DatabaseStateStoreOptions
): StateStore {
  const sql = options.sql ?? (neon(options.databaseUrl) as SqlExecutor);
  const owner = options.owner ?? defaultOwner();
  const { stateKey, leaseSeconds } = options;

  return {
    kind: "database",

    async load() {
      try {
        const rows = (await sql`
          SELECT state
          FROM telegram_relay_state
          WHERE state_key = ${stateKey}
        `) as { state: unknown }[];

        const state = rows[0]?.state;
        if (!state || typeof state !== "object") {
          return null;
        }
        // `importState` checks `version` itself and drops what it does not
        // recognize, so an old snapshot needs no handling here.
        return state as PersistedState;
      } catch (error) {
        logStoreFailure("state_restore_failed", error, { store: "database" });
        return null;
      }
    },

    async save(state) {
      try {
        // One statement, so the claim and the write cannot come apart: the
        // `WHERE` runs against the row as it exists at write time. Lease
        // arithmetic uses `now()` throughout, keeping it on the database clock
        // rather than mixing in this instance's.
        const rows = (await sql`
          INSERT INTO telegram_relay_state (
            state_key, state_version, state, saved_at,
            lease_owner, lease_expires_at
          )
          VALUES (
            ${stateKey},
            ${state.version},
            ${JSON.stringify(state)}::jsonb,
            ${new Date(state.savedAt).toISOString()},
            ${owner},
            now() + make_interval(secs => ${leaseSeconds})
          )
          ON CONFLICT (state_key) DO UPDATE SET
            state_version = EXCLUDED.state_version,
            state = EXCLUDED.state,
            saved_at = EXCLUDED.saved_at,
            lease_owner = EXCLUDED.lease_owner,
            lease_expires_at = EXCLUDED.lease_expires_at,
            updated_at = now()
          WHERE telegram_relay_state.lease_owner IS NULL
             OR telegram_relay_state.lease_owner = EXCLUDED.lease_owner
             OR telegram_relay_state.lease_expires_at IS NULL
             OR telegram_relay_state.lease_expires_at < now()
          RETURNING id
        `) as unknown[];

        if (rows.length === 0) {
          // Another instance holds a live lease. Expected during a deploy and
          // not an error: this instance keeps alerting from memory, and the
          // instance that owns the row keeps the snapshot current.
          console.warn(
            JSON.stringify({
              event: "state_lease_held",
              stateKey,
              owner,
            })
          );
        }
      } catch (error) {
        logStoreFailure("state_persist_failed", error, { store: "database" });
      }
    },

    async release() {
      try {
        await sql`
          UPDATE telegram_relay_state
          SET lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
          WHERE state_key = ${stateKey} AND lease_owner = ${owner}
        `;
      } catch (error) {
        logStoreFailure("state_lease_release_failed", error, {
          store: "database",
        });
      }
    },
  };
}

/**
 * Distinct per process, not per host: Render gives a replacement instance the
 * same hostname, and two instances sharing an owner id would defeat the lease.
 */
function defaultOwner(): string {
  return `${hostname()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
}

function logStoreFailure(
  event: string,
  error: unknown,
  context: Record<string, string>
): void {
  console.error(
    JSON.stringify({
      event,
      ...context,
      // A driver error quotes the connection string, password included.
      // Truncated and redacted for the same reason webhook errors are.
      errorMessage: redactSecrets(
        error instanceof Error ? error.message : String(error)
      ).slice(0, 300),
    })
  );
}
