import { describe, expect, test } from "bun:test";

import type { PersistedState } from "./relay.ts";
import { createDatabaseStateStore, type SqlExecutor } from "./state-store.ts";

const SNAPSHOT: PersistedState = {
  version: 2,
  savedAt: 1_700_000_000_000,
  windows: [],
};

function storeWith(sql: SqlExecutor, owner = "instance-a") {
  return createDatabaseStateStore({
    databaseUrl: "postgresql://unused",
    stateKey: "test-relay",
    leaseSeconds: 300,
    owner,
    sql,
  });
}

/** Records the interpolated values of every statement the store issues. */
function recordingExecutor(result: unknown[] = [{ id: "row" }]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql: SqlExecutor = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return result;
  };
  return { sql, calls };
}

describe("database state store", () => {
  test("a rejected lease claim does not throw or retry", async () => {
    // Zero rows back is Postgres reporting that the `ON CONFLICT ... WHERE`
    // guard held: another instance owns the row. The relay has to carry on
    // alerting from memory rather than treating this as a failure.
    const { sql, calls } = recordingExecutor([]);

    await storeWith(sql).save(SNAPSHOT);

    expect(calls).toHaveLength(1);
  });

  test("the owner is written with the snapshot, not assumed", async () => {
    // The lease is only worth anything if the write that renews it carries the
    // same owner the guard compares against.
    const { sql, calls } = recordingExecutor();

    await storeWith(sql, "instance-b").save(SNAPSHOT);

    expect(calls[0]?.values).toContain("instance-b");
    expect(calls[0]?.values).toContain("test-relay");
  });

  test("a store failure never reaches the caller", async () => {
    // Every call site is on the alerting path. A database outage must cost the
    // snapshot, never a webhook or an alert.
    const failing: SqlExecutor = async () => {
      throw new Error("connection refused");
    };
    const store = storeWith(failing);

    expect(await store.load()).toBeNull();
    await store.save(SNAPSHOT);
    await store.release();
  });

  test("a missing or unreadable row restores nothing", async () => {
    const empty: SqlExecutor = async () => [];
    expect(await storeWith(empty).load()).toBeNull();

    const nullState: SqlExecutor = async () => [{ state: null }];
    expect(await storeWith(nullState).load()).toBeNull();
  });

  test("release only clears a lease this instance still owns", async () => {
    const { sql, calls } = recordingExecutor([]);

    await storeWith(sql, "instance-c").release();

    expect(calls[0]?.text).toContain("lease_owner = ");
    expect(calls[0]?.values).toEqual(["test-relay", "instance-c"]);
  });
});
