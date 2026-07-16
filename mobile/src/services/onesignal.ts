import { Alert } from "react-native";

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
  try {
    return await import("react-native-onesignal");
  } catch {
    console.log("react-native-onesignal not available (old binary?)");
    return null;
  }
}

/**
 * Initialize the OneSignal SDK. Call once on app boot, before rendering the
 * main content. No-ops when EXPO_PUBLIC_ONESIGNAL_APP_ID is unset or the
 * native module is missing. Does NOT request push permission — that happens
 * only from the verification dialog's "Got it" button.
 */
export async function initOneSignal(): Promise<void> {
  if (!env.oneSignalAppId) {
    console.log("[onesignal] EXPO_PUBLIC_ONESIGNAL_APP_ID not set, skipping");
    return;
  }
  const mod = await getOneSignal();
  if (!mod) return;

  try {
    if (__DEV__) {
      mod.OneSignal.Debug.setLogLevel(mod.LogLevel.Verbose);
    }
    mod.OneSignal.initialize(env.oneSignalAppId);
    setupPushSubscriptionObserver(mod.OneSignal);
  } catch (error) {
    console.error("[onesignal] initialize failed:", error);
  }
}

/** Tie the OneSignal user to our identity (e.g. wallet public key). */
export async function loginOneSignal(externalId: string): Promise<void> {
  const mod = await getOneSignal();
  mod?.OneSignal.login(externalId);
}

export async function logoutOneSignal(): Promise<void> {
  const mod = await getOneSignal();
  mod?.OneSignal.logout();
}

export async function addOneSignalEmail(email: string): Promise<void> {
  const mod = await getOneSignal();
  mod?.OneSignal.User.addEmail(email);
}

export async function addOneSignalSms(phone: string): Promise<void> {
  const mod = await getOneSignal();
  mod?.OneSignal.User.addSms(phone);
}

export async function setOneSignalTags(
  tags: Record<string, string>,
): Promise<void> {
  const mod = await getOneSignal();
  mod?.OneSignal.User.addTags(tags);
}

// --- Push subscription verification dialog -------------------------------
// Confirms the device registered with OneSignal's servers after init, once.

let dialogShown = false;

/** Real, server-assigned subscription IDs are non-empty and not the SDK's `local-` placeholder. */
function isRegistered(subscriptionId: string | null | undefined): boolean {
  return !!subscriptionId && !subscriptionId.startsWith("local-");
}

function setupPushSubscriptionObserver(
  oneSignal: (typeof import("react-native-onesignal"))["OneSignal"],
): void {
  const maybeShowDialog = (subscriptionId: string | null | undefined) => {
    if (isRegistered(subscriptionId) && !dialogShown) {
      dialogShown = true;
      Alert.alert(
        "Your OneSignal SDK integration is complete!",
        "You can now send Push Notifications & In-App Messages through OneSignal. Tap below to enable push notifications.",
        [
          {
            text: "Got it",
            onPress: () => {
              oneSignal.Notifications.requestPermission(true);
            },
          },
        ],
        { cancelable: false },
      );
    }
  };

  oneSignal.User.pushSubscription.addEventListener("change", (subscription) => {
    maybeShowDialog(subscription.current.id);
  });
  // The ID may already be server-assigned before the listener attaches, so
  // evaluate the current value immediately as well.
  void oneSignal.User.pushSubscription.getIdAsync().then(maybeShowDialog);
}
