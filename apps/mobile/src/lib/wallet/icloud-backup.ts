// Explicit iCloud Drive wallet backup (ASK-2163). Writes the already
// PIN-encrypted keypair blob into the app's hidden iCloud container
// (CloudStorageScope.AppData — no folder appears in the Files app), and
// restores it on a fresh install. Accepted risk per the Linear issue: the
// backup keeps the existing PIN-based encryption, no extra password.
//
// react-native-cloud-storage is a TurboModule; it is loaded lazily so OTA
// bundles running on binaries without it (and Jest) degrade to
// "unsupported" instead of throwing at import time.
import {
  adoptEncryptedKeypair,
  getStoredBackupPayload,
  isICloudSyncEnabled,
  setICloudSyncEnabled,
} from "./keypair-storage";

const BACKUP_PATH = "/loyal-wallet-backup.json";
const READ_RETRIES = 3;
const READ_RETRY_DELAY_MS = 800;

export type WalletBackupEnvelope = {
  v: 1;
  createdAt: string;
  publicKey: string;
  ciphertext: string;
};

type CloudLib = typeof import("react-native-cloud-storage");

let cachedLib: CloudLib | null | undefined;

function getCloud(): CloudLib | null {
  if (cachedLib !== undefined) return cachedLib;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as typeof import("react-native");
    if (Platform.OS !== "ios") {
      cachedLib = null;
      return cachedLib;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedLib = require("react-native-cloud-storage") as CloudLib;
  } catch {
    cachedLib = null;
  }
  return cachedLib;
}

/** True when this binary can talk to iCloud Drive (iOS builds >= this one). */
export function isCloudBackupSupported(): boolean {
  return getCloud() != null;
}

/**
 * Validates a raw backup file. The file crosses a trust boundary (any app of
 * the same team could write into the container, and iCloud may hand back a
 * truncated file), so nothing is assumed about its shape.
 */
export function parseBackupEnvelope(raw: string): WalletBackupEnvelope | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    if (d.v !== 1) return null;
    if (typeof d.publicKey !== "string" || d.publicKey.length === 0) {
      return null;
    }
    if (typeof d.ciphertext !== "string" || d.ciphertext.length === 0) {
      return null;
    }
    return {
      v: 1,
      createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
      publicKey: d.publicKey,
      ciphertext: d.ciphertext,
    };
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Look for a backup in the iCloud container. An iCloud file can exist
 * remotely without being downloaded yet, so reads are retried after
 * triggering a sync.
 */
export async function findCloudBackup(): Promise<WalletBackupEnvelope | null> {
  const cloud = getCloud();
  if (!cloud) return null;
  try {
    const { CloudStorage, CloudStorageScope } = cloud;
    if (!(await CloudStorage.isCloudAvailable())) return null;
    if (!(await CloudStorage.exists(BACKUP_PATH, CloudStorageScope.AppData))) {
      return null;
    }
    for (let attempt = 0; attempt < READ_RETRIES; attempt++) {
      try {
        const raw = await CloudStorage.readFile(
          BACKUP_PATH,
          CloudStorageScope.AppData,
        );
        return parseBackupEnvelope(raw);
      } catch {
        // Likely not downloaded yet — ask iCloud for it and retry.
        await CloudStorage.triggerSync(
          BACKUP_PATH,
          CloudStorageScope.AppData,
        ).catch(() => {});
        await delay(READ_RETRY_DELAY_MS);
      }
    }
    return null;
  } catch (error) {
    console.warn("[wallet] iCloud backup lookup failed", error);
    return null;
  }
}

/**
 * Write the current wallet (already encrypted) into the iCloud container.
 * Throws when there is no wallet or iCloud is unavailable, so the caller can
 * show a real error instead of a false success.
 */
export async function writeCloudBackup(): Promise<WalletBackupEnvelope> {
  const cloud = getCloud();
  if (!cloud) throw new Error("iCloud backup is not supported on this build");
  const payload = await getStoredBackupPayload();
  if (!payload) throw new Error("No wallet to back up");
  const { CloudStorage, CloudStorageScope } = cloud;
  if (!(await CloudStorage.isCloudAvailable())) {
    throw new Error("iCloud is not available. Check that you are signed in.");
  }
  const envelope: WalletBackupEnvelope = {
    v: 1,
    createdAt: new Date().toISOString(),
    publicKey: payload.publicKey,
    ciphertext: payload.encrypted,
  };
  await CloudStorage.writeFile(
    BACKUP_PATH,
    JSON.stringify(envelope),
    CloudStorageScope.AppData,
  );
  return envelope;
}

/**
 * The single user-facing "iCloud Backup" switch. Drives BOTH backends:
 * the iCloud Keychain mirror (continuous, restores automatically on a new
 * device) and the Drive file (explicit "Restore from iCloud" fallback for
 * users who keep iCloud Keychain disabled). Off deletes both copies.
 */
export async function setICloudBackupEnabled(enabled: boolean): Promise<void> {
  await setICloudSyncEnabled(enabled);
  if (enabled) {
    // Best-effort: the keychain mirror is the primary backend; a Drive
    // failure (no iCloud Drive, offline) must not fail the toggle.
    try {
      await writeCloudBackup();
    } catch (error) {
      console.warn("[wallet] iCloud Drive backup failed", error);
    }
  } else {
    await deleteCloudBackup();
  }
}

export function isICloudBackupEnabled(): boolean {
  return isICloudSyncEnabled();
}

/**
 * Keep the Drive file in step with wallet changes (create/import/PIN change)
 * while the switch is on. Fire-and-forget from the wallet provider.
 */
export async function refreshCloudBackupIfEnabled(): Promise<void> {
  if (!isICloudSyncEnabled()) return;
  if (!isCloudBackupSupported()) return;
  try {
    await writeCloudBackup();
  } catch (error) {
    console.warn("[wallet] iCloud Drive backup refresh failed", error);
  }
}

/** Adopt a found backup locally; the user unlocks with the original PIN. */
export async function restoreCloudBackup(
  envelope: WalletBackupEnvelope,
): Promise<void> {
  await adoptEncryptedKeypair(envelope.ciphertext, envelope.publicKey);
}

export async function deleteCloudBackup(): Promise<void> {
  const cloud = getCloud();
  if (!cloud) return;
  try {
    const { CloudStorage, CloudStorageScope } = cloud;
    if (await CloudStorage.exists(BACKUP_PATH, CloudStorageScope.AppData)) {
      await CloudStorage.unlink(BACKUP_PATH, CloudStorageScope.AppData);
    }
  } catch (error) {
    console.warn("[wallet] iCloud backup deletion failed", error);
  }
}

