import { serverEnv } from "../core/config/server";
import { EncryptedData } from "./types";

const ALGORITHM = "AES-GCM";

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
      ["decrypt"]
    );
  } catch (error) {
    console.error("Failed to import encryption key", error);
    return null;
  }
}

export async function decrypt(
  encrypted: EncryptedData
): Promise<string | null> {
  const key = await getKey();
  if (!key) {
    return null;
  }

  try {
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    const iv = Buffer.from(encrypted.iv, "base64");

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error("Failed to decrypt data", error);
    return null;
  }
}
