import { describe, expect, test } from "bun:test";

import {
  AUTH_SESSION_RECHECK_THROTTLE_MS,
  shouldRecheckAuthSession,
} from "@/contexts/auth-session-refresh";

describe("auth session refresh throttle", () => {
  test("rechecks when there has never been a previous session check", () => {
    expect(shouldRecheckAuthSession(null, Date.now())).toBe(true);
  });

  test("does not recheck within the throttle window", () => {
    const now = Date.now();

    expect(
      shouldRecheckAuthSession(
        now - AUTH_SESSION_RECHECK_THROTTLE_MS + 1_000,
        now
      )
    ).toBe(false);
  });

  test("rechecks once the throttle window has elapsed", () => {
    const now = Date.now();

    expect(
      shouldRecheckAuthSession(
        now - AUTH_SESSION_RECHECK_THROTTLE_MS,
        now
      )
    ).toBe(true);
  });
});
