"use client";

export type EphemeralKeyPair = {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyRaw: Uint8Array;
  privateKeyPkcs8: Uint8Array;
};

const generateX25519Keys = async (): Promise<CryptoKeyPair> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto API is unavailable in this environment.");
  }

  try {
    return (await subtle.generateKey({ name: "X25519" }, true, [
      "deriveKey",
      "deriveBits",
    ])) as CryptoKeyPair;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "NotSupportedError" || error.name === "SyntaxError")
    ) {
      return (await subtle.generateKey(
        { name: "ECDH", namedCurve: "X25519" },
        true,
        ["deriveKey", "deriveBits"]
      )) as CryptoKeyPair;
    }
    throw error;
  }
};

export const generateEphemeralX25519KeyPair =
  async (): Promise<EphemeralKeyPair> => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error("WebCrypto API is unavailable in this environment.");
    }

    const { publicKey, privateKey } = await generateX25519Keys();

    const [publicKeyRaw, privateKeyPkcs8] = await Promise.all([
      subtle.exportKey("raw", publicKey),
      subtle.exportKey("pkcs8", privateKey),
    ]);

    return {
      publicKey,
      privateKey,
      publicKeyRaw: new Uint8Array(publicKeyRaw),
      privateKeyPkcs8: new Uint8Array(privateKeyPkcs8),
    };
  };
