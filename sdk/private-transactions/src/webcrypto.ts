import type { Keypair } from "@solana/web3.js";

const ED25519_ALGORITHM = { name: "Ed25519" } as const;
const NODE_CRYPTO_SPECIFIER = "node:crypto";

let subtleCryptoPromise: Promise<SubtleCrypto> | null = null;

function getNodeProcess(): { versions?: { node?: string } } | undefined {
  return (
    globalThis as typeof globalThis & {
      process?: { versions?: { node?: string } };
    }
  ).process;
}

async function loadNodeWebCrypto(): Promise<Crypto | null> {
  if (typeof getNodeProcess()?.versions?.node !== "string") {
    return null;
  }

  const nodeCrypto = (await import(NODE_CRYPTO_SPECIFIER)) as {
    webcrypto?: Crypto;
  };

  return nodeCrypto.webcrypto ?? null;
}

async function loadSubtleCrypto(): Promise<SubtleCrypto> {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }

  const nodeWebCrypto = await loadNodeWebCrypto();
  if (nodeWebCrypto?.subtle) {
    return nodeWebCrypto.subtle;
  }

  throw new Error(
    "Web Crypto Ed25519 signing is not available in this runtime"
  );
}

async function getSubtleCrypto(): Promise<SubtleCrypto> {
  subtleCryptoPromise ??= loadSubtleCrypto();
  return subtleCryptoPromise;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let base64: string;

  if (typeof Buffer !== "undefined") {
    base64 = Buffer.from(bytes).toString("base64");
  } else {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    base64 = btoa(binary);
  }

  // Base64 -> Base64URL
  // ab+c/def== -> ab-c_def
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

async function importKeypairPrivateKey(keypair: Keypair): Promise<CryptoKey> {
  const privateScalar = keypair.secretKey.slice(0, 32);
  if (privateScalar.byteLength !== 32) {
    throw new Error("Expected Keypair secret key to contain a 32-byte seed");
  }

  const subtle = await getSubtleCrypto();

  return subtle.importKey(
    "jwk",
    {
      crv: "Ed25519",
      d: bytesToBase64Url(privateScalar),
      ext: false,
      kty: "OKP",
      x: bytesToBase64Url(keypair.publicKey.toBytes()),
    },
    ED25519_ALGORITHM,
    false,
    ["sign"]
  );
}

export function createKeypairMessageSigner(
  keypair: Keypair
): (message: Uint8Array) => Promise<Uint8Array> {
  let privateKeyPromise: Promise<CryptoKey> | null = null;

  const getPrivateKey = () => {
    privateKeyPromise ??= importKeypairPrivateKey(keypair);
    return privateKeyPromise;
  };

  return async (message: Uint8Array) => {
    const [subtle, privateKey] = await Promise.all([
      getSubtleCrypto(),
      getPrivateKey(),
    ]);
    const signature = await subtle.sign(ED25519_ALGORITHM, privateKey, message);

    return new Uint8Array(signature);
  };
}
