import { Keypair } from "@solana/web3.js";
import * as SecureStore from "expo-secure-store";

import { decryptSecret, encryptSecret } from "./crypto";

const ENCRYPTED_KEYPAIR_KEY = "wallet_encrypted_keypair";
const WALLET_PUBLIC_KEY = "wallet_public_key";
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

async function storeKeypair(
  keypair: Keypair,
  password: string,
): Promise<void> {
  const serialized = JSON.stringify(Array.from(keypair.secretKey));
  const encrypted = await encryptSecret(serialized, password);
  await SecureStore.setItemAsync(ENCRYPTED_KEYPAIR_KEY, encrypted);
  await SecureStore.setItemAsync(
    WALLET_PUBLIC_KEY,
    keypair.publicKey.toBase58(),
  );
}

export async function generateKeypair(password: string): Promise<Keypair> {
  const keypair = Keypair.generate();
  await storeKeypair(keypair, password);
  return keypair;
}

export async function importKeypair(
  secretKey: Uint8Array,
  password: string,
): Promise<Keypair> {
  const keypair = Keypair.fromSecretKey(secretKey);
  await storeKeypair(keypair, password);
  return keypair;
}

export async function loadKeypair(password: string): Promise<Keypair | null> {
  const remaining = await getLockoutRemaining();
  if (remaining > 0) throw new PinLockedError(remaining);

  const encrypted = await SecureStore.getItemAsync(ENCRYPTED_KEYPAIR_KEY);
  if (!encrypted) return null;

  const decrypted = await decryptSecret(encrypted, password);
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

export async function clearStoredKeypair(): Promise<void> {
  await SecureStore.deleteItemAsync(ENCRYPTED_KEYPAIR_KEY);
  await SecureStore.deleteItemAsync(WALLET_PUBLIC_KEY);
  await resetAttempts();
}

export async function changePassword(
  keypair: Keypair,
  newPassword: string,
): Promise<void> {
  await storeKeypair(keypair, newPassword);
}
