import Image from "next/image";
import Link from "next/link";

import { formatBlogDate, getBlogPosts } from "@/features/blog";

const LANDING_BLOG_POST_COUNT = 3;

export async function LandingBlog() {
  const { posts } = await getBlogPosts({ perPage: LANDING_BLOG_POST_COUNT });

  if (posts.length === 0) {
    return null;
  }

  return (
    <section
      className="flex w-full justify-center bg-white px-4 py-12 lg:px-6 lg:py-24"
      id="blog"
    >
      <div className="w-full max-w-[560px] lg:max-w-[1560px]">
        <div className="pb-12" data-reveal="left">
          <h2 className="text-[48px] font-semibold leading-[48px] text-black">
            Latest from our team
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {posts.map((post, index) => (
            <Link
              className="group block min-w-0 text-black no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:ring-offset-2"
              data-reveal="scale"
              data-reveal-delay={index + 1}
              href={`/blog/${post.slug}`}
              key={post.slug}
            >
              <div className="relative aspect-[488/326.35] overflow-hidden rounded-[24px] bg-[#f5f5f5]">
                <Image
                  alt=""
                  aria-hidden="true"
                  className="object-cover transition duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.025]"
                  fill
                  sizes="(min-width: 1560px) 488px, (min-width: 1024px) calc((100vw - 96px) / 3), calc(100vw - 48px)"
                  src={post.hero}
                />
                <div className="pointer-events-none absolute inset-0 bg-black/0 transition duration-300 ease-out group-hover:bg-black/[0.04]" />
              </div>

              <div className="flex flex-col gap-2 pb-4 pr-8 pt-5">
                <h3 className="line-clamp-2 text-[24px] font-medium leading-6 text-black">
                  {post.title}
                </h3>
                <time
                  className="text-[18px] font-normal leading-5 text-[#3c3c43]/60"
                  dateTime={post.date}
                >
                  {formatBlogDate(post.date)}
                </time>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
