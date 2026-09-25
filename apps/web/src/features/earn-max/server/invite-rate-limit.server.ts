import "server-only";

// ponytail: in-memory per-instance window; a distributed limiter is only
// worth it if guessing ever shows up (36^6 codes, 50 valid).
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_TRACKED = 4096;

const attempts = new Map<string, { count: number; resetAt: number }>();

export function consumeInviteAttempt(key: string, now = Date.now()): boolean {
  const current = attempts.get(key);
  if (current && current.resetAt > now) {
    if (current.count >= MAX_ATTEMPTS) return false;
    current.count += 1;
    return true;
  }
  if (attempts.size >= MAX_TRACKED) {
    for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
    if (attempts.size >= MAX_TRACKED) attempts.delete(attempts.keys().next().value as string);
  }
  attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  return true;
}
