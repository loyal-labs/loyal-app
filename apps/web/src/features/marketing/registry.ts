/**
 * Every marketing page lives at the root URL (askloyal.com/<slug>) and is
 * registered here so the Features dropdown in the header can list it.
 *
 * Add a slug whenever you create a new src/app/<slug>/page.tsx. Order in this
 * array == order in the dropdown. The dropdown title and description live in
 * the dictionaries (src/features/marketing/i18n/<locale>/common.ts, under
 * header.features), and tsc fails until every locale has an entry.
 */
export const MARKETING_PAGE_SLUGS = ["earn", "agents"] as const;
export type MarketingPageSlug = (typeof MARKETING_PAGE_SLUGS)[number];

export type MarketingPageCopy = {
  /** Display name shown in the header Features dropdown. */
  title: string;
  /** One-line subtitle shown under the title in the dropdown. */
  description: string;
};

export type MarketingPage = MarketingPageCopy & {
  /** URL slug (used in /<slug>). No leading slash. */
  slug: MarketingPageSlug;
};
