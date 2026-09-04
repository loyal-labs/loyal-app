import type { BlogPost } from "@/features/blog";

import { siteUrl } from "./site";

/**
 * Renders the generated "## Blog" section shared by /llms.txt and
 * /llms-full.txt.
 *
 * Both files are written to be read and quoted by AI engines, so each entry
 * carries the title, the absolute URL, the publication date, and the post's own
 * description: enough for an engine to decide a post is relevant and cite it
 * without fetching it first.
 */
export function renderBlogSection(posts: readonly BlogPost[]): string {
  const lines = posts.map((post) => {
    const url = siteUrl(`/blog/${post.slug}`);
    const summary = post.description ? `: ${post.description}` : "";
    return `- [${post.title}](${url}) (${post.date})${summary}`;
  });

  return [
    "## Blog",
    "",
    `Long-form updates from the Loyal team, newest first. Full index: ${siteUrl("/blog")}`,
    "",
    ...lines,
    "",
  ].join("\n");
}
