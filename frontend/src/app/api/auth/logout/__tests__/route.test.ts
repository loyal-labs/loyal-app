import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const createClearedSessionCookieOptions = mock(() => ({
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: true,
  path: "/" as const,
  maxAge: 0,
}));

mock.module("@/features/identity/server/session-cookie", () => ({
  createAuthSessionCookieService: () => ({
    createClearedSessionCookieOptions,
  }),
}));

let POST: typeof import("../route").POST;

describe("auth logout route", () => {
  beforeAll(async () => {
    ({ POST } = await import("../route"));
  });

  beforeEach(() => {
    process.env.PHALA_API_KEY = "test-key";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    createClearedSessionCookieOptions.mockClear();
  });

  test("clears the auth session cookie", async () => {
    const response = await POST(
      new Request("https://app.askloyal.com/api/auth/logout", {
        method: "POST",
      })
    );

    expect(response.status).toBe(204);
    expect(createClearedSessionCookieOptions).toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
