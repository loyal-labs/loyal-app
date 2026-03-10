// These MUST run before any Solana library import.

// crypto.getRandomValues — needed by @solana/web3.js for keypair generation.
// Try multiple sources because native modules may not be available until
// a dev client is rebuilt after adding native deps.
if (
  typeof globalThis.crypto === "undefined" ||
  typeof globalThis.crypto.getRandomValues !== "function"
) {
  if (!globalThis.crypto) {
    // @ts-expect-error — partial crypto shim
    globalThis.crypto = {};
  }

  let polyfilled = false;

  // 1. Try expo-crypto (needs native module)
  if (!polyfilled) {
    try {
      const { getRandomValues } = require("expo-crypto");
      globalThis.crypto.getRandomValues = getRandomValues;
      polyfilled = true;
    } catch {
      // native module not available
    }
  }

  // 2. Try react-native-get-random-values (needs native module)
  if (!polyfilled) {
    try {
      require("react-native-get-random-values");
      polyfilled = typeof globalThis.crypto.getRandomValues === "function";
    } catch {
      // native module not available
    }
  }

  if (!polyfilled) {
    console.error(
      "[polyfills] crypto.getRandomValues unavailable — rebuild dev client to include native crypto modules.",
    );
  }
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
