import { AsyncLocalStorage } from "node:async_hooks";

import { describe, expect, test } from "bun:test";

import nextConfig from "./next.config";

// Next's config test helper reads globalThis.AsyncLocalStorage, which Node sets
// through its server runtime but Bun does not — without this the whole file
// throws "AsyncLocalStorage accessed in runtime where it is not available"
// before any test runs. Assign it before the helper module is evaluated, hence
// the dynamic import below.
(
  globalThis as typeof globalThis & { AsyncLocalStorage?: unknown }
).AsyncLocalStorage ??= AsyncLocalStorage;

const { unstable_getResponseFromNextConfig } = await import(
  "next/experimental/testing/server"
);

describe("frame security headers", () => {
  test("allows only the Cherry entry to be framed by the Cherry web host", async () => {
    const response = await unstable_getResponseFromNextConfig({
      url: "https://askloyal.com/app/cherry?cherry_embed=1",
      nextConfig,
    });

    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self' https://chat.cherry.fun"
    );
    expect(response.headers.get("x-frame-options")).toBeNull();
  });

  test("retains SAMEORIGIN on every non-Cherry route", async () => {
    for (const pathname of [
      "/",
      "/app",
      "/app/cherry/activity",
      "/api/auth/session",
    ]) {
      const response = await unstable_getResponseFromNextConfig({
        url: `https://askloyal.com${pathname}`,
        nextConfig,
      });

      expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(response.headers.get("content-security-policy")).toBeNull();
    }
  });

  // Report-Only must never turn enforcing by accident: a bad allowlist would
  // silently break wallet/RPC calls in prod. Enforcement is a deliberate flip.
  test("ships the Privy CSP as report-only on app routes", async () => {
    const response = await unstable_getResponseFromNextConfig({
      url: "https://askloyal.com/app",
      nextConfig,
    });
    const csp = response.headers.get("content-security-policy-report-only");
    expect(csp).toContain("frame-src https://auth.privy.io");
    expect(csp).toContain("report-uri /api/csp-report");
  });
});

describe("earn banner asset caching", () => {
  test("serves versioned banner art as immutable", async () => {
    const response = await unstable_getResponseFromNextConfig({
      url: "https://askloyal.com/wallet-workspace/facelift/earn-banner-art-dog.svg?v=abc123",
      nextConfig,
    });

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  test("leaves unversioned requests on the default revalidate policy", async () => {
    for (const url of [
      "https://askloyal.com/wallet-workspace/facelift/earn-banner-art-dog.svg",
      "https://askloyal.com/wallet-workspace/facelift/earn-icon.svg?v=abc123",
    ]) {
      const response = await unstable_getResponseFromNextConfig({
        url,
        nextConfig,
      });

      expect(response.headers.get("cache-control")).toBeNull();
    }
  });
});
