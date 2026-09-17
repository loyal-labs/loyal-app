/**
 * Single-flight observation cache.
 *
 * One in-flight promise is kept until it settles, even if its TTL expires
 * while it runs: a slower read is never started against the same key while a
 * read is outstanding. The TTL starts when a read completes, not when it
 * starts. A failed read is retried only after a bounded backoff, and a slow
 * call can never publish over a newer one.
 */

export type ObservationCache<T> = {
  read: () => Promise<T>;
};

type Entry<T> = {
  generation: number;
  startedAtMs: number;
  completedAtMs: number | null;
  promise: Promise<T>;
  value: T | null;
  superseded: boolean;
};

export function createObservationCache<T>(options: {
  load: () => Promise<T>;
  ttlMs: number;
  failureBackoffMs: number;
  /** Marks a settled result as a failure for backoff purposes. */
  isFailure: (value: T) => boolean;
}): ObservationCache<T> {
  const { load, ttlMs, failureBackoffMs, isFailure } = options;
  let entry: Entry<T> | null = null;
  let generation = 0;

  const read = (): Promise<T> => {
    const now = Date.now();
    if (entry) {
      // An outstanding read is reused until it settles, whatever its age.
      if (entry.completedAtMs === null) return entry.promise;
      // A good result is reused within its TTL; a failure only until backoff ends.
      const fresh = now - entry.completedAtMs < (isFailure(entry.value as T) ? failureBackoffMs : ttlMs);
      if (fresh && entry.value !== null) return entry.promise;
    }
    const mine = generation + 1;
    generation = mine;
    if (entry) entry.superseded = true;
    const promise = load()
      .then((value) => {
        // Only the newest read may publish; a slow older one is discarded.
        if (mine === generation) entry = { generation: mine, startedAtMs: now, completedAtMs: Date.now(), promise, value, superseded: false };
        return value;
      })
      .catch((error) => {
        // A rejected read is never cached as a value; the next read retries.
        if (mine === generation) entry = null;
        throw error;
      });
    entry = { generation: mine, startedAtMs: now, completedAtMs: null, promise, value: null, superseded: false };
    return promise;
  };

  return { read };
}
