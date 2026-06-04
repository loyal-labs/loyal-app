/** Author byline shown in the post meta row. */
export type BlogAuthor = {
  name: string;
  /** Resolved URL/path of the author avatar (optional). */
  avatar?: string;
};

/**
 * Post metadata used by the listing, cards, and "More articles".
 * Derived from each post's markdown frontmatter; media paths are resolved
 * to servable URLs (e.g. `/blog/<slug>/hero.png`).
 */
export type BlogPost = {
  /** URL slug used in /blog/<slug>. Matches the post directory name. */
  slug: string;
  /** Post title (required). */
  title: string;
  /** ISO date string (YYYY-MM-DD) of publication (required). */
  date: string;
  /** Resolved hero image URL — used on the post page and the listing card. */
  hero: string;
  /** Short summary shown under the title on the post page (optional). */
  description?: string;
  /** Author byline (optional). */
  author?: BlogAuthor;
  /** Estimated reading time in minutes (frontmatter value or auto-computed). */
  readingTime: number;
};

/** A full post: metadata plus the raw markdown body. */
export type BlogPostFull = BlogPost & {
  /** Raw markdown body (frontmatter stripped). */
  content: string;
};

/** One page of blog posts plus the pagination metadata the UI needs. */
export type BlogPageResult = {
  posts: BlogPost[];
  /** 1-based index of the returned page. */
  page: number;
  /** Number of posts per page. */
  perPage: number;
  /** Total number of posts across all pages. */
  total: number;
  /** Total number of pages (always >= 1). */
  totalPages: number;
};
