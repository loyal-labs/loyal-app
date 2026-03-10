import { MMKV } from "react-native-mmkv";

// Lazy-initialized to avoid top-level native module access before JSI is ready
let _storage: MMKV | null = null;
function getStorage(): MMKV {
  if (!_storage) {
    _storage = new MMKV();
  }
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
