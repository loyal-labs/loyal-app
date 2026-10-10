export const LOCALES = ["en", "ru", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

/** Remembers a language the visitor picked explicitly in the switch. */
export const LOCALE_COOKIE = "loyal_locale";
/** Query parameter the language switch appends to record the choice. */
export const LOCALE_PARAM = "lang";

/** Marketing paths that exist in every locale. Everything else is English-only. */
export const TRANSLATED_PATHS = [
  "/",
  "/earn",
  "/agents",
  "/trust",
  "/risks",
] as const;
export type TranslatedPath = (typeof TRANSLATED_PATHS)[number];

const LOCALE_PREFIX: Record<Locale, string> = { en: "", ru: "/ru", zh: "/zh" };

/**
 * BCP 47 tag for each locale, used in hreflang, `lang` attributes and
 * schema.org `inLanguage`. Chinese is served in Simplified script only, so
 * it's tagged zh-Hans rather than the bare "zh".
 */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en",
  ru: "ru",
  zh: "zh-Hans",
};

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

/** hreflang map for a translated path. English is the x-default. */
export function alternateLanguages(
  path: TranslatedPath,
  toUrl: (href: string) => string = (href) => href
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of LOCALES) {
    languages[LOCALE_TAGS[locale]] = toUrl(localizedHref(locale, path));
  }
  languages["x-default"] = toUrl(path);
  return languages;
}
