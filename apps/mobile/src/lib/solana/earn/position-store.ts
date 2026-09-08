import { env } from "@/config/env";
import { mmkv } from "@/lib/storage";

import {
  normalizeEarnCluster,
  type EarnPositionOverlay,
} from "./position-overlay";

// Wallet and Earn tabs mount separate readers. Share the confirmed overlay so
// neither can overwrite the other's landed transaction with its older REST read.
const records = new Map<string, EarnPositionOverlay | null>();
const listeners = new Set<(wallet: string, confirmed: boolean) => void>();
const key = (wallet: string) =>
  `earn:position:v2:${env.earnApiBaseUrl}:${normalizeEarnCluster(
    env.solanaEnv
  )}:${wallet}`;
export function readEarnOverlay(wallet: string): EarnPositionOverlay | null {
  const storageKey = key(wallet);
  if (!records.has(storageKey)) {
    try {
      const raw = mmkv.getString(storageKey);
      records.set(
        storageKey,
        raw ? (JSON.parse(raw) as EarnPositionOverlay) : null
      );
    } catch {
      records.set(storageKey, null);
    }
  }
  return records.get(storageKey) ?? null;
}
export function writeEarnOverlay(
  wallet: string,
  overlay: EarnPositionOverlay | null,
  confirmed = false
): void {
  records.set(key(wallet), overlay);
  try {
    if (overlay) mmkv.setString(key(wallet), JSON.stringify(overlay));
    else mmkv.delete(key(wallet));
  } catch {
    console.warn("[earn] unable to persist confirmed position cache");
  }
  for (const listener of listeners) listener(wallet, confirmed);
}
export function subscribeEarnOverlay(
  listener: (wallet: string, confirmed: boolean) => void
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
