import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha256.js";

const PBKDF2_ITERATIONS = 600_000;

function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, new TextEncoder().encode(password), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  });
}

export function encryptSecret(plaintext: string, password: string): string {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = deriveKey(password, salt);
  const aes = gcm(key, iv);
  const encrypted = aes.encrypt(new TextEncoder().encode(plaintext));
  return JSON.stringify({
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(encrypted),
  });
}

export function decryptSecret(
  ciphertext: string,
  password: string,
): string | null {
  try {
    const { salt, iv, data } = JSON.parse(ciphertext);
    const key = deriveKey(password, new Uint8Array(salt));
    const aes = gcm(key, new Uint8Array(iv));
    const decrypted = aes.decrypt(new Uint8Array(data));
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
