import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { LandingFooter } from "@/components/landing-footer";
import { LandingHeader } from "@/components/landing-header";
import { LandingScrollAnimations } from "@/components/landing-scroll-animations";
import {
  BlogContent,
  formatBlogDate,
  getAllBlogSlugs,
  getBlogPost,
  getMoreArticles,
  ibmPlexSans,
  MoreArticles,
} from "@/features/blog";
import { cn } from "@/lib/utils";

const SITE_ORIGIN = "https://askloyal.com";

type BlogPostParams = { slug: string };

export const dynamicParams = false;

export async function generateStaticParams(): Promise<BlogPostParams[]> {
  const slugs = await getAllBlogSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<BlogPostParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);

  if (!post) {
    return { title: "Blog | Loyal" };
  }

  const title = `${post.title} | Loyal`;
  const url = `/blog/${post.slug}`;

  return {
    title,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title,
      description: post.description,
      publishedTime: post.date,
      images: [{ url: post.hero, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: post.description,
      images: [post.hero],
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<BlogPostParams>;
}) {
  const { slug } = await params;
  const post = await getBlogPost(slug);

  if (!post) {
    notFound();
  }

  const morePosts = await getMoreArticles(post.slug, 3);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    ...(post.description ? { description: post.description } : {}),
    datePublished: post.date,
    image: `${SITE_ORIGIN}${post.hero}`,
    author: post.author
      ? { "@type": "Person", name: post.author.name }
      : { "@id": `${SITE_ORIGIN}/#organization` },
    publisher: { "@id": `${SITE_ORIGIN}/#organization` },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_ORIGIN}/blog/${post.slug}`,
    },
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_ORIGIN },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: `${SITE_ORIGIN}/blog`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: post.title,
        item: `${SITE_ORIGIN}/blog/${post.slug}`,
      },
    ],
  };

  return (
    <main className="min-h-screen overflow-x-clip bg-white text-black">
      {/* JSON-LD as script children (XSS-safe; React escapes <>&) */}
      <script type="application/ld+json">{JSON.stringify(articleJsonLd)}</script>
      <script type="application/ld+json">
        {JSON.stringify(breadcrumbJsonLd)}
      </script>

      <LandingScrollAnimations />
      <LandingHeader />

      <article
        className={cn(ibmPlexSans.variable, "flex w-full justify-center bg-white")}
      >
        <div className="flex w-full max-w-[768px] flex-col px-6 pb-12 pt-24 lg:pb-16 lg:pt-32">
          <header className="flex flex-col gap-8" data-reveal="left">
            <h1 className="text-[40px] font-semibold leading-none tracking-[-0.8px] text-black md:text-[64px] md:tracking-[-1.28px]">
              {post.title}
            </h1>
            {post.description ? (
              <p className="max-w-[600px] text-[20px] leading-[1.2] tracking-[-0.4px] text-black/60 md:text-[24px] md:tracking-[-0.48px]">
                {post.description}
              </p>
            ) : null}
            {/* Meta: desktop is one row (author · reading · date); mobile
                stacks to reading·date (16px) above the author (20px). */}
            <div className="flex flex-col gap-4 text-[20px] tracking-[-0.4px] sm:flex-row sm:flex-wrap sm:items-center">
              {post.author ? (
                <span className="order-2 flex items-center gap-3 sm:order-1 sm:gap-4">
                  {post.author.avatar ? (
                    <Image
                      alt=""
                      aria-hidden="true"
                      className="size-9 rounded-full border border-black/[0.06] object-cover"
                      height={36}
                      src={post.author.avatar}
                      width={36}
                    />
                  ) : null}
                  <span className="text-black/60">{post.author.name}</span>
                </span>
              ) : null}
              {post.author ? (
                <span
                  aria-hidden="true"
                  className="order-1 hidden text-black/40 sm:order-2 sm:inline"
                >
                  ·
                </span>
              ) : null}
              <span className="order-1 flex items-center gap-3 text-[16px] tracking-[-0.32px] sm:order-3 sm:gap-4 sm:text-[20px] sm:tracking-[-0.4px]">
                <span className="text-black/60">{post.readingTime} min read</span>
                <span aria-hidden="true" className="text-black/40">
                  ·
                </span>
                <time className="text-black/60" dateTime={post.date}>
                  {formatBlogDate(post.date)}
                </time>
              </span>
            </div>
          </header>

          <div
            className="relative mt-16 aspect-[1280/856] w-full overflow-hidden rounded-[24px] border border-black/[0.08] bg-[#f5f5f5]"
            data-reveal="scale"
          >
            <Image
              alt={post.title}
              className="object-cover"
              fill
              priority
              sizes="(min-width: 768px) 768px, 100vw"
              src={post.hero}
            />
          </div>

          <div className="mt-16">
            <BlogContent content={post.content} slug={post.slug} />
          </div>
        </div>
      </article>

      <MoreArticles posts={morePosts} />

      <LandingFooter />
    </main>
  );
}
