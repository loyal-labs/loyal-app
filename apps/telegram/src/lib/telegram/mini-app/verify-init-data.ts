import { hashes, verify } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

import { TELEGRAM_PUBLIC_KEYS } from "@/lib/constants";

hashes.sha512 = sha512; // Noble requires the hash implementation to be registered manually

export const verifyInitDataWithPublicKey = async (
  validationBytes: Uint8Array,
  signatureBytes: Uint8Array,
  publicKeyHex: string
): Promise<boolean> => {
  if (validationBytes.length === 0 || signatureBytes.length !== 64) {
    return false;
  }

  try {
    const publicKeyBytes = Buffer.from(publicKeyHex, "hex");
    if (publicKeyBytes.length !== 32) {
      return false;
    }
    return verify(signatureBytes, validationBytes, publicKeyBytes);
  } catch (error) {
    console.error("Failed to verify Telegram init data", error);
    return false;
  }
};

export const verifyInitData = async (
  validationBytes: Uint8Array,
  signatureBytes: Uint8Array
): Promise<boolean> => {
  const results = await Promise.all(
    TELEGRAM_PUBLIC_KEYS.map((publicKeyHex) =>
      verifyInitDataWithPublicKey(
        validationBytes,
        signatureBytes,
        publicKeyHex
      )
    )
  );

  return results.some(Boolean);
};
