import { isTMA } from "@telegram-apps/bridge";
import {
  init,
  miniApp,
  openTelegramLink,
  requestContact,
  RequestedContact,
  sendData,
  viewport,
} from "@telegram-apps/sdk-react";

// Initialize once
let initialized = false;
let viewportMounted = false;

// Type for Telegram WebApp
interface TelegramWebApp {
  ready: () => void;
  version: string;
  platform?: string;
  isFullscreen?: boolean;
  isVersionAtLeast: (version: string) => boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  contentSafeAreaInset?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  safeAreaInset?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  onEvent: (eventType: string, callback: () => void) => void;
  offEvent: (eventType: string, callback: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

/**
 * Get safe area values from native WebApp API (most reliable)
 */
const getNativeInsets = () => {
  const webApp =
    typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;

  // contentSafeAreaInset is available in WebApp 8.0+
  const hasContentSafe = webApp?.isVersionAtLeast?.("8.0") ?? false;

  const contentInsets = hasContentSafe
    ? webApp?.contentSafeAreaInset
    : undefined;
  const deviceInsets = webApp?.safeAreaInset;

  return {
    contentTop: contentInsets?.top ?? 0,
    contentBottom: contentInsets?.bottom ?? 0,
    deviceTop: deviceInsets?.top ?? 0,
    deviceBottom: deviceInsets?.bottom ?? 0,
  };
};

/**
 * Get safe area values from SDK signals (with native fallback)
 */
const getInsets = () => {
  try {
    // Try SDK signals first (if mounted)
    if (viewportMounted) {
      const contentTop = viewport.contentSafeAreaInsetTop?.() ?? 0;
      const contentBottom = viewport.contentSafeAreaInsetBottom?.() ?? 0;
      const deviceTop = viewport.safeAreaInsetTop?.() ?? 0;
      const deviceBottom = viewport.safeAreaInsetBottom?.() ?? 0;

      // If SDK returns values, use them
      if (contentTop > 0 || deviceTop > 0) {
        return { contentTop, contentBottom, deviceTop, deviceBottom };
      }
    }
  } catch {
    // Ignore SDK errors
  }

  // Fallback to native WebApp API
  return getNativeInsets();
};

/**
 * Apply safe area insets as CSS custom properties on document root.
 */
const applySafeAreaInsets = () => {
  if (typeof document === "undefined") return;

  try {
    const { contentTop, contentBottom, deviceTop, deviceBottom } = getInsets();

    // Combine both for total safe area
    const totalTop = contentTop + deviceTop;
    const totalBottom = contentBottom + deviceBottom;

    // Set CSS custom properties
    document.documentElement.style.setProperty(
      "--app-safe-top",
      `${totalTop}px`
    );
    document.documentElement.style.setProperty(
      "--app-safe-bottom",
      `${totalBottom}px`
    );
    document.documentElement.style.setProperty(
      "--app-content-safe-top",
      `${contentTop}px`
    );
    document.documentElement.style.setProperty(
      "--app-content-safe-bottom",
      `${contentBottom}px`
    );
    document.documentElement.style.setProperty(
      "--app-device-safe-top",
      `${deviceTop}px`
    );
    document.documentElement.style.setProperty(
      "--app-device-safe-bottom",
      `${deviceBottom}px`
    );

    console.debug("Safe area insets applied:", {
      contentTop,
      contentBottom,
      deviceTop,
      deviceBottom,
      totalTop,
      totalBottom,
    });
  } catch (e) {
    console.debug("Failed to apply safe area insets:", (e as Error).message);
  }
};

/**
 * Mount viewport and set up safe area handling.
 */
const mountViewport = async () => {
  if (viewportMounted) return;

  try {
    // Mount viewport if available
    if (viewport.mount.isAvailable()) {
      await viewport.mount();
      viewportMounted = true;
      console.debug("Viewport mounted successfully");
    }

    // Bind CSS variables for viewport dimensions
    if (viewport.bindCssVars.isAvailable()) {
      viewport.bindCssVars();
      console.debug("Viewport CSS vars bound");
    }

    // Apply initial safe area insets
    applySafeAreaInsets();

    // Subscribe to safe area changes using signal's .sub() method
    const unsubContentTop =
      viewport.contentSafeAreaInsetTop?.sub?.(applySafeAreaInsets);
    const unsubContentBottom =
      viewport.contentSafeAreaInsetBottom?.sub?.(applySafeAreaInsets);
    const unsubDeviceTop =
      viewport.safeAreaInsetTop?.sub?.(applySafeAreaInsets);
    const unsubDeviceBottom =
      viewport.safeAreaInsetBottom?.sub?.(applySafeAreaInsets);

    // Store cleanup functions if needed
    if (typeof window !== "undefined") {
      (
        window as unknown as { __cleanupSafeArea?: () => void }
      ).__cleanupSafeArea = () => {
        unsubContentTop?.();
        unsubContentBottom?.();
        unsubDeviceTop?.();
        unsubDeviceBottom?.();
      };
    }
  } catch (e) {
    console.debug("Viewport mount skipped:", (e as Error).message);
  }
};

/**
 * Subscribe to native WebApp safe area events
 */
const subscribeToNativeEvents = () => {
  const webApp =
    typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
  if (!webApp) return;

  // Subscribe to safe area change events
  webApp.onEvent("contentSafeAreaChanged", applySafeAreaInsets);
  webApp.onEvent("safeAreaChanged", applySafeAreaInsets);
  webApp.onEvent("viewportChanged", applySafeAreaInsets);
};

export const initTelegram = () => {
  if (initialized) return;

  try {
    // isTMA() relies on retrieveLaunchParams() which needs tgWebAppPlatform in the URL.
    // Some Telegram clients (old versions, certain desktop builds) may not inject it.
    // Fall back to checking window.Telegram?.WebApp which is set by the Telegram JS bridge.
    const inTelegram = isTMA() || !!window.Telegram?.WebApp;

    if (inTelegram) {
      try {
        init();
      } catch {
        // init() may throw LaunchParamsRetrieveError if URL params are missing,
        // but native bridge features (safe area, ready()) still work.
      }

      try {
        miniApp.ready();
      } catch {
        // Gracefully handle if SDK init was incomplete
      }

      // Set header color to white so Android uses dark status bar icons.
      // Per Telegram docs: "This color helps determine a contrasting color
      // for the status bar and other UI controls."
      try {
        if (miniApp.setHeaderColor.isAvailable()) {
          miniApp.setHeaderColor("bg_color");
        }
      } catch {
        // Ignore SDK errors
      }

      // Also set via native WebApp API (most reliable on Android)
      try {
        const webApp = window.Telegram?.WebApp;
        if (typeof webApp?.setHeaderColor === "function") {
          webApp.setHeaderColor("#ffffff");
        }
        if (typeof webApp?.setBackgroundColor === "function") {
          webApp.setBackgroundColor("#ffffff");
        }
      } catch {
        // Ignore if not supported
      }

      // Also call native ready() for good measure
      window.Telegram?.WebApp?.ready();

      // Apply insets immediately from native API (sync, reliable)
      applySafeAreaInsets();

      // Subscribe to native events
      subscribeToNativeEvents();

      // Mount viewport async for SDK features
      void mountViewport().catch((e) => {
        console.debug("Viewport mount failed:", (e as Error).message);
      });
    } else {
      // Running outside Telegram - features will be unavailable
      console.debug("Running in non-Telegram environment");

      // Set default CSS variables for non-TMA environment
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty("--app-safe-top", "0px");
        document.documentElement.style.setProperty("--app-safe-bottom", "0px");
        document.documentElement.style.setProperty(
          "--app-content-safe-top",
          "0px"
        );
        document.documentElement.style.setProperty(
          "--app-content-safe-bottom",
          "0px"
        );
        document.documentElement.style.setProperty(
          "--app-device-safe-top",
          "0px"
        );
        document.documentElement.style.setProperty(
          "--app-device-safe-bottom",
          "0px"
        );
      }
    }
  } catch (e) {
    console.warn("Telegram SDK initialization skipped:", (e as Error).message);
  } finally {
    initialized = true;
  }
};

/**
 * Force refresh safe area insets. Call this when modals open or viewport changes.
 */
export const refreshSafeAreaInsets = () => {
  applySafeAreaInsets();
};

/**
 * Get current safe area values (for components that need direct access)
 */
export const getSafeAreaInsets = () => {
  const { contentTop, contentBottom, deviceTop, deviceBottom } = getInsets();
  return {
    contentTop,
    contentBottom,
    deviceTop,
    deviceBottom,
    totalTop: contentTop + deviceTop,
    totalBottom: contentBottom + deviceBottom,
  };
};

/**
 * Check if viewport is mounted and ready.
 */
export const isViewportMounted = () => viewportMounted;

// Core functions
export const isInMiniApp = () => {
  if (typeof window === "undefined") return false;

  // Initialize if not already done
  initTelegram();

  // Check if miniApp is available after init
  return miniApp.isSupported();
};

export const requestTelegramContact = async (): Promise<RequestedContact> => {
  if (!requestContact.isAvailable()) throw new Error("Not available");

  return await requestContact();
};

export const openTgLink = (link: string) => {
  if (!openTelegramLink.isAvailable()) {
    throw new Error("Not available");
  }

  openTelegramLink(link);
};

export const sendString = (data: string) => {
  if (sendData.isAvailable()) {
    sendData(data);

    return true;
  }

  return false;
};

export type { RequestedContact };
