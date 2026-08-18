import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Keeps the /landing AI-chat demo out of search results.
 *
 * The page itself is a client component, so it can't export metadata; this
 * layout exists only to carry the robots directive. The route is reachable but
 * linked from nowhere, and it's excluded from the sitemap and disallowed in
 * robots.txt for the same reason.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LandingLayout({ children }: { children: ReactNode }) {
  return children;
}
