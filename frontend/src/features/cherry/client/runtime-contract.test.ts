import { describe, expect, test } from "bun:test";

import {
  createCherryOperationLease,
  invalidateCherryOperationsForLifecycleEvent,
  isVerifiedCherryAuthSessionMatch,
  isVerifiedCherryWalletMatch,
  parseVerifiedCherryLaunchResponse,
  reduceCherryLifecycle,
  resolveCherryMobileEntry,
  runCherryDisconnectActions,
} from "./runtime-contract";

describe("Cherry mobile runtime contract", () => {
  test("activates only the dedicated route with both strict host signals", () => {
    expect(
      resolveCherryMobileEntry({
        pathname: "/app/cherry",
        hasCherryMarker: true,
        hasNativePostMessage: true,
      })
    ).toBe("cherry_mobile");

    for (const candidate of [
      {
        pathname: "/app/cherry",
        hasCherryMarker: false,
        hasNativePostMessage: true,
      },
      {
        pathname: "/app/cherry",
        hasCherryMarker: true,
        hasNativePostMessage: false,
      },
      {
        pathname: "/app/cherry",
        hasCherryMarker: false,
        hasNativePostMessage: false,
      },
    ]) {
      expect(resolveCherryMobileEntry(candidate)).toBe(
        "unsupported_cherry_entry"
      );
    }

    expect(
      resolveCherryMobileEntry({
        pathname: "/app",
        hasCherryMarker: true,
        hasNativePostMessage: true,
      })
    ).toBe("standalone");
    expect(
      resolveCherryMobileEntry({
        pathname: "/app/cherry/activity",
        hasCherryMarker: true,
        hasNativePostMessage: true,
      })
    ).toBe("standalone");
    expect(
      resolveCherryMobileEntry({
        pathname: "/app/cherry-picker",
        hasCherryMarker: true,
        hasNativePostMessage: true,
      })
    ).toBe("standalone");
  });

  test("accepts only the minimal launch response and exact wallet equality", () => {
    const response = {
      walletAddress: "wallet",
      roomId: "room",
      issuedAt: 10,
      expiresAt: 20,
    };

    expect(parseVerifiedCherryLaunchResponse(response)).toEqual(response);
    expect(
      parseVerifiedCherryLaunchResponse({ ...response, tokenId: "secret" })
    ).toEqual(response);
    expect(
      parseVerifiedCherryLaunchResponse({ ...response, expiresAt: 10 })
    ).toBeNull();
    expect(isVerifiedCherryWalletMatch("wallet", "wallet")).toBe(true);
    expect(isVerifiedCherryWalletMatch("wallet", "other")).toBe(false);
    expect(isVerifiedCherryWalletMatch("wallet", null)).toBe(false);
    expect(isVerifiedCherryAuthSessionMatch("wallet", "wallet")).toBe(true);
    expect(isVerifiedCherryAuthSessionMatch("wallet", "other")).toBe(false);
    expect(isVerifiedCherryAuthSessionMatch("wallet", null)).toBe(false);
  });

  test("unmounts while suspended and never revives a disconnected wallet", () => {
    const operationLease = createCherryOperationLease();
    const activeOperation = operationLease.capture();
    invalidateCherryOperationsForLifecycleEvent(operationLease, "suspended");
    const suspended = reduceCherryLifecycle("active", "suspended");
    expect(suspended).toBe("suspended");
    expect(operationLease.isCurrent(activeOperation)).toBe(false);
    expect(reduceCherryLifecycle(suspended, "resumed")).toBe("active");

    const resumedOperation = operationLease.capture();
    invalidateCherryOperationsForLifecycleEvent(
      operationLease,
      "walletDisconnected"
    );
    const disconnected = reduceCherryLifecycle("active", "walletDisconnected");
    expect(disconnected).toBe("disconnected");
    expect(operationLease.isCurrent(resumedOperation)).toBe(false);
    expect(reduceCherryLifecycle(disconnected, "resumed")).toBe("disconnected");
  });

  test("blocks synchronously then logs out and tears down without awaiting either", async () => {
    const calls: string[] = [];

    runCherryDisconnectActions({
      block: () => calls.push("block"),
      logout: async () => {
        calls.push("logout");
        throw new Error("best effort");
      },
      destroy: () => calls.push("destroy"),
    });

    expect(calls).toEqual(["block", "logout"]);
    await Promise.resolve();
    expect(calls).toEqual(["block", "logout", "destroy"]);
  });
});
