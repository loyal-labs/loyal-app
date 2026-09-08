import { Buffer } from "buffer";

import { acceptEarnInvalidation, earnCursorKey } from "../stream";
import { emitEarnRealtimeEvent, subscribeEarnRealtime } from "../events";

jest.mock("@/config/env", () => ({
  env: { earnApiBaseUrl: "https://api.test", solanaEnv: "devnet" },
}));

test("failed or superseded resource refresh never acknowledges; replay succeeds only after all resources accept", async () => {
  const acknowledge = jest.fn();
  const unsubscribe = subscribeEarnRealtime(async () => {
    throw new Error("superseded");
  });
  await expect(
    acceptEarnInvalidation({
      isCurrent: () => true,
      refresh: () => emitEarnRealtimeEvent(),
      acknowledge,
    })
  ).rejects.toThrow("superseded");
  expect(acknowledge).not.toHaveBeenCalled();
  unsubscribe();
  let current = true;
  await acceptEarnInvalidation({
    isCurrent: () => current,
    refresh: async () => {
      current = false;
    },
    acknowledge,
  });
  expect(acknowledge).not.toHaveBeenCalled();
  await acceptEarnInvalidation({
    isCurrent: () => true,
    refresh: () => emitEarnRealtimeEvent(),
    acknowledge,
  });
  expect(acknowledge).toHaveBeenCalledTimes(1);
});

test("cursor replay is isolated by wallet/settings/vault/cluster token scope", () => {
  const token = (overrides = {}) => ({
    accessToken: `${Buffer.from(
      JSON.stringify({
        v: 1,
        iss: "loyal-apps",
        aud: "loyal-yield-realtime",
        walletAddress: "wallet",
        settingsPda: "settings",
        earnVaultAddress: "vault",
        solanaEnv: "devnet",
        ...overrides,
      })
    ).toString("base64url")}.signature`,
    eventsUrl: "https://stream.test",
    expiresAt: "2026-10-01",
    schemaVersion: 1 as const,
  });
  const key = earnCursorKey(token(), "wallet");
  expect(
    earnCursorKey(token({ settingsPda: "replacement" }), "wallet")
  ).not.toBe(key);
  expect(
    earnCursorKey(token({ earnVaultAddress: "replacement" }), "wallet")
  ).not.toBe(key);
  expect(() => earnCursorKey(token(), "another-wallet")).toThrow();
  expect(() =>
    earnCursorKey(token({ solanaEnv: "mainnet-beta" }), "wallet")
  ).toThrow();
});
