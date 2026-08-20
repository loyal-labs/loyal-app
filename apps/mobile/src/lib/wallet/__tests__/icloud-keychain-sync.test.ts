/**
 * iCloud Keychain mirror (ASK-2162) — storage-boundary contract tests.
 *
 * Protects: the synced keychain only ever holds a copy when the user opted
 * in, reset always removes cloud copies, and a wallet restored from the
 * synced keychain unlocks with the original PIN (full encrypt/decrypt
 * round-trip through the real crypto).
 */
/* eslint-disable import/first -- the stores must exist before the jest.mock
   factories run, which happens when the mocked modules are first imported */
import { Keypair } from "@solana/web3.js";

const localStore = new Map<string, string>();
const syncedStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
  setItemAsync: jest.fn(async (k: string, v: string) => {
    localStore.set(k, v);
  }),
  getItemAsync: jest.fn(async (k: string) => localStore.get(k) ?? null),
  deleteItemAsync: jest.fn(async (k: string) => {
    localStore.delete(k);
  }),
}));

jest.mock("expo-synced-keychain", () => ({
  isAvailable: jest.fn(() => true),
  setItem: jest.fn(async (k: string, v: string) => {
    syncedStore.set(k, v);
  }),
  getItem: jest.fn(async (k: string) => syncedStore.get(k) ?? null),
  deleteItem: jest.fn(async (k: string) => {
    syncedStore.delete(k);
  }),
}));

import { mmkv } from "@/lib/storage";

import {
  clearStoredKeypair,
  getStoredPublicKey,
  hasStoredKeypair,
  isICloudSyncEnabled,
  loadKeypair,
  restoreFromSyncedKeychain,
  setICloudSyncEnabled,
  storeKeypair,
} from "../keypair-storage";

const PIN = "4821";
const keypair = Keypair.fromSeed(new Uint8Array(32).fill(7));

beforeEach(async () => {
  localStore.clear();
  syncedStore.clear();
  await setICloudSyncEnabled(false);
});

test("iCloud backup is ON by default: a fresh install mirrors a new wallet with no toggle touched", async () => {
  mmkv.delete("settings.icloudKeychainSync"); // brand-new install: flag unset
  await storeKeypair(keypair, PIN);
  expect(syncedStore.get("wallet_public_key")).toBe(
    keypair.publicKey.toBase58(),
  );
  expect(syncedStore.get("wallet_encrypted_keypair")).toBeTruthy();
});

test("storeKeypair does not touch the synced keychain when sync is off", async () => {
  await storeKeypair(keypair, PIN);
  expect(localStore.size).toBeGreaterThan(0);
  expect(syncedStore.size).toBe(0);
});

test("enabling sync mirrors an existing wallet; disabling removes the copies", async () => {
  await storeKeypair(keypair, PIN);
  await setICloudSyncEnabled(true);
  expect(syncedStore.get("wallet_public_key")).toBe(
    keypair.publicKey.toBase58(),
  );
  expect(syncedStore.get("wallet_encrypted_keypair")).toBeTruthy();

  await setICloudSyncEnabled(false);
  expect(syncedStore.size).toBe(0);
  // Local wallet must survive the toggle.
  expect(await hasStoredKeypair()).toBe(true);
});

test("storeKeypair mirrors when sync is on (PIN change keeps the copy fresh)", async () => {
  await setICloudSyncEnabled(true);
  await storeKeypair(keypair, PIN);
  expect(syncedStore.get("wallet_encrypted_keypair")).toBe(
    localStore.get("wallet_encrypted_keypair"),
  );
});

test("clearStoredKeypair removes the synced copies even when sync is on", async () => {
  await setICloudSyncEnabled(true);
  await storeKeypair(keypair, PIN);
  await clearStoredKeypair();
  expect(localStore.has("wallet_encrypted_keypair")).toBe(false);
  expect(syncedStore.size).toBe(0);
});

test("restore round-trip: synced blob adopts locally and unlocks with the original PIN", async () => {
  // Device A: wallet exists and syncs.
  await setICloudSyncEnabled(true);
  await storeKeypair(keypair, PIN);

  // Device B: fresh install — local empty, flag never set, synced keychain
  // carried over by iCloud. (Not setICloudSyncEnabled(false) — that is the
  // explicit opt-out and deletes the cloud copies by design.)
  localStore.clear();
  mmkv.delete("settings.icloudKeychainSync");
  expect(await hasStoredKeypair()).toBe(false);

  const restored = await restoreFromSyncedKeychain();
  expect(restored).toBe(true);
  expect(isICloudSyncEnabled()).toBe(true); // stays mirrored on the new device
  expect(await getStoredPublicKey()).toBe(keypair.publicKey.toBase58());

  const unlocked = await loadKeypair(PIN);
  expect(unlocked?.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
});

test("restore returns false when nothing is synced", async () => {
  expect(await restoreFromSyncedKeychain()).toBe(false);
  expect(await hasStoredKeypair()).toBe(false);
});
