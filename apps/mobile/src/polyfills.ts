// These MUST run before any Solana library import.

// --- crypto.getRandomValues ---
// Must be imported before @solana/web3.js.
// v2 uses expo-crypto under the hood (compiled into dev client).
import "react-native-get-random-values";
import {
  CryptoDigestAlgorithm,
  digest as expoDigest,
} from "expo-crypto";

// --- Buffer polyfill ---
import { Buffer } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

// --- TextEncoder polyfill ---
if (typeof globalThis.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("text-encoding");
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

type CryptoLike = {
  subtle?: {
    digest?: (
      algorithm: AlgorithmIdentifier,
      data: BufferSource,
    ) => Promise<ArrayBuffer>;
  };
};

function resolveDigestAlgorithm(
  algorithm: AlgorithmIdentifier,
): CryptoDigestAlgorithm {
  const rawName =
    typeof algorithm === "string"
      ? algorithm
      : typeof algorithm === "object" &&
          algorithm !== null &&
          "name" in algorithm &&
          typeof algorithm.name === "string"
        ? algorithm.name
        : "";
  const normalizedName = rawName.toUpperCase().replace(/_/g, "-");

  switch (normalizedName) {
    case "SHA-1":
    case "SHA1":
      return CryptoDigestAlgorithm.SHA1;
    case "SHA-256":
    case "SHA256":
      return CryptoDigestAlgorithm.SHA256;
    case "SHA-384":
    case "SHA384":
      return CryptoDigestAlgorithm.SHA384;
    case "SHA-512":
    case "SHA512":
      return CryptoDigestAlgorithm.SHA512;
    default:
      throw new Error(`Unsupported digest algorithm: ${rawName || "unknown"}`);
  }
}

function resolveDigestInput(data: BufferSource): Uint8Array<ArrayBuffer> {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data.slice(0));
  }
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const copiedBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Uint8Array(copiedBuffer);
  }
  throw new TypeError("digest input must be an ArrayBuffer or typed array");
}

const mutableGlobal = globalThis as unknown as {
  crypto?: CryptoLike;
};

if (typeof mutableGlobal.crypto === "undefined") {
  mutableGlobal.crypto = {};
}

if (typeof mutableGlobal.crypto?.subtle?.digest !== "function") {
  const existingSubtle = mutableGlobal.crypto?.subtle ?? {};
  mutableGlobal.crypto = mutableGlobal.crypto ?? {};
  mutableGlobal.crypto.subtle = {
    ...existingSubtle,
    digest: async (algorithm, data) => {
      const expoAlgorithm = resolveDigestAlgorithm(algorithm);
      const digestInput = resolveDigestInput(data);
      return await expoDigest(expoAlgorithm, digestInput);
    },
  };
}
