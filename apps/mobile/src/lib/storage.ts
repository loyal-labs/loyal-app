// Persistent key-value storage backed by react-native-mmkv (sync, fast).
// Falls back to an in-memory Map when the native module isn't available
// (e.g. during Jest tests or web bundle evaluation), so callers never
// have to branch on environment.

import { MMKV } from "react-native-mmkv";

interface StorageAdapter {
  getString(key: string): string | undefined;
  getNumber(key: string): number | undefined;
  getBoolean(key: string): boolean | undefined;
  set(key: string, value: boolean | number | string): void;
  delete(key: string): void;
  contains(key: string): boolean;
}

let _storage: StorageAdapter | null = null;

function createInMemoryStorage(): StorageAdapter {
  const map = new Map<string, boolean | number | string>();
  return {
    getString: (key) => {
      const v = map.get(key);
      return typeof v === "string" ? v : undefined;
    },
    getNumber: (key) => {
      const v = map.get(key);
      return typeof v === "number" ? v : undefined;
    },
    getBoolean: (key) => {
      const v = map.get(key);
      return typeof v === "boolean" ? v : undefined;
    },
    set: (key, value) => {
      map.set(key, value);
    },
    delete: (key) => {
      map.delete(key);
    },
    contains: (key) => map.has(key),
  };
}

function createMmkvStorage(): StorageAdapter | null {
  try {
    const instance = new MMKV({ id: "loyal-app-storage" });
    return {
      getString: (key) => instance.getString(key),
      getNumber: (key) => instance.getNumber(key),
      getBoolean: (key) => instance.getBoolean(key),
      set: (key, value) => instance.set(key, value),
      delete: (key) => instance.delete(key),
      contains: (key) => instance.contains(key),
    };
  } catch (error) {
    console.warn(
      "[storage] MMKV unavailable, falling back to in-memory storage.",
      error
    );
    return null;
  }
}

function getStorage(): StorageAdapter {
  if (_storage) return _storage;
  _storage = createMmkvStorage() ?? createInMemoryStorage();
  return _storage;
}

export const mmkv = {
  getString: (key: string): string | undefined => getStorage().getString(key),
  setString: (key: string, value: string): void => {
    getStorage().set(key, value);
  },
  getNumber: (key: string): number | undefined => getStorage().getNumber(key),
  setNumber: (key: string, value: number): void => {
    getStorage().set(key, value);
  },
  getBoolean: (key: string): boolean | undefined =>
    getStorage().getBoolean(key),
  setBoolean: (key: string, value: boolean): void => {
    getStorage().set(key, value);
  },
  delete: (key: string): void => {
    getStorage().delete(key);
  },
  contains: (key: string): boolean => getStorage().contains(key),
};
