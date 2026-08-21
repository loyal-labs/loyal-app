// Install/open attribution (ASK-2199): captures twclid and utm_* from deep
// link URLs (both platforms) and from the Play Install Referrer (Android,
// first launch only), then registers them on Mixpanel as super properties
// (event-scoped, last-touch) and people properties (last-touch plain keys,
// first-touch `initial_`-prefixed via setOnce — Mixpanel's standard
// first/last-touch naming).
//
// True deferred deep links on iOS (install via App Store, first open without
// a URL) need an MMP and are out of scope here.

import * as Linking from "expo-linking";
import { Platform } from "react-native";

import {
  registerSuperProperties,
  setUserProfileOnce,
  updateUserProfile,
} from "@/lib/analytics/analytics";
import { mmkv } from "@/lib/storage";

const ATTRIBUTION_KEYS = [
  "twclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

const INSTALL_REFERRER_CHECKED_KEY = "attribution.installReferrerChecked";

// Accepts a full URL or a bare query string (the Play Install Referrer is
// the latter, e.g. "utm_source=twitter&twclid=abc").
export function parseAttributionParams(
  input: string,
): Record<string, string> | null {
  const withoutFragment = input.split("#")[0];
  const queryIndex = withoutFragment.indexOf("?");
  const query =
    queryIndex >= 0 ? withoutFragment.slice(queryIndex + 1) : withoutFragment;
  const params = new URLSearchParams(query);
  const out: Record<string, string> = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function applyAttribution(source: string, params: Record<string, string>): void {
  // Last-touch: super props on every subsequent event + plain people props.
  registerSuperProperties(params);
  updateUserProfile({ ...params, attribution_source: source });
  // First-touch: written once, never overwritten.
  const firstTouch: Record<string, string> = {
    initial_attribution_source: source,
  };
  for (const [key, value] of Object.entries(params)) {
    firstTouch[`initial_${key}`] = value;
  }
  setUserProfileOnce(firstTouch);
}

function captureFromUrl(url: string): void {
  const params = parseAttributionParams(url);
  if (params) applyAttribution("deep_link", params);
}

// Android only: the Play Install Referrer survives the store install, so it
// works without any URL open. Read once per install. iOS: no-op.
function captureInstallReferrerOnce(): void {
  if (Platform.OS !== "android") return;
  if (mmkv.getBoolean(INSTALL_REFERRER_CHECKED_KEY)) return;
  try {
    // Lazy require: binaries built before this dependency existed (OTA
    // recipients) lack the native module; the catch keeps them working.
    const { PlayInstallReferrer } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react-native-play-install-referrer") as typeof import("react-native-play-install-referrer");
    PlayInstallReferrer.getInstallReferrerInfo((info, error) => {
      if (error || !info) return;
      // Mark checked only on success so transient Play Store errors retry.
      mmkv.setBoolean(INSTALL_REFERRER_CHECKED_KEY, true);
      const params = parseAttributionParams(info.installReferrer ?? "");
      if (params) applyAttribution("install_referrer", params);
    });
  } catch {
    // Native module unavailable (old binary, tests) — skip silently.
  }
}

// Call once from the root layout. Returns the url-listener cleanup.
export function initAttribution(): () => void {
  void Linking.getInitialURL().then((url) => {
    if (url) captureFromUrl(url);
  });
  const subscription = Linking.addEventListener("url", ({ url }) => {
    captureFromUrl(url);
  });
  captureInstallReferrerOnce();
  return () => subscription.remove();
}
