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
