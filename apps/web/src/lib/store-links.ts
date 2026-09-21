/**
 * Where Loyal can be installed, and how those installs get attributed.
 *
 * Play Console's acquisition report reads campaign tags from a single
 * URL-encoded `referrer` parameter. utm_* pairs written as ordinary query
 * parameters are dropped and those installs are reported as "Unknown", so
 * every clickable Play link goes through `googlePlayUrl()`; `GOOGLE_PLAY_URL`
 * is the untagged canonical URL for prose, metadata and structured data.
 */

const GOOGLE_PLAY_APP_ID = "com.askloyal.app";

export const GOOGLE_PLAY_URL = `https://play.google.com/store/apps/details?id=${GOOGLE_PLAY_APP_ID}`;

/**
 * @param medium where on the site the link sits, e.g. "get-started" or
 * "footer". It lands in Play Console as the campaign's utm_medium.
 */
export function googlePlayUrl(medium: string): string {
  const referrer = new URLSearchParams({
    utm_medium: medium,
    utm_source: "askloyal.com",
  }).toString();

  return `${GOOGLE_PLAY_URL}&referrer=${encodeURIComponent(referrer)}`;
}
