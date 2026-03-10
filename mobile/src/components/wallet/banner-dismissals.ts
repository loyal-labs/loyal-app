import { mmkv } from "@/lib/storage";

const DISMISSED_BANNERS_KEY = "wallet_dismissed_banners_v1";

let hasLoaded = false;
let cachedDismissedBannerIds = new Set<string>();

const parseDismissedBannerIds = (rawValue: string): Set<string> => {
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((id): id is string => typeof id === "string" && id.length > 0),
    );
  } catch {
    return new Set();
  }
};

export const getCachedDismissedBannerIds = (): Set<string> | undefined => {
  if (!hasLoaded) return undefined;
  return new Set(cachedDismissedBannerIds);
};

export function loadDismissedBannerIds(): Set<string> {
  if (hasLoaded) return new Set(cachedDismissedBannerIds);

  const stored = mmkv.getString(DISMISSED_BANNERS_KEY);
  if (stored) {
    cachedDismissedBannerIds = parseDismissedBannerIds(stored);
  } else {
    cachedDismissedBannerIds = new Set();
  }
  hasLoaded = true;
  return new Set(cachedDismissedBannerIds);
}

export function saveDismissedBannerIds(ids: Set<string>): void {
  const uniqueIds = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0) uniqueIds.add(id);
  }
  cachedDismissedBannerIds = uniqueIds;
  hasLoaded = true;
  mmkv.setString(DISMISSED_BANNERS_KEY, JSON.stringify([...uniqueIds]));
}

export const clearDismissedBannerIdsCacheForTests = (): void => {
  cachedDismissedBannerIds = new Set();
  hasLoaded = false;
};
