import Image from "next/image";
import Link from "next/link";

import { formatBlogDate } from "../format";
import type { BlogPost } from "../types";

export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <Link
      className="group block min-w-0 text-black no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:ring-offset-2"
      href={`/blog/${post.slug}`}
    >
      <div className="relative aspect-[1280/856] overflow-hidden rounded-[24px] border border-black/[0.08] bg-[#f5f5f5]">
        <Image
          alt=""
          aria-hidden="true"
          className="object-cover transition duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.025]"
          fill
          sizes="(min-width: 1560px) 488px, (min-width: 1024px) calc((100vw - 96px) / 3), (min-width: 640px) calc((100vw - 60px) / 2), calc(100vw - 48px)"
          src={post.hero}
        />
        <div className="pointer-events-none absolute inset-0 bg-black/0 transition duration-300 ease-out group-hover:bg-black/[0.04]" />
      </div>

      <div className="flex flex-col gap-2 pb-4 pr-8 pt-5">
        <h2 className="line-clamp-2 text-[24px] font-medium leading-6 text-black">
          {post.title}
        </h2>
        <time
          className="text-[18px] font-normal leading-5 text-[#3c3c43]/60"
          dateTime={post.date}
        >
          {formatBlogDate(post.date)}
        </time>
      </div>
    </Link>
  );
}
