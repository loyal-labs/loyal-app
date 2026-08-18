import { getAllBlogPosts } from "@/features/blog";
import { renderBlogSection } from "@/lib/seo/llms-blog";
import { LLMS_INDEX_HEAD, LLMS_INDEX_TAIL } from "@/lib/seo/llms-content";

/**
 * /llms.txt — the short-form index for AI engines.
 *
 * Was a static file in public/. It moved here so the Blog section can be
 * generated from the post archive; the surrounding prose is unchanged and still
 * hand-edited, in src/lib/seo/llms-content.ts.
 *
 * The old public/llms.txt had to be deleted in the same change: a file in
 * public/ shadows a route at the same path, so leaving it would mean this
 * handler never serves.
 */
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  const posts = await getAllBlogPosts();
  // The curated halves already carry their own blank-line spacing, so the
  // section is joined without adding another leading newline.
  const body = `${LLMS_INDEX_HEAD}${renderBlogSection(posts)}\n${LLMS_INDEX_TAIL}`;

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
