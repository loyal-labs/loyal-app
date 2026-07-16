import "server-only";

import { createHash } from "node:crypto";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 20;
const MAX_TRACKED_SOURCES = 1024;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const reportRates = new Map<string, RateLimitEntry>();

function getRequestSource(request: Request): string {
  const forwardedFor = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const source =
    forwardedFor ||
    request.headers.get("x-vercel-forwarded-for")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";

  return createHash("sha256").update(source.slice(0, 128)).digest("hex");
}

export function consumeBrowserErrorRateLimit(
  request: Request,
  now = Date.now()
): boolean {
  for (const [source, entry] of reportRates) {
    if (entry.resetAt <= now) {
      reportRates.delete(source);
    }
  }

  const source = getRequestSource(request);
  const current = reportRates.get(source);
  if (current && current.resetAt > now) {
    if (current.count >= MAX_REPORTS_PER_WINDOW) {
      return false;
    }
    current.count += 1;
    return true;
  }

  if (reportRates.size >= MAX_TRACKED_SOURCES) {
    const oldestSource = reportRates.keys().next().value;
    if (typeof oldestSource === "string") {
      reportRates.delete(oldestSource);
    }
  }

  reportRates.set(source, {
    count: 1,
    resetAt: now + RATE_LIMIT_WINDOW_MS,
  });
  return true;
}
