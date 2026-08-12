import { describe, expect, test } from "bun:test";

import {
  earnRealtimeCursorStorageKey,
  SafeEarnRealtimeCursorStore,
  type EarnRealtimeCursorStorage,
} from "./cursor-storage";

function throwingStorage(): EarnRealtimeCursorStorage {
  return {
    getItem() {
      throw new DOMException("blocked", "SecurityError");
    },
    removeItem() {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem() {
      throw new DOMException("blocked", "SecurityError");
    },
  };
}

describe("Earn realtime cursor storage", () => {
  test("keeps an identity-scoped memory cursor when browser storage throws", () => {
    const memory = new Map<string, string>();
    const firstKey = earnRealtimeCursorStorageKey({
      earnVaultAddress: "vault-a",
      settingsPda: "settings-a",
      solanaEnv: "devnet",
      walletAddress: "wallet-a",
    });
    const secondKey = earnRealtimeCursorStorageKey({
      earnVaultAddress: "vault-b",
      settingsPda: "settings-b",
      solanaEnv: "devnet",
      walletAddress: "wallet-b",
    });
    const first = new SafeEarnRealtimeCursorStore(
      firstKey,
      throwingStorage(),
      memory
    );
    const second = new SafeEarnRealtimeCursorStore(
      secondKey,
      throwingStorage(),
      memory
    );

    expect(first.get()).toBeNull();
    first.acknowledge("11");
    first.acknowledge("10");

    expect(first.get()).toBe("11");
    expect(second.get()).toBeNull();

    first.clear();
    expect(first.get()).toBeNull();
  });

  test("does not resurrect a readable cursor when removal is denied", () => {
    let stored = "41";
    const storage: EarnRealtimeCursorStorage = {
      getItem: () => stored,
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: (_key, value) => {
        stored = value;
      },
    };
    const memory = new Map<string, string>();
    const cursor = new SafeEarnRealtimeCursorStore(
      "partial-storage",
      storage,
      memory
    );

    expect(cursor.get()).toBe("41");
    cursor.clear();
    const remounted = new SafeEarnRealtimeCursorStore(
      "partial-storage",
      storage,
      memory
    );
    expect(remounted.get()).toBeNull();
    remounted.acknowledge("42");
    const acknowledgedRemount = new SafeEarnRealtimeCursorStore(
      "partial-storage",
      storage,
      memory
    );
    expect(acknowledgedRemount.get()).toBe("42");
  });
});
