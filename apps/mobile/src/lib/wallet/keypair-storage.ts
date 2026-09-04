import { Keypair } from "@solana/web3.js";
import * as SecureStore from "expo-secure-store";
import * as SyncedKeychain from "expo-synced-keychain";

import { mmkv } from "@/lib/storage";

import { decryptSecret, encryptSecret } from "./crypto";
import { isValidWalletPin } from "./pin";

// The encrypted keypair must never leave the device. expo-secure-store's iOS
// default (WHEN_UNLOCKED) is included in encrypted iTunes/Finder and iCloud
// backups, and the blob's only protection is a 4-digit PIN at PBKDF2-10k —
// trivially brute-forced offline once exported. THIS_DEVICE_ONLY excludes it
// from every backup. The option is ignored on Android, where the equivalent
// blob is already bound to the Keystore, so no platform branch is needed.
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const ENCRYPTED_KEYPAIR_KEY = "wallet_encrypted_keypair";
const WALLET_PUBLIC_KEY = "wallet_public_key";

// Opt-in mirror of the two items above into the iCloud Keychain (ASK-2162).
// The mirrored copy is the same PIN-encrypted blob — accepted risk, see the
// Linear issue: "we protect on our level, icloud is user's responsibility."
const ICLOUD_SYNC_ENABLED_KEY = "settings.icloudKeychainSync";
// Restored wallets skip onboarding's biometric-setup step (ASK-2205). Set on
// adopt, consumed by the wallet provider on the first successful PIN unlock.
const BIOMETRIC_RESTORE_PENDING_KEY = "wallet.biometricRestorePending";
const FAILED_ATTEMPTS_KEY = "wallet_failed_attempts";
const LOCKED_UNTIL_KEY = "wallet_locked_until";

const LOCKOUT_DURATIONS_MS = [
  30_000, // 4th failure  -> 30s
  60_000, // 5th failure  -> 1 min
  300_000, // 6th failure  -> 5 min
  900_000, // 7th failure  -> 15 min
  3_600_000, // 8th failure  -> 1 hour
  14_400_000, // 9th failure  -> 4 hours
  86_400_000, // 10th+ failure -> 24 hours
];

function getLockoutDuration(attempts: number): number {
  if (attempts < 4) return 0;
  const index = Math.min(attempts - 4, LOCKOUT_DURATIONS_MS.length - 1);
  return LOCKOUT_DURATIONS_MS[index];
}

export class PinLockedError extends Error {
  remainingMs: number;
  constructor(remainingMs: number) {
    super(`Wallet locked for ${Math.ceil(remainingMs / 1000)}s`);
    this.name = "PinLockedError";
    this.remainingMs = remainingMs;
  }
}

export async function getLockoutRemaining(): Promise<number> {
  const raw = await SecureStore.getItemAsync(LOCKED_UNTIL_KEY);
  if (!raw) return 0;
  return Math.max(0, Number(raw) - Date.now());
}

async function recordFailedAttempt(): Promise<void> {
  const raw = await SecureStore.getItemAsync(FAILED_ATTEMPTS_KEY);
  const attempts = (raw ? Number(raw) : 0) + 1;
  await SecureStore.setItemAsync(FAILED_ATTEMPTS_KEY, String(attempts));
  const duration = getLockoutDuration(attempts);
  if (duration > 0) {
    await SecureStore.setItemAsync(
      LOCKED_UNTIL_KEY,
      String(Date.now() + duration),
    );
  }
}

async function resetAttempts(): Promise<void> {
  await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
  await SecureStore.deleteItemAsync(LOCKED_UNTIL_KEY);
}

export async function storeKeypair(
  keypair: Keypair,
  pin: string,
): Promise<void> {
  if (!isValidWalletPin(pin)) {
    throw new Error("PIN must be 4 digits");
  }
  const serialized = JSON.stringify(Array.from(keypair.secretKey));
  const encrypted = await encryptSecret(serialized, pin);
  await SecureStore.setItemAsync(
    ENCRYPTED_KEYPAIR_KEY,
    encrypted,
    KEYCHAIN_OPTIONS,
  );
  await SecureStore.setItemAsync(
    WALLET_PUBLIC_KEY,
    keypair.publicKey.toBase58(),
    KEYCHAIN_OPTIONS,
  );
  if (isICloudSyncEnabled()) {
    // Best-effort: a failed mirror must not fail wallet creation/PIN change.
    try {
      await mirrorToSyncedKeychain(encrypted, keypair.publicKey.toBase58());
    } catch (error) {
      console.warn("[wallet] iCloud Keychain mirror failed", error);
    }
  }
}

/**
 * Whether the wallet is backed up to iCloud (keychain mirror + Drive file —
 * one user-facing switch drives both). ON by default per Vlad's 2026-08-20
 * decision, so new wallets are recoverable out of the box; the Settings
 * toggle opts out. Only consulted on iOS — both backends no-op elsewhere.
 */
export function isICloudSyncEnabled(): boolean {
  return mmkv.getBoolean(ICLOUD_SYNC_ENABLED_KEY) ?? true;
}

/** True when the running binary can talk to the synced keychain (iOS only). */
export function isICloudSyncSupported(): boolean {
  return SyncedKeychain.isAvailable();
}

async function mirrorToSyncedKeychain(
  encrypted: string,
  publicKey: string,
): Promise<void> {
  await SyncedKeychain.setItem(ENCRYPTED_KEYPAIR_KEY, encrypted);
  await SyncedKeychain.setItem(WALLET_PUBLIC_KEY, publicKey);
}

/**
 * Toggle the iCloud Keychain mirror. Enabling copies the current items up;
 * disabling removes the synced copies. The device-local items are untouched
 * either way.
 */
