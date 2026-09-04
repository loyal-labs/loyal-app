// iCloud Keychain-synced key-value storage. iOS only; every function is a
// safe no-op elsewhere.
//
// The native lookup is lazy and swallows load failures for two reasons:
// a JS bundle delivered via OTA to a binary that predates this module must
// degrade to "unavailable" instead of throwing at import time, and Jest's
// node environment cannot load expo-modules-core/react-native at all —
// importers of this module must not take test suites down with them.

type NativeSyncedKeychain = {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  deleteItem(key: string): Promise<void>;
};

let cached: NativeSyncedKeychain | null | undefined;

function getNative(): NativeSyncedKeychain | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as typeof import("react-native");
    if (Platform.OS !== "ios") {
      cached = null;
      return cached;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } =
      require("expo-modules-core") as typeof import("expo-modules-core");
    cached =
      requireOptionalNativeModule<NativeSyncedKeychain>("ExpoSyncedKeychain");
  } catch {
    cached = null;
  }
  return cached;
}

/** True when the running binary contains the native module (iOS only). */
export function isAvailable(): boolean {
  return getNative() != null;
}

export async function setItem(key: string, value: string): Promise<void> {
  const native = getNative();
  if (!native) return;
  await native.setItem(key, value);
}

export async function getItem(key: string): Promise<string | null> {
  const native = getNative();
  if (!native) return null;
  return native.getItem(key);
}

export async function deleteItem(key: string): Promise<void> {
  const native = getNative();
  if (!native) return;
  await native.deleteItem(key);
}
