"use client";

import { useEffect } from "react";

import { loadXPixel } from "@/lib/core/x-pixel";

import {
  COOKIE_CONSENT_CHANGED_EVENT,
  hasMarketingConsent,
} from "./cookie-consent-state";

export function XPixelBootstrap() {
  useEffect(() => {
    const tryLoad = () => {
      if (hasMarketingConsent()) {
        loadXPixel();
      }
    };

    tryLoad();
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, tryLoad);
    return () => {
      window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, tryLoad);
    };
  }, []);

  return null;
}
