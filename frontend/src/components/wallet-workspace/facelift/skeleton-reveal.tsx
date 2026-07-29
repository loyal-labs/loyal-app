"use client";

import type { ReactNode } from "react";

import {
  PopDigits,
  type PopDigitsSegment,
} from "@/components/wallet-workspace/facelift/pop-digits";

// transitions.dev "Skeleton loader and reveal"
// (frontend/transitions/skeleton-reveal.md) adapted for inline text slots:
// the content layer sizes the wrap (t-skel-inline), the skeleton bar overlays
// it, and flipping isRevealed cross-fades the two. Mount pop-in content only
// when revealed so its own animation runs together with the reveal.
export function SkeletonReveal({
  children,
  isRevealed,
  skeletonClassName = "rounded-[6px] bg-black/[0.06]",
}: {
  children: ReactNode;
  isRevealed: boolean;
  skeletonClassName?: string;
}) {
  return (
    <span
      className={`t-skel t-skel-inline ${isRevealed ? "is-revealed" : ""}`}
      // The recipe's demo reveals after a fixed pulse count; our fetches have
      // no known duration, so the pulse loops until the reveal lands.
      style={{ ["--pulse-count" as never]: "infinite" }}
    >
      <span aria-hidden="true" className="t-skel-skeleton is-pulsing">
        <span className={`block size-full ${skeletonClassName}`} />
      </span>
      <span className="t-skel-content">{children}</span>
    </span>
  );
}

function PlainSegments({ segments }: { segments: PopDigitsSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.color ? (
          <span key={index} style={{ color: segment.color }}>
            {segment.text}
          </span>
        ) : (
          segment.text
        )
      )}
    </>
  );
}

// One APY-fed text: skeleton until revealed, then (optionally) pop the digits
// once. `isRevealed === undefined` renders the plain text — that keeps shared
// chart components visually unchanged for old-workspace callers that don't
// pass the flag.
export function ApyRevealText({
  isRevealed,
  segments,
  withPop = true,
}: {
  isRevealed: boolean | undefined;
  segments: PopDigitsSegment[];
  withPop?: boolean;
}) {
  if (isRevealed === undefined) {
    return <PlainSegments segments={segments} />;
  }
  return (
    <SkeletonReveal isRevealed={isRevealed}>
      {isRevealed && withPop ? (
        <PopDigits popOnChange={false} segments={segments} />
      ) : (
        <PlainSegments segments={segments} />
      )}
    </SkeletonReveal>
  );
}
