import "server-only";

import postgres from "postgres";

import { normalizeEarningsTimezone } from "./earnings-calculator.server";
import {
  EarnEarningsUnavailableError,
  getEarnEarningsSourceRevision,
  loadEarnEarningsSnapshot,
  readEarnEarningsRangeSet,
  type EarnEarningsReadInput,
  type EarnEarningsSnapshotRecord,
} from "./earnings-read-service.server";
import {
  isServerVerifiedEarnEarningsPayload,
  type EarnEarningsRangeSetResponse,
} from "./earnings.shared";

const FRESH_MS = 5 * 60 * 1000;
type ScheduleRefresh = (task: () => Promise<void>) => void;
type Dependencies = {
  loadSnapshot: typeof loadEarnEarningsSnapshot;
  loadSourceRevision: typeof getEarnEarningsSourceRevision;
  rebuild: typeof readEarnEarningsRangeSet;
  now: () => Date;
  withLock: (key: string, task: () => Promise<void>) => Promise<boolean>;
};

// Transaction-scoped locks work through the pooler and release on failure.
export async function withEarnEarningsRefreshLock(
  key: string,
  task: () => Promise<void>
): Promise<boolean> {
  const databaseUrl = process.env.NEON_DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing NEON_DATABASE_URL");
  const connection = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  try {
    return await connection.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = 10000`;
      const [row] =
        await tx`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`;
      if (!row.acquired) return false;
      await task();
      return true;
    });
  } finally {
    await connection.end();
  }
}

const dependencies: Dependencies = {
  loadSnapshot: loadEarnEarningsSnapshot,
  loadSourceRevision: getEarnEarningsSourceRevision,
  rebuild: readEarnEarningsRangeSet,
  now: () => new Date(),
  withLock: withEarnEarningsRefreshLock,
};

function isFresh(
  snapshot: EarnEarningsSnapshotRecord,
  sourceRevision: string,
  now: Date,
  timezone: string
) {
  const age = now.getTime() - snapshot.generatedAt.getTime();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  return (
    snapshot.payload.freshness === "fresh" &&
    snapshot.sourceRevision === sourceRevision &&
    age >= 0 &&
    age < FRESH_MS &&
    day.format(snapshot.generatedAt) === day.format(now)
  );
}

export async function readCachedEarnEarningsRangeSet(
  input: EarnEarningsReadInput,
  schedule: ScheduleRefresh,
  deps: Dependencies = dependencies
): Promise<EarnEarningsRangeSetResponse> {
  const timezone = normalizeEarningsTimezone(input.timezone);
  const scope = { ...input, timezone };
  const key = JSON.stringify([
    "earn-earnings-refresh",
    input.cluster,
    input.walletAddress,
    input.settings,
    input.vaultIndex,
    timezone,
  ]);
  const snapshot = await deps.loadSnapshot(scope, timezone);
  const usable =
    snapshot && isServerVerifiedEarnEarningsPayload(snapshot.payload);
  const revision = await deps.loadSourceRevision(scope);
  if (usable && isFresh(snapshot, revision, deps.now(), timezone)) {
    return snapshot.payload;
  }

  const refresh = async () => {
    let result: EarnEarningsRangeSetResponse | undefined;
    await deps.withLock(key, async () => {
      // Another instance may have finished between the read and lock acquisition.
      const latest = await deps.loadSnapshot(scope, timezone);
      const latestRevision = await deps.loadSourceRevision(scope);
      if (
        latest &&
        isServerVerifiedEarnEarningsPayload(latest.payload) &&
        isFresh(latest, latestRevision, deps.now(), timezone)
      ) {
        result = latest.payload;
      } else {
        result = await deps.rebuild(scope);
      }
    });
    return result;
  };

  if (!usable) {
    const result = await refresh();
    if (result) return result;
    throw new EarnEarningsUnavailableError(
      "earnings_unavailable",
      "Earnings history refresh is in progress."
    );
  }

  schedule(async () => {
    try {
      await refresh();
    } catch (error) {
      console.error("[earnings-cache] refresh failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
  });
  return {
    ...snapshot.payload,
    freshness: "stale",
    snapshotAgeMs: Math.max(
      0,
      deps.now().getTime() - snapshot.generatedAt.getTime()
    ),
    staleReason:
      snapshot.sourceRevision === revision
        ? "cache_expired"
        : "history_changed",
  };
}
