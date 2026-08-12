import { hashes, verify } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

import { TELEGRAM_PUBLIC_KEYS } from "@/lib/constants";

hashes.sha512 = sha512; // Noble requires the hash implementation to be registered manually

export const verifyInitData = async (
  validationBytes: Uint8Array,
  signatureBytes: Uint8Array
): Promise<boolean> => {
  if (validationBytes.length === 0 || signatureBytes.length !== 64) {
    return false;
  }

  const results = await Promise.all(
    TELEGRAM_PUBLIC_KEYS.map(async (publicKeyHex) => {
      try {
        const publicKeyBytes = Buffer.from(publicKeyHex, "hex");
        if (publicKeyBytes.length !== 32) {
          return false;
        }
        return verify(signatureBytes, validationBytes, publicKeyBytes);
      } catch (error) {
        console.error("[telegram][invoice] failed to verify init data", error);
        return false;
      }
    })
  );

  return results.some(Boolean);
};
