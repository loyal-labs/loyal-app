"use client";

import { useSignal, viewport } from "@telegram-apps/sdk-react";
import type { Signal } from "@telegram-apps/signals";
import { useCallback, useEffect, useState } from "react";

interface SafeAreaInsets {
  top: number;
  bottom: number;
}

const getWebApp = () => {
  return (
    window as {
      Telegram?: {
        WebApp?: {
          isVersionAtLeast?: (version: string) => boolean;
          contentSafeAreaInset?: { top: number; bottom: number };
          safeAreaInset?: { top: number; bottom: number };
          onEvent?: (eventType: string, callback: () => void) => void;
          offEvent?: (eventType: string, callback: () => void) => void;
        };
      };
    }
  ).Telegram?.WebApp;
};

const getDeviceSafeAreaTopValue = (): number => {
  if (typeof window === "undefined") return 0;
  return getWebApp()?.safeAreaInset?.top ?? 0;
};

const getSafeArea = (): SafeAreaInsets => {
  const webApp = getWebApp();
  if (!webApp) return { top: 0, bottom: 0 };

  const hasContentSafe = webApp.isVersionAtLeast?.("8.0") ?? false;
  const contentInsets = hasContentSafe
    ? webApp.contentSafeAreaInset
    : undefined;
  const deviceInsets = webApp.safeAreaInset;

  return {
    top: (contentInsets?.top ?? 0) + (deviceInsets?.top ?? 0),
    bottom: (contentInsets?.bottom ?? 0) + (deviceInsets?.bottom ?? 0),
  };
};

/**
 * Hook that returns the device safe area top inset (notch/status bar area).
 * Combines the SDK signal (reactive, populated after async viewport.mount())
 * with the native WebApp value (synchronous best-effort fallback).
 */
export function useDeviceSafeAreaTop(): number {
  // SDK signal — reactive, fires when viewport.mount() resolves
  const sdkTop = useSignal(viewport.safeAreaInsetTop as Signal<number>);

  // Native value — synchronous read, updated via Telegram client events
  const [nativeTop, setNativeTop] = useState(getDeviceSafeAreaTopValue);

  useEffect(() => {
    const update = () => setNativeTop(getDeviceSafeAreaTopValue());
    // Re-check in case value appeared between render and effect
    update();
    const webApp = getWebApp();
    webApp?.onEvent?.("safeAreaChanged", update);
    webApp?.onEvent?.("viewportChanged", update);
    return () => {
      webApp?.offEvent?.("safeAreaChanged", update);
      webApp?.offEvent?.("viewportChanged", update);
    };
  }, []);

  // SDK takes precedence; native value as fallback
  return sdkTop || nativeTop;
}

/**
 * Hook that provides combined Telegram safe area insets (device + content).
 */
export function useTelegramSafeArea(): SafeAreaInsets {
  const [insets, setInsets] = useState<SafeAreaInsets>(getSafeArea);

  const updateInsets = useCallback(() => {
    setInsets(getSafeArea());
  }, []);

  useEffect(() => {
    updateInsets();

    const webApp = getWebApp();
    webApp?.onEvent?.("contentSafeAreaChanged", updateInsets);
    webApp?.onEvent?.("safeAreaChanged", updateInsets);
    webApp?.onEvent?.("viewportChanged", updateInsets);

    return () => {
      webApp?.offEvent?.("contentSafeAreaChanged", updateInsets);
      webApp?.offEvent?.("safeAreaChanged", updateInsets);
      webApp?.offEvent?.("viewportChanged", updateInsets);
    };
  }, [updateInsets]);

  return insets;
}

/**
 * Fixed modal snap point.
 * Using a constant value to prevent any recalculation that could cause jumping.
 */
export function useModalSnapPoint(): number {
  return 0.92;
}
