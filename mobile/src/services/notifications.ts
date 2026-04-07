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

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    return tokenData.data;
  } catch (error) {
    console.log("Push notifications not available:", error);
    return null;
  }
}

/**
 * Listen for notification taps. Returns a cleanup function, or null if unavailable.
 */
export async function addNotificationResponseListener(
  callback: (data: Record<string, unknown>) => void,
): Promise<(() => void) | null> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return null;

  const subscription =
    Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data) callback(data);
    });

  return () => subscription.remove();
}

/**
 * Send the push token to our backend for storage.
 */
export async function registerPushToken(token: string): Promise<void> {
  try {
    await fetch(`${env.apiBaseUrl}/api/push-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        telegramUserId: env.telegramUserId,
        platform: process.env.EXPO_OS ?? "unknown",
      }),
    });
  } catch (error) {
    console.error("Failed to register push token:", error);
  }
}
