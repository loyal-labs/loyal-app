import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { readCachedEarnEarningsRangeSet } = await import(
  "./earnings-cache.server"
);
const { createEmptyEarnEarningsRangeSet } = await import(
  "./earnings-read-service.server"
);
const input = {
  cluster: "mainnet-beta",
  walletAddress: "wallet",
  settings: "settings",
  vaultIndex: 1,
  timezone: "UTC",
};

function fixture(ageMs = 0) {
  let now = new Date("2026-10-15T12:00:00Z");
  let revision = "revision-1";
  const generatedAt = new Date(now.getTime() - ageMs);
  let stored = {
    generatedAt,
    payload: createEmptyEarnEarningsRangeSet({
      now: generatedAt,
      timezone: "UTC",
    }),
    sourceRevision: revision,
  };
  let locked = false;
  const tasks: (() => Promise<void>)[] = [];
  const rebuild = mock(async () => {
    stored = {
      generatedAt: now,
      payload: createEmptyEarnEarningsRangeSet({ now, timezone: "UTC" }),
      sourceRevision: revision,
    };
    return stored.payload;
  });
  const deps = {
    now: () => now,
    loadSnapshot: async () => stored,
    loadSourceRevision: async () => revision,
    rebuild,
    withLock: async (_key: string, task: () => Promise<void>) => {
      if (locked) return false;
      locked = true;
      try {
        await task();
        return true;
      } finally {
        locked = false;
      }
    },
  };
  return {
    deps,
    tasks,
    stored: () => stored,
    setRevision: (value: string) => {
      revision = value;
    },
    setNow: (value: Date) => {
      now = value;
    },
    read: () =>
      readCachedEarnEarningsRangeSet(input, (task) => tasks.push(task), deps),
  };
}

test("fresh verified snapshots bypass historical calculation", async () => {
  const f = fixture();
  expect((await f.read()).freshness).toBe("fresh");
  expect(f.deps.rebuild).not.toHaveBeenCalled();
  expect(f.tasks).toHaveLength(0);
});

test("expired history returns immediately and concurrent refreshes rebuild once", async () => {
  const f = fixture(600_000);
  const old = f.stored().payload.generatedAt;
  const [left, right] = await Promise.all([f.read(), f.read()]);
  expect(left.generatedAt).toBe(old);
  expect(right.freshness).toBe("stale");
  expect(f.deps.rebuild).not.toHaveBeenCalled();
  await Promise.all(f.tasks.map((task) => task()));
  expect(f.deps.rebuild).toHaveBeenCalledTimes(1);
  expect((await f.read()).freshness).toBe("fresh");
  expect(f.stored().payload.generatedAt).not.toBe(old);
});

test("new ledger revisions invalidate an otherwise fresh cache", async () => {
  const f = fixture();
  f.setRevision("after-deposit-or-history-repair");
  expect((await f.read()).staleReason).toBe("history_changed");
  await f.tasks[0]();
  expect((await f.read()).freshness).toBe("fresh");
});

test("midnight refreshes daily buckets even inside the freshness window", async () => {
  const f = fixture();
  f.setNow(new Date("2026-10-16T00:00:01Z"));
  f.stored().generatedAt = new Date("2026-10-15T23:59:59Z");
  expect((await f.read()).freshness).toBe("stale");
  expect(f.tasks).toHaveLength(1);
});

test("a failed background refresh preserves the saved chart and releases its lock", async () => {
  const f = fixture(600_000);
  const previous = f.stored();
  f.deps.rebuild.mockImplementationOnce(async () => {
    throw new Error("database unavailable");
  });
  await f.read();
  await f.tasks[0]();
  expect(f.stored()).toBe(previous);
  await f.read();
  await f.tasks[1]();
  expect((await f.read()).freshness).toBe("fresh");
});

test("a cache without a revision is never treated as current", async () => {
  const f = fixture();
  f.stored().sourceRevision = "";
  expect((await f.read()).freshness).toBe("stale");
  expect(f.tasks).toHaveLength(1);
});

test("uncached requests use verification and cannot return unverified saved data", async () => {
  const f = fixture();
  f.stored().payload.principalMatchesHistory = false;
  expect((await f.read()).principalMatchesHistory).toBe(true);
  expect(f.deps.rebuild).toHaveBeenCalledTimes(1);
});
