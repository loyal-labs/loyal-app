// Stub globalThis.crypto BEFORE expo-router loads route files.
// @noble/hashes/crypto.js caches `globalThis.crypto` at module load time.
// By creating the object here, @noble/hashes caches this reference.
// The real getRandomValues is added to the SAME object later by
// react-native-get-random-values (imported in src/polyfills.ts below).
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = {};
}

// Polyfills must load before any route module evaluation.
require("./src/polyfills");

// Standard expo-router entry
require("expo-router/entry");
