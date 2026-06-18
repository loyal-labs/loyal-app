import Constants from "expo-constants";
import * as Device from "expo-device";

import { env } from "@/config/env";

/**
 * Lazily load expo-notifications to avoid crash in Expo Go (SDK 53+).
 * Returns null if the module can't be loaded.
 */
async function getNotificationsModule() {
  try {
    return await import("expo-notifications");
  } catch {
    console.log("expo-notifications not available (Expo Go?)");
    return null;
  }
}

/**
 * Configure notification display behavior. Call once on app boot.
 *
 * Also installs a default Android channel — Android 8+ drops notifications
 * silently if the sender doesn't target a registered channel, so we always
 * need at least one even for low-volume delivery.
 */
export async function setupNotificationHandler(): Promise<void> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  if (process.env.EXPO_OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

/**
 * Register for push notifications and return the Expo push token.
 * Returns null if registration fails, device doesn't support push, or running in Expo Go.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      console.log("Push notifications require a physical device");
      return null;
    }

    const Notifications = await getNotificationsModule();
    if (!Notifications) return null;

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Push notification permission not granted");
      return null;
    }

    // In standalone / dapp-store builds expoConfig.extra may be stripped
    // once the app goes through a real publish. Constants.easConfig is the
    // documented fallback — falling through to a hard-coded projectId is a
    // last-resort so we never quietly generate tokens under the wrong
    // Expo project (which silently fail to deliver).
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig
        ?.projectId;

    if (!projectId) {
      console.error(
        "[push] Cannot generate Expo push token: no projectId in Constants"
      );
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    return tokenData.data;
  } catch (error) {
    // Loud error so Datadog RUM's trackErrors picks it up — the
    // underlying cause (FCM misconfig, Google Play services unavailable,
    // network during token fetch) is invisible otherwise on prod builds.
    console.error("[push] getExpoPushTokenAsync failed:", error);
    return null;
  }
}

/**
 * Listen for notification taps. Returns a cleanup function, or null if unavailable.
 */
export async function addNotificationResponseListener(
  callback: (data: Record<string, unknown>) => void
): Promise<(() => void) | null> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return null;

  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data;
      if (data) callback(data);
    }
  );

  return () => subscription.remove();
}

/**
 * Send the push token to our backend for storage, keyed by the caller's
 * wallet public key. The backend upserts on `token`, so re-registering
 * with the same token after a wallet change flips the identity.
 */
export async function registerPushToken(
  token: string,
  walletPublicKey: string
): Promise<void> {
  const url = `${env.apiBaseUrl}/api/push-tokens`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        walletPublicKey,
        platform: process.env.EXPO_OS ?? "unknown",
      }),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      console.error(
        `[push] Backend rejected push token (${response.status}):`,
        bodyText.slice(0, 200)
      );
    }
  } catch (error) {
    console.error("[push] Failed to POST push token:", error);
  }
}
