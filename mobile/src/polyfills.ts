// These MUST be imported before any Solana library

// crypto.getRandomValues — needed by @solana/web3.js for keypair generation.
// expo-crypto works in Expo Go without a native rebuild.
// react-native-get-random-values v2 requires native JSI (needs dev client).
// We try both: expo-crypto first (always available), then RNGV as fallback.
import { getRandomValues } from "expo-crypto";

if (
  typeof globalThis.crypto === "undefined" ||
  typeof globalThis.crypto.getRandomValues !== "function"
) {
  if (!globalThis.crypto) {
    // @ts-expect-error — partial crypto shim
    globalThis.crypto = {};
  }
  globalThis.crypto.getRandomValues = getRandomValues as typeof globalThis.crypto.getRandomValues;
}

import { Buffer } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

if (typeof globalThis.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("text-encoding");
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}
