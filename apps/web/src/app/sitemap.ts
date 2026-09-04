import type { MetadataRoute } from "next";

import { getAllBlogPosts } from "@/features/blog";
import { siteUrl } from "@/lib/seo/site";

/**
 * The sitemap, generated from the routes and the blog archive.
 *
 * This replaces a hand-maintained public/sitemap.xml that listed six URLs and
 * had fallen behind the site: /trust was missing, and so were /blog and all 32
 * posts, because adding a post means adding a directory and nothing tied that
 * to the sitemap. Deriving the post list from the blog loader closes that gap
 * permanently.
 *
 * Static by design. It reads post markdown through the blog loader, and
 * next.config.ts only traces public/blog/**\/*.md into the /blog function, so a
 * runtime sitemap would find no posts in production. Being generated at build
 * time it needs no tracing entry, and since posts arrive by commit and deploy,
 * a build-time snapshot is never stale.
 *
 * Deliberately absent: /app and its children (the authenticated wallet), /500,
 * /ingest (the analytics proxy), and /landing (an unlinked AI-chat demo) are
 * all disallowed in robots.txt, and paginated listings (/blog?page=N) carry no
 * content that isn't already reachable through the post URLs below.
 */

/**
 * Marketing routes and the date each was last meaningfully edited.
 *
 * An explicit map rather than a git-derived date: Vercel builds from a shallow
 * clone, so commit timestamps aren't dependable at build time, and a lastmod
 * that changes on every unrelated deploy teaches crawlers to ignore it. Update
 * the date here when you change a page's content.
 */
const STATIC_ROUTES: ReadonlyArray<{ path: string; lastModified: string }> = [
  { path: "/", lastModified: "2026-06-01" },
  { path: "/earn", lastModified: "2026-05-28" },
  { path: "/agents", lastModified: "2026-05-28" },
  { path: "/trust", lastModified: "2026-06-01" },
  { path: "/privacy-policy", lastModified: "2026-02-23" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getAllBlogPosts();

  const staticEntries = STATIC_ROUTES.map(({ path, lastModified }) => ({
    url: siteUrl(path),
    lastModified,
  }));

  // Posts come back newest first, so the head of the list dates the listing.
  const newest = posts.at(0);
  const blogIndex = {
    url: siteUrl("/blog"),
    lastModified: newest ? (newest.updated ?? newest.date) : undefined,
  };

  const postEntries = posts.map((post) => ({
    url: siteUrl(`/blog/${post.slug}`),
    // Same expression the post page uses for its JSON-LD dateModified, so the
    // two can't disagree about when a post last changed.
    lastModified: post.updated ?? post.date,
  }));

  return [...staticEntries, blogIndex, ...postEntries];
}
