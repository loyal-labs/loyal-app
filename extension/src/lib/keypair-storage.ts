import { storage } from "#imports";
import { Keypair } from "@solana/web3.js";
import { failedPinAttempts, pinLockedUntil } from "./storage";

// Store encrypted keypair in chrome.storage.local
const encryptedKeypair = storage.defineItem<string | null>("local:encryptedKeypair", {
  fallback: null,
});

const walletPublicKey = storage.defineItem<string | null>("local:walletPublicKey", {
  fallback: null,
});

// Lockout durations in ms, indexed by (failedAttempts - 4).
// Attempts 1–3 have no lockout. 4 → 30s, 5 → 1m, 6 → 5m, ...
const LOCKOUT_DURATIONS_MS = [
  30_000,      // 4th failure  → 30 s
  60_000,      // 5th failure  → 1 min
  300_000,     // 6th failure  → 5 min
  900_000,     // 7th failure  → 15 min
  3_600_000,   // 8th failure  → 1 hour
  14_400_000,  // 9th failure  → 4 hours
  86_400_000,  // 10th+ failure → 24 hours
];

function getLockoutDuration(attempts: number): number {
  if (attempts < 4) return 0;
  const index = Math.min(attempts - 4, LOCKOUT_DURATIONS_MS.length - 1);
  return LOCKOUT_DURATIONS_MS[index];
}

export async function getPinLockoutRemaining(): Promise<number> {
  const lockedUntil = await pinLockedUntil.getValue();
  if (lockedUntil === 0) return 0;
  return Math.max(0, lockedUntil - Date.now());
}

async function recordFailedAttempt(): Promise<void> {
  const attempts = (await failedPinAttempts.getValue()) + 1;
  await failedPinAttempts.setValue(attempts);
  const duration = getLockoutDuration(attempts);
  if (duration > 0) {
    await pinLockedUntil.setValue(Date.now() + duration);
  }
}

async function resetAttempts(): Promise<void> {
  await failedPinAttempts.setValue(0);
  await pinLockedUntil.setValue(0);
}

export async function generateKeypair(pin: string): Promise<Keypair> {
  const keypair = Keypair.generate();
  await storeKeypair(keypair, pin);
  return keypair;
}

export async function importKeypair(secretKey: Uint8Array, pin: string): Promise<Keypair> {
  const keypair = Keypair.fromSecretKey(secretKey);
  await storeKeypair(keypair, pin);
  return keypair;
}

export async function loadKeypair(pin: string): Promise<Keypair | null> {
  const remaining = await getPinLockoutRemaining();
  if (remaining > 0) {
    throw new PinLockedError(remaining);
  }

  const encrypted = await encryptedKeypair.getValue();
  if (!encrypted) return null;
  const decrypted = await decrypt(encrypted, pin);
  if (!decrypted) {
    await recordFailedAttempt();
    return null;
  }
  await resetAttempts();
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(decrypted)));
}

export class PinLockedError extends Error {
  remainingMs: number;
  constructor(remainingMs: number) {
    super(`PIN locked for ${Math.ceil(remainingMs / 1000)}s`);
    this.name = "PinLockedError";
    this.remainingMs = remainingMs;
  }
}

export async function hasStoredKeypair(): Promise<boolean> {
  return (await encryptedKeypair.getValue()) !== null;
}

export async function getStoredPublicKey(): Promise<string | null> {
  return walletPublicKey.getValue();
}

export async function clearStoredKeypair(): Promise<void> {
  await encryptedKeypair.setValue(null);
  await walletPublicKey.setValue(null);
}

export async function changePassword(keypair: Keypair, newPassword: string): Promise<void> {
  await storeKeypair(keypair, newPassword);
}

async function storeKeypair(keypair: Keypair, password: string): Promise<void> {
  const serialized = JSON.stringify(Array.from(keypair.secretKey));
  const encrypted = await encrypt(serialized, password);
  await encryptedKeypair.setValue(encrypted);
  await walletPublicKey.setValue(keypair.publicKey.toBase58());
}

// AES-GCM encryption/decryption using Web Crypto API
async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encrypt(plaintext: string, pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return JSON.stringify({
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(encrypted)),
  });
}

async function decrypt(ciphertext: string, pin: string): Promise<string | null> {
  try {
    const { salt, iv, data } = JSON.parse(ciphertext);
    const key = await deriveKey(pin, new Uint8Array(salt));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      key,
      new Uint8Array(data),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
