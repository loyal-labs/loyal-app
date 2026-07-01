import { serverEnv } from "../core/config/server";
import { EncryptedData } from "./types";

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

function encodeText(value: string) {
  return Uint8Array.from(new TextEncoder().encode(value));
}

async function getKey(): Promise<CryptoKey | null> {
  const keyBase64 = serverEnv.messageEncryptionKey;
  if (!keyBase64) {
    console.error("MESSAGE_ENCRYPTION_KEY environment variable is not set");
    return null;
  }

  try {
    const keyBytes = Buffer.from(keyBase64, "base64");
    if (keyBytes.length !== 32) {
      console.error("MESSAGE_ENCRYPTION_KEY must be 32 bytes (256 bits)");
      return null;
    }

    return await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: ALGORITHM },
      false,
      ["encrypt"]
    );
  } catch (error) {
    console.error("Failed to import encryption key", error);
    return null;
  }
}

export async function encrypt(
  plaintext: string
): Promise<EncryptedData | null> {
  const key = await getKey();
  if (!key) {
    return null;
  }

  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const data = encodeText(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      data
    );

    return {
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      iv: Buffer.from(iv).toString("base64"),
    };
  } catch (error) {
    console.error("Failed to encrypt data", error);
    return null;
  }
}
