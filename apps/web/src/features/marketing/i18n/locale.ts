export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];

/** Marketing paths that exist in every locale. Everything else is English-only. */
export const TRANSLATED_PATHS = [
  "/",
  "/earn",
  "/agents",
  "/trust",
  "/risks",
] as const;
export type TranslatedPath = (typeof TRANSLATED_PATHS)[number];

const LOCALE_PREFIX: Record<Locale, string> = { en: "", ru: "/ru" };

function isTranslatedPath(path: string): path is TranslatedPath {
  return (TRANSLATED_PATHS as readonly string[]).includes(path);
}

/**
 * Maps a site-relative href to its equivalent in `locale`. Paths without a
 * translation (blog, privacy policy, the app), external URLs, mailto: links
 * and bare #hash links come back unchanged.
 */
export function localizedHref(locale: Locale, href: string): string {
  const prefix = LOCALE_PREFIX[locale];
  if (prefix === "" || !href.startsWith("/")) {
    return href;
  }
  const hashIndex = href.indexOf("#");
  const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  if (!isTranslatedPath(path)) {
    return href;
  }
  return `${prefix}${path === "/" ? "" : path}${hash}`;
}
