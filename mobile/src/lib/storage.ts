// Persistent key-value storage with graceful fallback.
// react-native-mmkv v4 (Nitro Modules) can hang during import on some
// Expo/RN configurations, so we use dynamic require() to avoid blocking
// the entire module graph.

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

function getStorage(): StorageAdapter {
  if (_storage) return _storage;

  // In-memory only for now. MMKV v4 (Nitro Modules) has compatibility
  // issues with this Expo/RN setup. Replace with AsyncStorage or
  // downgrade MMKV to v2 if persistence is needed before a fix lands.
  console.warn(
    "[storage] Using in-memory storage. Data won't persist across restarts.",
  );
  _storage = createInMemoryStorage();
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
