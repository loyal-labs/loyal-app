import {
  closingBehavior,
  retrieveLaunchParams,
  viewport,
} from "@telegram-apps/sdk-react";
import { useEffect, useState } from "react";

import { TELEGRAM_BOT_ID } from "@/lib/constants";
import { initTelegram } from "@/lib/telegram/mini-app";
import {
  cleanInitData,
  createValidationString,
  validateInitData,
} from "@/lib/telegram/mini-app/init-data-transform";
import { ensureTelegramTheme } from "@/lib/telegram/mini-app/theme";

export function useTelegramSetup(rawInitData: string | undefined): {
  isMobilePlatform: boolean;
} {
  const [isMobilePlatform, setIsMobilePlatform] = useState(false);

  useEffect(() => {
    if (rawInitData) {
      if (!TELEGRAM_BOT_ID) {
        console.error("TELEGRAM_BOT_ID is not set in .env");
        return;
      }
      const cleanInitDataResult = cleanInitData(rawInitData);
      const validationString = createValidationString(
        TELEGRAM_BOT_ID,
        cleanInitDataResult
      );
      const signature = cleanInitDataResult.signature as string;
      validateInitData(validationString, signature);
    }
  }, [rawInitData]);

  useEffect(() => {
    initTelegram();
    void ensureTelegramTheme();

    // Enable closing confirmation always
    try {
      // Mount closing behavior if needed
      if (closingBehavior.mount.isAvailable?.()) {
        closingBehavior.mount();
      }

      if (closingBehavior.enableConfirmation.isAvailable()) {
        closingBehavior.enableConfirmation();
        const _isEnabled = closingBehavior.isConfirmationEnabled();
      } else {
        console.warn("enableConfirmation is not available");
      }
    } catch (error) {
      console.error("Failed to enable closing confirmation:", error);
    }

    // Check platform and enable fullscreen for mobile
    let platform: string | undefined;
    try {
      const launchParams = retrieveLaunchParams();
      platform = launchParams.tgWebAppPlatform;
    } catch {
      // Fallback to hash parsing if SDK fails
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);
      platform = params.get("tgWebAppPlatform") || undefined;
    }

    const isMobile = platform === "ios" || platform === "android";
    setIsMobilePlatform(isMobile);

    if (isMobile) {
      if (viewport.requestFullscreen.isAvailable()) {
        void viewport.requestFullscreen().catch((error) => {
          console.warn("Failed to enable fullscreen:", error);
        });
      }
    }

    // Suppress Telegram SDK viewport errors in non-TMA environment
    const originalError = console.error;
    console.error = (...args) => {
      const message = args[0]?.toString() || "";
      // Suppress viewport_changed and other bridge validation errors
      if (
        message.includes("viewport_changed") ||
        message.includes(
          "ValiError: Invalid type: Expected Object but received null"
        )
      ) {
        return; // Silently ignore these errors
      }
      originalError.apply(console, args);
    };

    return () => {
      console.error = originalError;
    };
  }, []);

  return { isMobilePlatform };
}
