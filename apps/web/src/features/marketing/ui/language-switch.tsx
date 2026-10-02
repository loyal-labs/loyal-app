import Link from "next/link";

import {
  LOCALES,
  type Locale,
  localizedHref,
  type TranslatedPath,
} from "@/features/marketing/i18n/locale";

const LABELS: Record<Locale, string> = { en: "EN", ru: "RU" };
const LOCALE_NAMES: Record<Locale, string> = { en: "English", ru: "Русский" };

/**
 * Links to the same page in the other locale; the current locale is plain
 * text. Pages without a translation pass path="/", so the link leads to the
 * other locale's home page.
 */
export function LanguageSwitch({
  locale,
  path,
  ariaLabel,
  className = "",
  tabIndex,
}: {
  locale: Locale;
  path: TranslatedPath;
  ariaLabel: string;
  className?: string;
  tabIndex?: number;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={`flex shrink-0 items-center gap-1 text-[16px] leading-5 ${className}`}
    >
      {LOCALES.map((target) => {
        if (target === locale) {
          return (
            <span
              aria-current="true"
              aria-label={LOCALE_NAMES[target]}
              className="rounded-full px-2 py-1 font-medium"
              key={target}
              lang={target}
            >
              {LABELS[target]}
            </span>
          );
        }
        return (
          <Link
            aria-label={LOCALE_NAMES[target]}
            className="rounded-full px-2 py-1 font-normal transition-colors duration-150 ease-out hover:underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            href={localizedHref(target, path)}
            hrefLang={target}
            key={target}
            lang={target}
            tabIndex={tabIndex}
          >
            {LABELS[target]}
          </Link>
        );
      })}
    </nav>
  );
}
