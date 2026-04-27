"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { TrackedExternalLink } from "@/components/analytics/tracked-external-link";

type BlogPost = {
  title: string;
  link: string;
  pubDate: string;
  image: string | null;
};

const SKELETON_KEYS = ["blog-skeleton-0", "blog-skeleton-1", "blog-skeleton-2"];

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function LandingBlog() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    fetch("/api/blog")
      .then((response) => response.json())
      .then((data) => {
        if (isMounted) {
          setPosts(data.posts ?? []);
        }
      })
      .catch(() => {
        if (isMounted) {
          setPosts([]);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (!(isLoading || posts.length > 0)) {
    return null;
  }

  return (
    <section
      className="flex w-full justify-center bg-white px-6 py-24"
      id="blog"
    >
      <div className="w-full max-w-[1560px]">
        <div className="pb-12" data-reveal="left">
          <h2 className="text-[48px] font-semibold leading-[48px] text-black">
            Latest from our team
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {isLoading
            ? SKELETON_KEYS.map((key, index) => (
                <article
                  className="min-w-0"
                  data-reveal="scale"
                  data-reveal-delay={index + 1}
                  key={key}
                >
                  <div className="aspect-[488/326.35] animate-pulse rounded-[24px] bg-[#f5f5f5]" />
                  <div className="flex flex-col gap-2 pb-4 pr-8 pt-5">
                    <div className="h-6 w-4/5 animate-pulse rounded-full bg-[#f5f5f5]" />
                    <div className="h-5 w-1/3 animate-pulse rounded-full bg-[#f5f5f5]" />
                  </div>
                </article>
              ))
            : posts.map((post, index) => (
                <TrackedExternalLink
                  className="group block min-w-0 text-black no-underline transition duration-200 ease-out hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:ring-offset-2"
                  data-reveal="scale"
                  data-reveal-delay={index + 1}
                  href={post.link}
                  key={post.link}
                  linkText={post.title}
                  source="landing_blog_card"
                  target="_blank"
                >
                  <div className="relative aspect-[488/326.35] overflow-hidden rounded-[24px] bg-[#f5f5f5]">
                    {post.image && (
                      <Image
                        alt={post.title}
                        className="object-cover transition duration-300 ease-out group-hover:scale-[1.04]"
                        fill
                        sizes="(min-width: 1560px) 488px, (min-width: 768px) calc((100vw - 96px) / 3), calc(100vw - 48px)"
                        src={post.image}
                        unoptimized
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-2 pb-4 pr-8 pt-5">
                    <h3 className="line-clamp-2 text-[24px] font-medium leading-6 text-black">
                      {post.title}
                    </h3>
                    <p className="text-[18px] font-normal leading-5 text-[#3c3c43]/60">
                      {formatDate(post.pubDate)}
                    </p>
                  </div>
                </TrackedExternalLink>
              ))}
        </div>
      </div>
    </section>
  );
}
