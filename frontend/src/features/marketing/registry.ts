export type MarketingPage = {
  /** URL slug (used in /<slug>). No leading slash. */
  slug: string;
  /** Display name shown in the header Features dropdown. */
  title: string;
  /** One-line subtitle shown under the title in the dropdown (optional). */
  description?: string;
};

/**
 * Every marketing page lives at the root URL (askloyal.com/<slug>) and is
 * registered here so the Features dropdown in the header can list it.
 *
 * Add an entry whenever you create a new src/app/<slug>/page.tsx via the
 * /marketing-page skill. Order in this array == order in the dropdown.
 */
export const MARKETING_PAGES: MarketingPage[] = [
  {
    slug: "agents",
    title: "Agents",
    description: "Smart Accounts for AI Agents",
  },
  {
    slug: "private-payments",
    title: "Private Payments",
    description: "Anonymous Crypto Wallet on Solana",
  },
  {
    slug: "yield",
    title: "Yield",
    description: "Yield on Shielded USDC",
  },
  {
    slug: "earn",
    title: "Earn",
    description: "Best Stablecoin Yield on Solana",
  },
];
