import { describe, expect, test } from "bun:test";

import {
  readClientCache,
  removeClientCache,
  writeClientCache,
} from "./client-cache";

function createMemoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("client cache", () => {
  test("reads valid matching cache data", () => {
    const storage = createMemoryStorage();
    writeClientCache({
      data: { totalUsd: 12 },
      key: "wallet",
      now: 100,
      solanaEnv: "devnet",
      storage,
      version: 1,
      walletAddress: "wallet-1",
    });

    expect(
      readClientCache<{ totalUsd: number }>({
        key: "wallet",
        now: 101,
        solanaEnv: "devnet",
        storage,
        version: 1,
        walletAddress: "wallet-1",
      })?.totalUsd
    ).toBe(12);
  });

  test("rejects expired cache", () => {
    const storage = createMemoryStorage();
    writeClientCache({
      data: { totalUsd: 12 },
      key: "wallet",
      now: 100,
      solanaEnv: "devnet",
      storage,
      ttlMs: 10,
      version: 1,
      walletAddress: "wallet-1",
    });

    expect(
      readClientCache({
        key: "wallet",
        now: 111,
        solanaEnv: "devnet",
        storage,
        version: 1,
        walletAddress: "wallet-1",
      })
    ).toBeNull();
  });

  test("rejects wrong env wallet settings or version", () => {
    const storage = createMemoryStorage();
    writeClientCache({
      data: { totalUsd: 12 },
      key: "wallet",
      now: 100,
      settingsPda: "settings-1",
      solanaEnv: "devnet",
      storage,
      version: 1,
      walletAddress: "wallet-1",
    });

    expect(
      readClientCache({
        key: "wallet",
        now: 101,
        settingsPda: "settings-1",
        solanaEnv: "mainnet",
        storage,
        version: 1,
        walletAddress: "wallet-1",
      })
    ).toBeNull();
    expect(
      readClientCache({
        key: "wallet",
        now: 101,
        settingsPda: "settings-1",
        solanaEnv: "devnet",
        storage,
        version: 1,
        walletAddress: "wallet-2",
      })
    ).toBeNull();
    expect(
      readClientCache({
        key: "wallet",
        now: 101,
        settingsPda: "settings-2",
        solanaEnv: "devnet",
        storage,
        version: 1,
        walletAddress: "wallet-1",
      })
    ).toBeNull();
    expect(
      readClientCache({
        key: "wallet",
        now: 101,
        settingsPda: "settings-1",
        solanaEnv: "devnet",
        storage,
        version: 2,
        walletAddress: "wallet-1",
      })
    ).toBeNull();
  });

  test("ignores malformed JSON and storage errors", () => {
    const storage = createMemoryStorage();
    storage.setItem("bad-json", "{");

    expect(
      readClientCache({
        key: "bad-json",
        solanaEnv: "devnet",
        storage,
        version: 1,
      })
    ).toBeNull();

    const throwingStorage = {
      getItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };

    expect(
      readClientCache({
        key: "wallet",
        solanaEnv: "devnet",
        storage: throwingStorage,
        version: 1,
      })
    ).toBeNull();
    expect(() =>
      writeClientCache({
        data: { totalUsd: 12 },
        key: "wallet",
        solanaEnv: "devnet",
        storage: throwingStorage,
        version: 1,
      })
    ).not.toThrow();
    expect(() =>
      removeClientCache({
        key: "wallet",
        storage: throwingStorage,
      })
    ).not.toThrow();
  });
});
