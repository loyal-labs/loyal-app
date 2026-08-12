import { describe, expect, test } from "bun:test";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";

import nextConfig from "./next.config";

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
});
