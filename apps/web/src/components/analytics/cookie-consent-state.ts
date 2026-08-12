"use client";

import type { ConsentChoices } from "./landing-cookie-consent";

export const COOKIE_CONSENT_STORAGE_KEY = "loyal_cookie_consent_v1";
export const COOKIE_CONSENT_CHANGED_EVENT = "loyal:cookie-consent-changed";

const DEFAULT_CHOICES: ConsentChoices = {
  analytics: false,
  marketing: false,
  personalization: false,
};

export function readStoredCookieConsent(): ConsentChoices {
  if (typeof window === "undefined") {
    return { ...DEFAULT_CHOICES };
  }

  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_CHOICES };
    }

    const parsed = JSON.parse(raw) as Partial<ConsentChoices>;
    return {
      analytics: parsed.analytics === true,
      marketing: parsed.marketing === true,
      personalization: parsed.personalization === true,
    };
  } catch {
    return { ...DEFAULT_CHOICES };
  }
}

export function persistCookieConsent(choices: ConsentChoices): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify(choices)
    );
  } catch {
    // Storage may be unavailable (private mode, quota exceeded). The DOM event
    // below still lets in-memory listeners react during the current session.
  }

  window.dispatchEvent(
    new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: choices })
  );
}

export function hasMarketingConsent(): boolean {
  return readStoredCookieConsent().marketing;
}
