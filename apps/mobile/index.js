// Stub globalThis.crypto BEFORE expo-router loads route files.
// @noble/hashes/crypto.js caches `globalThis.crypto` at module load time.
// By creating the object here, @noble/hashes caches this reference.
// The real getRandomValues is added to the SAME object later by
// react-native-get-random-values (imported in src/polyfills.ts below).
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = {};
}

// Capture cold-start time before expo-router evaluates the application graph.
// Loading telemetry reads this marker after the authenticated Earn screen has
// painted its initial wallet, position, and Autodeposit state.
if (typeof globalThis.__loyalMobileAppStartedAtMs !== "number") {
  globalThis.__loyalMobileAppStartedAtMs = Date.now();
}

// Polyfills must load before any route module evaluation.
require("./src/polyfills");

// Standard expo-router entry
require("expo-router/entry");
