export const AUTH_SESSION_RECHECK_THROTTLE_MS = 60 * 60 * 1000;

export function shouldRecheckAuthSession(
  lastCheckedAt: number | null,
  now = Date.now()
): boolean {
  if (lastCheckedAt === null) {
    return true;
  }

  return now - lastCheckedAt >= AUTH_SESSION_RECHECK_THROTTLE_MS;
}
