// Stable per-install identity for telemetry (ASK-2097): a UUID generated on
// first launch and persisted in MMKV, plus the OS fleet the device belongs
// to. This is the join key that lets ClickStack pull a device's whole
// telemetry trail across sessions and wallets — the wallet address alone
// misses everything that happens before auth, and the error channel carried
// no correlator at all.
//
// Lives outside `observability.ts` so that module stays free of react-native
// and storage imports (its test suite mocks only expo-updates); consumers
// inject the identity via `setObservabilityDeviceIdentity`.

import { Platform } from "react-native";

import { mmkv } from "@/lib/storage";

export type MobileDevicePlatform = "android" | "ios";

const DEVICE_ID_KEY = "observability.deviceId";

// The ingest validates the id as a canonical UUID v4 and drops the whole
// envelope otherwise, so a corrupted stored value must be regenerated, not
// sent.
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function generateUuid(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.trunc(Math.random() * 16);
    const value = char === "x" ? random : (random % 4) + 8;
    return value.toString(16);
  });
}

// `mmkv` falls back to in-memory storage when the native module is missing,
// so at worst the id is stable for one session instead of the install.
export function getObservabilityDeviceId(): string {
  const existing = mmkv.getString(DEVICE_ID_KEY);
  if (existing && UUID_V4_PATTERN.test(existing)) return existing;
  const generated = generateUuid();
  mmkv.setString(DEVICE_ID_KEY, generated);
  return generated;
}

export function getObservabilityDevicePlatform(): MobileDevicePlatform {
  return Platform.OS === "ios" ? "ios" : "android";
}
