import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha256.js";

// 100k iterations — standard for mobile (iOS Keychain uses the same).
// Browser extension uses 600k with native crypto.subtle which is hardware-accelerated;
// pure-JS PBKDF2 on mobile needs fewer iterations to stay responsive.
const PBKDF2_ITERATIONS = 100_000;

async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  return pbkdf2Async(sha256, new TextEncoder().encode(password), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  });
}

export async function encryptSecret(
  plaintext: string,
  password: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const aes = gcm(key, iv);
  const encrypted = aes.encrypt(new TextEncoder().encode(plaintext));
  return JSON.stringify({
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(encrypted),
  });
}

export async function decryptSecret(
  ciphertext: string,
  password: string,
): Promise<string | null> {
  try {
    const { salt, iv, data } = JSON.parse(ciphertext);
    const key = await deriveKey(password, new Uint8Array(salt));
    const aes = gcm(key, new Uint8Array(iv));
    const decrypted = aes.decrypt(new Uint8Array(data));
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
