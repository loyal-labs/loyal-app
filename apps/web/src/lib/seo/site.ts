/**
 * Canonical production origin, and the single source for every absolute URL
 * the site emits: page canonicals, the sitemap, and the llms.txt files.
 *
 * Previously each of those hardcoded "https://askloyal.com" separately, which
 * is how the static sitemap drifted out of sync with the routes it described.
 */
export const SITE_URL = "https://askloyal.com";

/** Resolves a site-relative path (e.g. "/blog") to its absolute URL. */
export function siteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}
