import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { z } from "zod";

import type { BlogPageResult, BlogPost, BlogPostFull } from "./types";

/**
 * Number of posts shown per page on the blog listing.
 * The Figma layout is a 3-column grid; 9 fills three rows on desktop.
 */
export const BLOG_POSTS_PER_PAGE = 9;

/**
 * Each post is a folder `public/blog/<slug>/` holding the markdown body
 * (`post.md`) and its colocated media (hero, inline images, avatars), all
 * served statically. The body is deliberately NOT named `index.md`: Vercel's
 * static layer serves a directory's `index.*` at its clean URL, which made a
 * direct load of `/blog/<slug>` return the raw markdown instead of this route
 * (client-side navigation was unaffected). Any non-`index` name avoids that.
 */
const BLOG_CONTENT_DIR = path.join(process.cwd(), "public", "blog");
const POST_FILENAME = "post.md";

const WORDS_PER_MINUTE = 200;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const FrontmatterSchema = z.object({
  title: z.string().min(1),
  date: z.string().min(1),
  hero: z.string().min(1),
  description: z.string().min(1).optional(),
  author: z
    .object({ name: z.string().min(1), avatar: z.string().min(1).optional() })
    .optional(),
  readingTime: z.number().int().positive().optional(),
});

/** Splits raw file content into parsed YAML frontmatter and the markdown body. */
function splitFrontmatter(raw: string): { data: unknown; content: string } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { data: {}, content: raw };
  }
  // JSON_SCHEMA keeps unquoted dates (e.g. 2026-02-06) as strings instead of
  // coercing them to Date objects the way the default YAML schema would.
  const data = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) ?? {};
  return { data, content: raw.slice(match[0].length) };
}

/** Estimates reading time in minutes from the markdown body (~200 wpm). */
function estimateReadingTime(markdown: string): number {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/**
 * Resolves a frontmatter media reference to a servable URL. Absolute paths and
 * full URLs pass through; bare/relative names resolve against the post folder.
 */
function resolveMedia(slug: string, ref: string): string {
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith("/")) {
    return ref;
  }
  return `/blog/${slug}/${ref.replace(/^\.\//, "")}`;
}

/** Reads and parses a single post directory; returns null if it has no post.md. */
async function loadPost(slug: string): Promise<BlogPostFull | null> {
  const file = path.join(BLOG_CONTENT_DIR, slug, POST_FILENAME);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }

  const { data, content } = splitFrontmatter(raw);
  const parsed = FrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid frontmatter in blog/${slug}/${POST_FILENAME}: ${parsed.error.message}`
    );
  }

  const fm = parsed.data;
  return {
    slug,
    title: fm.title,
    date: fm.date,
    hero: resolveMedia(slug, fm.hero),
    description: fm.description,
    author: fm.author
      ? {
          name: fm.author.name,
          avatar: fm.author.avatar
            ? resolveMedia(slug, fm.author.avatar)
            : undefined,
        }
      : undefined,
    readingTime: fm.readingTime ?? estimateReadingTime(content),
    content,
  };
}

/** Returns the names of the post subdirectories (empty if the dir is missing). */
async function readPostSlugs(): Promise<string[]> {
  try {
    const dirents = await fs.readdir(BLOG_CONTENT_DIR, { withFileTypes: true });
    return dirents
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

let postsCache: Promise<BlogPostFull[]> | null = null;

/** Reads every post once and caches the parsed result for the process lifetime. */
function loadAllPosts(): Promise<BlogPostFull[]> {
  postsCache ??= (async () => {
    const slugs = await readPostSlugs();
    const posts = (await Promise.all(slugs.map(loadPost))).filter(
      (post): post is BlogPostFull => post !== null
    );

    // Newest first.
    return posts.sort((a, b) => b.date.localeCompare(a.date));
  })();

  return postsCache;
}

/** Strips the markdown body, leaving listing-friendly post metadata. */
function toMeta(post: BlogPostFull): BlogPost {
  return {
    slug: post.slug,
    title: post.title,
    date: post.date,
    hero: post.hero,
    description: post.description,
    author: post.author,
    readingTime: post.readingTime,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Returns one page of blog posts plus pagination metadata. The requested page
 * is clamped into the valid range, so callers can pass a raw `?page=` value.
 */
export async function getBlogPosts({
  page = 1,
  perPage = BLOG_POSTS_PER_PAGE,
}: { page?: number; perPage?: number } = {}): Promise<BlogPageResult> {
  const all = await loadAllPosts();
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = clamp(Math.trunc(page) || 1, 1, totalPages);
  const start = (safePage - 1) * perPage;
  const posts = all.slice(start, start + perPage).map(toMeta);

  return { posts, page: safePage, perPage, total, totalPages };
}

/** Returns the full post (metadata + markdown body) for a slug, or null. */
export async function getBlogPost(slug: string): Promise<BlogPostFull | null> {
  const all = await loadAllPosts();
  return all.find((post) => post.slug === slug) ?? null;
}

/** Returns the most recent posts excluding the given slug (for "More articles"). */
export async function getMoreArticles(
  slug: string,
  count = 3
): Promise<BlogPost[]> {
  const all = await loadAllPosts();
  return all
    .filter((post) => post.slug !== slug)
    .slice(0, count)
    .map(toMeta);
}

/** Returns every post slug, for static generation. */
export async function getAllBlogSlugs(): Promise<string[]> {
  const all = await loadAllPosts();
  return all.map((post) => post.slug);
}
