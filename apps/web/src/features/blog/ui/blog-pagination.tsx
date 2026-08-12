import Link from "next/link";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

type PageItem = number | "ellipsis-left" | "ellipsis-right";

/** Link target for a given page (page 1 stays on the clean /blog URL). */
function pageHref(page: number): string {
  return page <= 1 ? "/blog" : `/blog?page=${page}`;
}

/**
 * Windowed page list: always shows the first and last page, the current page
 * and its neighbours, and collapses the gaps into ellipses. Small page counts
 * (<= 7) are shown in full.
 */
function buildPageItems(current: number, total: number): PageItem[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const items: PageItem[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);

  if (left > 2) {
    items.push("ellipsis-left");
  }
  for (let page = left; page <= right; page++) {
    items.push(page);
  }
  if (right < total - 1) {
    items.push("ellipsis-right");
  }
  items.push(total);

  return items;
}

const edgeButtonBase =
  "inline-flex h-12 items-center gap-1.5 rounded-full px-5 text-[16px] font-medium leading-5 transition duration-150 ease-out";
const edgeButtonEnabled =
  "border border-black/10 text-black hover:-translate-y-0.5 hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black active:translate-y-0";
const edgeButtonDisabled =
  "cursor-not-allowed border border-black/5 text-black/30";

function EdgeButton({
  direction,
  page,
  disabled,
}: {
  direction: "prev" | "next";
  page: number;
  disabled: boolean;
}) {
  const label = direction === "prev" ? "Previous" : "Next";
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const icon = <Icon aria-hidden="true" className="size-4" />;
  const text = <span className="hidden sm:inline">{label}</span>;

  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(edgeButtonBase, edgeButtonDisabled)}>
        {direction === "prev" ? (
          <>
            {icon}
            {text}
          </>
        ) : (
          <>
            {text}
            {icon}
          </>
        )}
      </span>
    );
  }

  return (
    <Link
      aria-label={label}
      className={cn(edgeButtonBase, edgeButtonEnabled)}
      href={pageHref(page)}
    >
      {direction === "prev" ? (
        <>
          {icon}
          {text}
        </>
      ) : (
        <>
          {text}
          {icon}
        </>
      )}
    </Link>
  );
}

export function BlogPagination({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const items = buildPageItems(page, totalPages);

  return (
    <nav
      aria-label="Blog pagination"
      className="flex items-center justify-center gap-2"
    >
      <EdgeButton direction="prev" disabled={page <= 1} page={page - 1} />

      <div className="hidden items-center gap-1 sm:flex">
        {items.map((item) => {
          if (item === "ellipsis-left" || item === "ellipsis-right") {
            return (
              <span
                aria-hidden="true"
                className="inline-flex h-12 min-w-[48px] items-center justify-center text-[16px] leading-5 text-black/40"
                key={item}
              >
                …
              </span>
            );
          }

          const isActive = item === page;
          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              aria-label={`Page ${item}`}
              className={cn(
                "inline-flex h-12 min-w-[48px] items-center justify-center rounded-full px-4 text-[16px] font-medium leading-5 transition duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black",
                isActive
                  ? "bg-black text-white"
                  : "text-black hover:-translate-y-0.5 hover:bg-black/[0.04] active:translate-y-0"
              )}
              href={pageHref(item)}
              key={item}
            >
              {item}
            </Link>
          );
        })}
      </div>

      <span className="text-[16px] font-medium leading-5 text-black/60 sm:hidden">
        Page {page} of {totalPages}
      </span>

      <EdgeButton
        direction="next"
        disabled={page >= totalPages}
        page={page + 1}
      />
    </nav>
  );
}
