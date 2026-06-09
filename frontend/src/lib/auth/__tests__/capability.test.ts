import { describe, expect, test } from "bun:test";

import {
  resolveAuthCapability,
  resolveIsSignedIn,
} from "@/lib/auth/capability";

describe("auth capability", () => {
  test("treats wallet auth sessions as signed in even when disconnected", () => {
    expect(
      resolveAuthCapability({
        hasAuthSession: true,
        hasWalletConnection: false,
      })
    ).toBe("authSession");
  });

  test("separates wallet connections from auth sessions", () => {
    expect(
      resolveAuthCapability({
        hasAuthSession: false,
        hasWalletConnection: true,
      })
    ).toBe("walletConnected");
  });

  test("requires an auth session before treating the user as signed in", () => {
    expect(resolveIsSignedIn({ hasAuthSession: true })).toBe(true);
    expect(resolveIsSignedIn({ hasAuthSession: false })).toBe(false);
  });
});
