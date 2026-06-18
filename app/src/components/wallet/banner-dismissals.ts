import {
  getCloudValue,
  setCloudValue,
} from "@/lib/telegram/mini-app/cloud-storage";

const DISMISSED_BANNERS_KEY = "wallet_dismissed_banners_v1";

let hasLoadedDismissedBannerIds = false;
let cachedDismissedBannerIds = new Set<string>();

const cloneSet = (ids: Set<string>): Set<string> => new Set(ids);

const parseDismissedBannerIds = (rawValue: string): Set<string> => {
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return new Set();

    const validIds = parsed.filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );

    return new Set(validIds);
  } catch {
    return new Set();
  }
};

export const getCachedDismissedBannerIds = (): Set<string> | undefined => {
  if (!hasLoadedDismissedBannerIds) return undefined;
  return cloneSet(cachedDismissedBannerIds);
};

export async function loadDismissedBannerIds(): Promise<Set<string>> {
  if (hasLoadedDismissedBannerIds) {
    return cloneSet(cachedDismissedBannerIds);
  }

  try {
    const stored = await getCloudValue(DISMISSED_BANNERS_KEY);

    // A dismissal may have happened while cloud storage request was in-flight.
    if (hasLoadedDismissedBannerIds) {
      return cloneSet(cachedDismissedBannerIds);
    }

    if (typeof stored === "string" && stored.length > 0) {
      cachedDismissedBannerIds = parseDismissedBannerIds(stored);
    } else {
      cachedDismissedBannerIds = new Set();
    }

    hasLoadedDismissedBannerIds = true;
    return cloneSet(cachedDismissedBannerIds);
  } catch (error) {
    console.error("Failed to load dismissed wallet banners", error);
  }

  // Retry on next remount/load attempt; do not mark as loaded on failure.
  return new Set();
}

export async function saveDismissedBannerIds(
  ids: Iterable<string>
): Promise<void> {
  const uniqueIds = new Set<string>();

  for (const id of ids) {
    if (typeof id === "string" && id.length > 0) {
      uniqueIds.add(id);
    }
  }

  cachedDismissedBannerIds = uniqueIds;
  hasLoadedDismissedBannerIds = true;

  try {
    await setCloudValue(DISMISSED_BANNERS_KEY, JSON.stringify([...uniqueIds]));
  } catch (error) {
    console.error("Failed to save dismissed wallet banners", error);
  }
}

export const clearDismissedBannerIdsCacheForTests = (): void => {
  cachedDismissedBannerIds = new Set();
  hasLoadedDismissedBannerIds = false;
};
