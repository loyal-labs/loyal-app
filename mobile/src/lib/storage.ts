import { MMKV } from "react-native-mmkv";

// MMKV requires native JSI bindings from a custom dev client build.
// When running in Expo Go or a dev client without MMKV native module,
// fall back to in-memory Map so the app still works (without persistence).

interface StorageAdapter {
  getString(key: string): string | undefined;
  getNumber(key: string): number | undefined;
  getBoolean(key: string): boolean | undefined;
  set(key: string, value: boolean | number | string): void;
  delete(key: string): void;
  contains(key: string): boolean;
}

let _storage: StorageAdapter | null = null;
let _warned = false;

function getStorage(): StorageAdapter {
  if (_storage) return _storage;

  try {
    _storage = new MMKV();
    return _storage;
  } catch {
    if (!_warned) {
      _warned = true;
      console.warn(
        "[storage] MMKV native module unavailable — using in-memory fallback. " +
          "Build a dev client to enable persistent storage.",
      );
    }
    const map = new Map<string, boolean | number | string>();
    _storage = {
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
    return _storage;
  }
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
