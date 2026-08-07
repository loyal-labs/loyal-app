"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  ApprovalReviewCollapsible,
  ApprovalReviewDisplayRow,
  ApprovalReviewPage,
} from "@/components/wallet-sidebar/approval-review-content";
import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
import type { PendingEarnApproval } from "@/components/wallet-workspace/facelift/use-earn-actions";

const MONO_FONT = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";

function isAddressLikeValue(value: string): boolean {
  return value.length > 24 && !value.includes(" ");
}

function ReviewRow({ row }: { row: ApprovalReviewDisplayRow }) {
  const isAddressLike = isAddressLikeValue(row.value);
  return (
    <div className="px-3 py-[9px]">
      <p className="text-[13px] leading-4 text-muted-foreground">
        {row.label}
      </p>
      <p
        className={`mt-0.5 break-words text-foreground ${
          isAddressLike ? "text-[13px] leading-[18px]" : "text-[16px] leading-5"
        }`}
        style={isAddressLike ? { fontFamily: MONO_FONT } : undefined}
      >
        {row.value}
      </p>
    </div>
  );
}

function CollapsibleRows({
  collapsible,
}: {
  collapsible: ApprovalReviewCollapsible;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl bg-accent">
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-[13px] text-left font-medium text-[14px] text-foreground leading-5"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span>{collapsible.title}</span>
        {isOpen ? (
          <ChevronUp className="shrink-0 text-muted-foreground" size={16} />
        ) : (
          <ChevronDown
            className="shrink-0 text-muted-foreground"
            size={16}
          />
        )}
      </button>
      {isOpen ? (
        <div className="flex flex-col pb-1">
          {collapsible.rows.map((row) => (
            <ReviewRow key={row.label} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// The OG approval review restyled for the facelift (Figma 4813:413106): a
// 400px right card on the dark scrim with a close button, the paged review
// content, and the Reject/Approve pair. The mascot's speech bubble renders as
// a quiet caption above the buttons instead.
function ApprovalBody({ approval }: { approval: PendingEarnApproval }) {
  const { item } = approval;
  const pages: ApprovalReviewPage[] =
    item.pages && item.pages.length > 0
      ? item.pages
      : [
          {
            amount: item.amount,
            heading: item.summaryLabel ?? item.title,
            rows: item.reviewRows,
            symbol: item.symbol,
            title: item.title,
          },
        ];
  const [pageIndex, setPageIndex] = useState(0);
  useEffect(() => {
    setPageIndex(0);
  }, [item]);
  const safeIndex = Math.min(pageIndex, pages.length - 1);
  const page = pages[safeIndex];
  const isFirst = safeIndex === 0;
  const isLast = safeIndex >= pages.length - 1;
  const secondaryLabel = item.secondaryActionLabel ?? "Reject";
  const primaryLabel = item.primaryActionLabel ?? "Approve";

  return (
    <>
      <header className="flex w-full shrink-0 items-center justify-end p-2">
        <button
          aria-label="Close"
          className="t-hover flex size-11 items-center justify-center rounded-full hover:bg-accent"
          onClick={approval.reject}
          type="button"
        >
          <X className="text-foreground" size={24} />
        </button>
      </header>

      <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4">
        <div className="flex w-full flex-col gap-1 px-2 pt-6 pb-6">
          {page.amount ? (
            <p className="flex items-baseline gap-2 whitespace-nowrap font-semibold">
              <span className="text-[40px] text-foreground leading-[48px]">
                {page.amount}
              </span>
              {page.symbol ? (
                <span className="text-[28px] leading-8 tracking-[0.4px] text-tertiary">
                  {page.symbol}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="font-semibold text-[24px] text-foreground leading-[30px]">
              {page.heading}
            </p>
          )}
          {page.amount && !page.hideAmountHeading ? (
            <p className="text-[16px] leading-5 text-muted-foreground">
              {page.heading}
            </p>
          ) : null}
          {page.subheading ? (
            <p className="text-[14px] leading-[19px] text-muted-foreground">
              {page.subheading}
            </p>
          ) : null}
        </div>

        <div className="flex w-full flex-col gap-2">
          {page.rows && page.rows.length > 0 ? (
            <div className="flex w-full flex-col rounded-2xl bg-accent py-1">
              {page.rows.map((row) => (
                <ReviewRow key={row.label} row={row} />
              ))}
            </div>
          ) : null}
          {page.collapsibles?.map((collapsible) => (
            <CollapsibleRows collapsible={collapsible} key={collapsible.title} />
          ))}
        </div>
      </div>

      {page.mascotNote ? (
        <p className="w-full shrink-0 px-6 pt-3 pb-1 text-[13px] leading-4 text-muted-foreground">
          {page.mascotNote}
        </p>
      ) : null}

      <div className="flex w-full shrink-0 gap-2 px-4 pt-2 pb-4">
        <button
          className="t-hover flex h-12 flex-1 items-center justify-center rounded-full bg-accent font-medium text-[16px] text-foreground leading-5 hover:bg-accent-active"
          onClick={
            isFirst
              ? approval.reject
              : () => setPageIndex((current) => Math.max(0, current - 1))
          }
          type="button"
        >
          {isFirst ? secondaryLabel : "Back"}
        </button>
        <button
          className="t-hover flex h-12 flex-1 items-center justify-center rounded-full bg-foreground font-medium text-[16px] text-background leading-5 hover:-translate-y-0.5 hover:bg-foreground/90 active:translate-y-0"
          onClick={
            isLast
              ? approval.approve
              : () =>
                  setPageIndex((current) =>
                    Math.min(pages.length - 1, current + 1)
                  )
          }
          type="button"
        >
          {isLast ? primaryLabel : "Continue"}
        </button>
      </div>
    </>
  );
}

export function EarnApprovalSheet({
  approval,
}: {
  approval: PendingEarnApproval | null;
}) {
  // Keeps the last approval rendered through the sheet's close animation so
  // resolving doesn't slide out an empty card (same as the activity detail).
  const lastApprovalRef = useRef<PendingEarnApproval | null>(null);
  if (approval) {
    lastApprovalRef.current = approval;
  }
  const sheetApproval = approval ?? lastApprovalRef.current;

  return (
    <SheetReveal
      isOpen={approval !== null}
      onClose={() => approval?.reject()}
      scrimClassName="fixed inset-0 z-50 flex bg-black/20 p-2 backdrop-blur-[4px] max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8"
      sheetClassName="ml-auto flex h-full w-[400px] min-w-0 flex-col overflow-clip rounded-3xl bg-card max-[795px]:w-full max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
    >
      {sheetApproval ? <ApprovalBody approval={sheetApproval} /> : null}
    </SheetReveal>
  );
}
