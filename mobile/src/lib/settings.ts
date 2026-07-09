// App preference flags backed by the shared MMKV store.

import { mmkv } from "@/lib/storage";

const SHOW_TIPS_KEY = "settings.showTips";

// Whether to show in-app tips/hints (e.g. the Earn chart swipe hint). On by
// default; when enabled the hint shows every time the chart opens.
export function getShowTips(): boolean {
  return mmkv.getBoolean(SHOW_TIPS_KEY) ?? true;
}

export function setShowTips(value: boolean): void {
  mmkv.setBoolean(SHOW_TIPS_KEY, value);
}

const EXPERIMENTAL_FEATURES_KEY = "settings.experimentalFeatures";

// Experimental features (currently: Earn rent-refund scan in Activity). Off
// by default; toggled from Settings.
export function getExperimentalFeatures(): boolean {
  return mmkv.getBoolean(EXPERIMENTAL_FEATURES_KEY) ?? false;
}

export function setExperimentalFeatures(value: boolean): void {
  mmkv.setBoolean(EXPERIMENTAL_FEATURES_KEY, value);
}
