import type { Metadata } from "next";

import { SITE_URL } from "@/lib/seo/site";

import {
  alternateLanguages,
  type Locale,
  localizedHref,
  type TranslatedPath,
} from "./locale";
import type { BreadcrumbCopy, PageMeta } from "./types";

const OG_LOCALE: Partial<Record<Locale, string>> = { ru: "ru_RU" };

type OgImage = { url: string; width: number; height: number };

export function buildPageMetadata({
  locale,
  path,
  meta,
  ogImage,
}: {
  locale: Locale;
  path: TranslatedPath;
  meta: PageMeta;
  ogImage: OgImage;
}): Metadata {
  const url = localizedHref(locale, path);
  const ogLocale = OG_LOCALE[locale];

  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: url, languages: alternateLanguages(path) },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      url,
      title: meta.title,
      description: meta.description,
      ...(ogLocale ? { locale: ogLocale } : {}),
      images: [{ ...ogImage, alt: meta.ogImageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [ogImage.url],
    },
  };
}

/** "https://askloyal.com" for "/", so the home crumb keeps its existing form. */
function absoluteUrl(href: string): string {
  return href === "/" ? SITE_URL : `${SITE_URL}${href}`;
}

export function buildBreadcrumbJsonLd({
  locale,
  path,
  copy,
}: {
  locale: Locale;
  path: TranslatedPath;
  copy: BreadcrumbCopy;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: copy.home,
        item: absoluteUrl(localizedHref(locale, "/")),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: copy.page,
        item: absoluteUrl(localizedHref(locale, path)),
      },
    ],
  };
}
