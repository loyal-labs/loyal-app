import Image from "next/image";
import Link from "next/link";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Resolves a markdown image src against the post folder when it's relative. */
function resolveSrc(slug: string, src: string): string {
  if (/^(https?:)?\/\//.test(src) || src.startsWith("/")) {
    return src;
  }
  return `/blog/${slug}/${src.replace(/^\.\//, "")}`;
}

const linkClass =
  "font-medium underline underline-offset-4 transition-colors hover:text-[#f9363c]";

/**
 * Builds the element→component map that renders markdown into the exact Figma
 * post typography. Vertical rhythm uses padding (mirroring the design's pt/pb),
 * which — unlike margins — stacks additively between adjacent blocks.
 */
function buildComponents(slug: string): Components {
  return {
    h1: ({ children }) => (
      <h2 className="pb-5 pt-16 text-[32px] font-semibold leading-tight tracking-[-0.64px] text-black md:text-[48px] md:leading-none md:tracking-[-0.96px]">
        {children}
      </h2>
    ),
    h2: ({ children }) => (
      <h2 className="pb-5 pt-16 text-[32px] font-semibold leading-tight tracking-[-0.64px] text-black md:text-[48px] md:leading-none md:tracking-[-0.96px]">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="pb-2 pt-10 text-[26px] font-semibold leading-tight tracking-[-0.52px] text-black md:text-[32px] md:tracking-[-0.64px]">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="pt-7 text-[22px] font-semibold leading-[1.4] tracking-[-0.24px] text-black md:text-[24px]">
        {children}
      </h4>
    ),
    p: ({ node, children }) => {
      // Markdown wraps a standalone image in a <p>; render the figure on its
      // own instead (a <figure> inside a <p> is invalid HTML).
      const only = node?.children?.length === 1 ? node.children[0] : undefined;
      if (only && only.type === "element" && only.tagName === "img") {
        return <>{children}</>;
      }
      return (
        <p className="pt-5 text-[18px] leading-[1.4] tracking-[-0.2px] text-black md:text-[20px]">
          {children}
        </p>
      );
    },
    ul: ({ children }) => (
      <ul className="list-disc py-5 ps-[26px] text-[18px] leading-[1.4] tracking-[-0.4px] text-black marker:text-black md:text-[20px] [&_p]:pt-0">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal py-5 ps-[26px] text-[18px] leading-[1.4] tracking-[-0.4px] text-black marker:text-black md:text-[20px] [&_p]:pt-0">
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="mb-5 ps-1 last:mb-0">{children}</li>
    ),
    blockquote: ({ children }) => (
      <blockquote className="flex gap-5 py-5">
        <span
          aria-hidden="true"
          className="w-[3px] shrink-0 self-stretch rounded-full bg-[#f9363c]"
        />
        <div className="font-[family-name:var(--font-ibm-plex-sans)] text-[18px] italic leading-[1.4] tracking-[-0.2px] text-black md:text-[20px] [&_p]:p-0">
          {children}
        </div>
      </blockquote>
    ),
    a: ({ href, children }) => {
      const url = href ?? "";
      if (url.startsWith("/") || url.startsWith("#")) {
        return (
          <Link className={linkClass} href={url}>
            {children}
          </Link>
        );
      }
      return (
        <a
          className={linkClass}
          href={url}
          rel="noopener noreferrer"
          target="_blank"
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt, title }) => {
      if (typeof src !== "string" || src.length === 0) {
        return null;
      }
      return (
        <figure className="flex flex-col gap-4 py-8">
          <Image
            alt={alt ?? ""}
            className="h-auto w-full rounded-[24px]"
            height={0}
            sizes="(min-width: 768px) 768px, 100vw"
            src={resolveSrc(slug, src)}
            width={0}
          />
          {title ? (
            <figcaption className="text-center text-[16px] leading-[1.4] tracking-[-0.16px] text-black/60">
              {title}
            </figcaption>
          ) : null}
        </figure>
      );
    },
    strong: ({ children }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    hr: () => <hr className="my-10 border-t border-black/10" />,
    code: ({ className, children }) => {
      const text = Array.isArray(children) ? children.join("") : String(children ?? "");
      const isBlock = /language-/.test(className ?? "") || text.includes("\n");
      if (isBlock) {
        return <code className={className}>{children}</code>;
      }
      return (
        <code className="rounded-[6px] bg-black/[0.06] px-1.5 py-0.5 font-mono text-[0.875em]">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="my-6 overflow-x-auto rounded-[16px] bg-[#0f0f0f] p-5 font-mono text-[15px] leading-[1.6] text-white">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="my-6 overflow-x-auto">
        <table className="w-full border-collapse text-[16px] md:text-[18px]">
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-black/10 px-3 py-2 text-left font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-black/5 px-3 py-2 align-top">{children}</td>
    ),
  };
}

export function BlogContent({
  slug,
  content,
}: {
  slug: string;
  content: string;
}) {
  return (
    <div className="[&>*:first-child]:pt-0">
      <Markdown components={buildComponents(slug)} remarkPlugins={[remarkGfm]}>
        {content}
      </Markdown>
    </div>
  );
}
