// Stub globalThis.crypto BEFORE expo-router loads route files.
// @noble/hashes/crypto.js caches `globalThis.crypto` at module load time.
// By creating the object here, @noble/hashes caches this reference.
// The real getRandomValues is added to the SAME object later by
// react-native-get-random-values (imported in polyfills.ts via _layout.tsx).
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = {};
}

// Standard expo-router entry
require("expo-router/entry");
