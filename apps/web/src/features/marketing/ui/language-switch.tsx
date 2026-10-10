"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import {
  LOCALE_PARAM,
  LOCALE_TAGS,
  LOCALES,
  type Locale,
  localizedHref,
  type TranslatedPath,
} from "@/features/marketing/i18n/locale";

const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  zh: "简体中文",
};

/**
 * Language dropdown. The button shows the current locale; the menu links to
 * the same page in each locale. Pages without a translation pass path="/",
 * so the links lead to each locale's home page.
 *
 * Built as a disclosure (button + list of links) rather than an ARIA menu,
 * because the items are plain navigation links.
 */
export function LanguageSwitch({
  locale,
  path,
  ariaLabel,
  className = "",
}: {
  locale: Locale;
  path: TranslatedPath;
  ariaLabel: string;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      className={`relative w-fit shrink-0 self-start text-[16px] sm:self-auto leading-5 ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false);
        }
      }}
      ref={rootRef}
    >
      <button
        aria-controls={listId}
        aria-expanded={isOpen}
        aria-label={`${ariaLabel}: ${LOCALE_NAMES[locale]}`}
        className="flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 transition-colors duration-150 ease-out hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        onClick={() => setIsOpen((open) => !open)}
        ref={buttonRef}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z" />
        </svg>
        <span lang={LOCALE_TAGS[locale]}>{LOCALE_NAMES[locale]}</span>
        <svg
          aria-hidden="true"
          className={`h-3 w-3 transition-transform duration-200 ease-out ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 12 12"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>

      <ul
        className={`absolute bottom-[calc(100%+8px)] left-0 z-20 min-w-full overflow-hidden rounded-[16px] bg-white p-1 shadow-[0_12px_36px_rgba(0,0,0,0.12)] ring-1 ring-black/5 transition duration-150 ease-out ${
          isOpen
            ? "translate-y-0 opacity-100"
            : "pointer-events-none invisible translate-y-1 opacity-0"
        }`}
        id={listId}
      >
        {LOCALES.map((target) => {
          const isCurrent = target === locale;
          return (
            <li key={target}>
              <Link
                aria-current={isCurrent ? "page" : undefined}
                className={`flex items-center justify-between gap-4 whitespace-nowrap rounded-[12px] px-3 py-2 transition-colors duration-150 ease-out hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-black ${
                  isCurrent ? "font-medium" : "font-normal"
                }`}
                // ?lang= makes the middleware remember the choice, so the
                // browser-language redirect stops overriding it.
                href={`${localizedHref(target, path)}?${LOCALE_PARAM}=${target}`}
                hrefLang={LOCALE_TAGS[target]}
                lang={LOCALE_TAGS[target]}
                onClick={() => setIsOpen(false)}
              >
                {LOCALE_NAMES[target]}
                {isCurrent ? (
                  <svg
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 14 14"
                  >
                    <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
                  </svg>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
