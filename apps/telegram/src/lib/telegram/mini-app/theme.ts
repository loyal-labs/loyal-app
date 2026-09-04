import { themeParams } from "@telegram-apps/sdk";
import type { RGB } from "@telegram-apps/types";

import { themeColorSignals, ThemeSignalKey } from "@/types/telegram";
const isClient = typeof window !== "undefined";

let asyncMountPromise: Promise<boolean> | null = null;

const mountThemeParamsAsync = (): Promise<boolean> => {
  if (!themeParams.mount.isAvailable()) {
    return Promise.resolve(false);
  }

  if (!asyncMountPromise) {
    asyncMountPromise = themeParams
      .mount()
      .then(() => true)
      .catch((error) => {
        console.error("Failed to mount theme params asynchronously", error);
        return false;
      })
      .finally(() => {
        asyncMountPromise = null;
      });
  }

  return asyncMountPromise;
};

export const ensureThemeParamsMounted = async (): Promise<boolean> => {
  if (!isClient) return false;

  if (themeParams.isMounted()) {
    return true;
  }

  if (themeParams.mountSync.isAvailable()) {
    try {
      themeParams.mountSync();
      return themeParams.isMounted();
    } catch (error) {
      console.error("Failed to mount theme params synchronously", error);
      return false;
    }
  }

  return await mountThemeParamsAsync();
};

export const bindThemeCssVars = (): boolean => {
  if (!isClient) return false;
  if (themeParams.isCssVarsBound()) return true;
  if (!themeParams.bindCssVars.isAvailable()) return false;

  try {
    themeParams.bindCssVars();
    return true;
  } catch (error) {
    console.error("Failed to bind theme CSS variables", error);
    return false;
  }
};

export const ensureTelegramTheme = async (): Promise<boolean> => {
  const mounted = await ensureThemeParamsMounted();
  if (!mounted) return false;

  bindThemeCssVars();

  return true;
};

export const getThemeColor = (key: ThemeSignalKey): RGB | undefined => {
  const signal = themeColorSignals[key];

  if (!signal) return undefined;

  return signal();
};

export const themeSignals = themeColorSignals;
