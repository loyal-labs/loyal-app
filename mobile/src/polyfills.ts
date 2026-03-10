// These MUST run before any Solana library import.

// --- crypto.getRandomValues ---
// Must be imported before @solana/web3.js.
// v2 uses expo-crypto under the hood (compiled into dev client).
import "react-native-get-random-values";

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