export async function setICloudSyncEnabled(enabled: boolean): Promise<void> {
  mmkv.setBoolean(ICLOUD_SYNC_ENABLED_KEY, enabled);
  if (!SyncedKeychain.isAvailable()) return;
  if (enabled) {
    const encrypted = await SecureStore.getItemAsync(ENCRYPTED_KEYPAIR_KEY);
    const publicKey = await SecureStore.getItemAsync(WALLET_PUBLIC_KEY);
    if (encrypted && publicKey) {
      await mirrorToSyncedKeychain(encrypted, publicKey);
    }
  } else {
    await SyncedKeychain.deleteItem(ENCRYPTED_KEYPAIR_KEY);
    await SyncedKeychain.deleteItem(WALLET_PUBLIC_KEY);
  }
}

/**
 * Write an already-encrypted keypair blob into local storage. Shared by the
 * restore paths (iCloud Keychain, iCloud Drive backup); the caller lands on
 * the normal locked state and the user unlocks with the original PIN.
 */
export async function adoptEncryptedKeypair(
  encrypted: string,
  publicKey: string,
): Promise<void> {
  await SecureStore.setItemAsync(
    ENCRYPTED_KEYPAIR_KEY,
    encrypted,
    KEYCHAIN_OPTIONS,
  );
  await SecureStore.setItemAsync(WALLET_PUBLIC_KEY, publicKey, KEYCHAIN_OPTIONS);
  await resetAttempts();
  mmkv.setBoolean(BIOMETRIC_RESTORE_PENDING_KEY, true);
}

/**
 * True exactly once after a restore adopted a keypair: the caller (wallet
 * provider) re-runs biometric setup on the first PIN unlock (ASK-2205).
 */
export function consumeBiometricRestorePending(): boolean {
  const pending = mmkv.getBoolean(BIOMETRIC_RESTORE_PENDING_KEY) ?? false;
  if (pending) mmkv.delete(BIOMETRIC_RESTORE_PENDING_KEY);
  return pending;
}

/**
 * On a fresh install, pull the wallet from the iCloud Keychain if the user
 * synced one from another device. Returns true when a wallet was adopted.
 */
export async function restoreFromSyncedKeychain(): Promise<boolean> {
  if (!SyncedKeychain.isAvailable()) return false;
  try {
    const encrypted = await SyncedKeychain.getItem(ENCRYPTED_KEYPAIR_KEY);
    const publicKey = await SyncedKeychain.getItem(WALLET_PUBLIC_KEY);
    if (!encrypted || !publicKey) return false;
    await adoptEncryptedKeypair(encrypted, publicKey);
    // A synced wallet exists, so keep mirroring PIN changes on this device.
    mmkv.setBoolean(ICLOUD_SYNC_ENABLED_KEY, true);
    return true;
  } catch (error) {
    console.warn("[wallet] iCloud Keychain restore failed", error);
    return false;
  }
}

/**
 * The stored (already encrypted) wallet payload, for explicit backups.
 * Returns null when no wallet exists.
 */
export async function getStoredBackupPayload(): Promise<{
  encrypted: string;
  publicKey: string;
} | null> {
  const encrypted = await SecureStore.getItemAsync(ENCRYPTED_KEYPAIR_KEY);
  const publicKey = await SecureStore.getItemAsync(WALLET_PUBLIC_KEY);
  if (!encrypted || !publicKey) return null;
  return { encrypted, publicKey };
}

export function generateKeypairInMemory(): Keypair {
  return Keypair.generate();
}

export async function importKeypair(
  secretKey: Uint8Array,
  pin: string,
): Promise<Keypair> {
  const keypair = Keypair.fromSecretKey(secretKey);
  await storeKeypair(keypair, pin);
  return keypair;
}

export async function loadKeypair(pin: string): Promise<Keypair | null> {
  const remaining = await getLockoutRemaining();
  if (remaining > 0) throw new PinLockedError(remaining);

  const encrypted = await SecureStore.getItemAsync(ENCRYPTED_KEYPAIR_KEY);
  if (!encrypted) return null;

  const decrypted = await decryptSecret(encrypted, pin);
  if (!decrypted) {
    await recordFailedAttempt();
    return null;
  }

  await resetAttempts();
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(decrypted)));
}

export async function hasStoredKeypair(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ENCRYPTED_KEYPAIR_KEY)) !== null;
}

export async function getStoredPublicKey(): Promise<string | null> {
  return SecureStore.getItemAsync(WALLET_PUBLIC_KEY);
}

export async function clearStoredKeypair(opts?: {
  /**
   * "Remove from this device" (ASK-2206): wipe only local key material and
   * leave the iCloud Keychain mirror in place so another install can restore.
   */
  keepSyncedKeychain?: boolean;
}): Promise<void> {
  await SecureStore.deleteItemAsync(ENCRYPTED_KEYPAIR_KEY);
  await SecureStore.deleteItemAsync(WALLET_PUBLIC_KEY);
  if (!opts?.keepSyncedKeychain) {
    // "Delete everywhere": a full reset must not leave key material in
    // iCloud regardless of the toggle state at the time.
    try {
      await SyncedKeychain.deleteItem(ENCRYPTED_KEYPAIR_KEY);
      await SyncedKeychain.deleteItem(WALLET_PUBLIC_KEY);
    } catch (error) {
      console.warn("[wallet] iCloud Keychain cleanup failed", error);
    }
  }
  mmkv.delete(BIOMETRIC_RESTORE_PENDING_KEY);
  await resetAttempts();
}

export async function changePin(
  keypair: Keypair,
  newPin: string,
): Promise<void> {
  await storeKeypair(keypair, newPin);
}
