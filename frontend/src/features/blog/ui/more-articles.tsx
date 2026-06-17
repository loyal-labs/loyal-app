import type { BlogPost } from "../types";
import { BlogCard } from "./blog-card";

export function MoreArticles({ posts }: { posts: BlogPost[] }) {
  if (posts.length === 0) {
    return null;
  }

  return (
    <section className="flex w-full justify-center bg-white">
      <div className="w-full max-w-[1560px] px-6 pb-24 pt-16 lg:pt-24">
        <h2
          className="text-[32px] font-semibold leading-none tracking-[-0.64px] text-black md:text-[40px] md:tracking-[-0.8px] lg:text-[48px] lg:tracking-[-0.96px]"
          data-reveal="left"
        >
          More articles
        </h2>
        <div className="mt-12 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, index) => (
            <div
              data-reveal="scale"
              data-reveal-delay={(index % 3) + 1}
              key={post.slug}
            >
              <BlogCard post={post} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
