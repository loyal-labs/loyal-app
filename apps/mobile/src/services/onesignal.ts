import { env } from "@/config/env";

/**
 * Centralized OneSignal wrapper — all OneSignal SDK access goes through this
 * module; never import "react-native-onesignal" elsewhere.
 *
 * Lazily loaded like expo-notifications above it in this folder: binaries
 * built before OneSignal was added (and OTA-updated bundles running on them)
 * lack the native module, so a top-level import would crash on boot.
 */
async function getOneSignal() {
  if (!env.oneSignalAppId) return null;
  try {
    return await import("react-native-onesignal");
  } catch {
    console.log("react-native-onesignal not available (old binary?)");
    return null;
  }
}

// The SDK drops calls made before initialize() (login forwards straight to
// native), and callers like PushTokenRegistrar run their effects before the
// root layout's init effect. Every non-init wrapper call waits for init to
// settle first — "settled" includes the skipped/unavailable paths, where the
// call then no-ops via getOneSignal.
let markInitSettled!: () => void;
const initSettled = new Promise<void>((resolve) => {
  markInitSettled = resolve;
});

/**
 * Initialize the OneSignal SDK. Call once on app boot, before rendering the
 * main content. No-ops when EXPO_PUBLIC_ONESIGNAL_APP_ID is unset or the
 * native module is missing. Does NOT request push permission — the Expo
 * notifications flow (PushTokenRegistrar, wallet-gated) owns the OS prompt,
 * and OneSignal picks up the app-level grant on its own.
 */
export async function initOneSignal(): Promise<void> {
  try {
    if (!env.oneSignalAppId) {
      console.log("[onesignal] EXPO_PUBLIC_ONESIGNAL_APP_ID not set, skipping");
      return;
    }
    const mod = await getOneSignal();
    if (!mod) return;

    if (__DEV__) {
      mod.OneSignal.Debug.setLogLevel(mod.LogLevel.Verbose);
    }
    mod.OneSignal.initialize(env.oneSignalAppId);
  } catch (error) {
    console.error("[onesignal] initialize failed:", error);
  } finally {
    markInitSettled();
  }
}

/** Tie the OneSignal user to our identity (e.g. wallet public key). */
export async function loginOneSignal(externalId: string): Promise<void> {
  await initSettled;
  const mod = await getOneSignal();
  mod?.OneSignal.login(externalId);
}

export async function logoutOneSignal(): Promise<void> {
  await initSettled;
  const mod = await getOneSignal();
  mod?.OneSignal.logout();
}

export async function addOneSignalEmail(email: string): Promise<void> {
  await initSettled;
  const mod = await getOneSignal();
  mod?.OneSignal.User.addEmail(email);
}

export async function addOneSignalSms(phone: string): Promise<void> {
  await initSettled;
  const mod = await getOneSignal();
  mod?.OneSignal.User.addSms(phone);
}

export async function setOneSignalTags(
  tags: Record<string, string>,
): Promise<void> {
  await initSettled;
  const mod = await getOneSignal();
  mod?.OneSignal.User.addTags(tags);
}
