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
  WALLET_AUTH_SESSION_COOKIE_NAME: "loyal_wallet_session",
  createAuthSessionCookieService: () => ({
    createClearedSessionCookieOptions,
  }),
}));

const getServerEnv = mock(() => {
  throw new Error("logout must not require full server env");
});

mock.module("@/lib/core/config/server", () => ({
  getServerEnv,
}));

let POST: typeof import("../route").POST;

describe("auth logout route", () => {
  beforeAll(async () => {
    ({ POST } = await import("../route"));
  });

  beforeEach(() => {
    createClearedSessionCookieOptions.mockClear();
    getServerEnv.mockClear();
  });

  test("clears the auth session cookie", async () => {
    const response = await POST(
      new Request("https://app.askloyal.com/api/auth/logout", {
        method: "POST",
      })
    );

    expect(response.status).toBe(204);
    expect(createClearedSessionCookieOptions).toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
