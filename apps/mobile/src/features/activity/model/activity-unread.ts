import { mmkv } from "@/lib/storage";

// The Activity screen has two sections (the top segmented control) and a
// matching dot in the bottom nav. "Unread" means the newest item in a section
// is newer than the last time the user looked at that section. We persist the
// last-seen timestamp per section so the dots survive app restarts.
export type ActivitySection = "wallet" | "earn";

const lastSeenKey = (section: ActivitySection): string =>
  `activity:lastSeen:${section}`;

/** Returns the persisted last-seen timestamp, or `undefined` on first launch. */
export function getActivityLastSeen(
  section: ActivitySection,
): number | undefined {
  return mmkv.getNumber(lastSeenKey(section));
}

export function setActivityLastSeen(
  section: ActivitySection,
  timestamp: number,
): void {
  mmkv.setNumber(lastSeenKey(section), timestamp);
}
