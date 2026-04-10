import {
  getFeaturedLibraryArticle,
  getLibraryArticleBySlug,
  librarySections,
} from "../content";

describe("library content", () => {
  it("returns the featured article with structured sections", () => {
    const featured = getFeaturedLibraryArticle();

    expect(featured.slug).toBe("move-assets-into-your-seeker-wallet");
    expect(featured.sections.length).toBeGreaterThan(1);
    expect(featured.sections[0]?.heading).toBe("Why this matters");
  });

  it("groups articles into how-tos, tutorials, and faqs", () => {
    expect(librarySections.map((section) => section.title)).toEqual([
      "How-tos",
      "Tutorials",
      "FAQs",
    ]);
    expect(librarySections.every((section) => section.articles.length > 0)).toBe(
      true,
    );
  });

  it("looks up articles by slug", () => {
    const article = getLibraryArticleBySlug("what-is-shielded-balance");

    expect(article?.title).toBe("What is a shielded balance?");
    expect(article?.category).toBe("FAQ");
  });
});
