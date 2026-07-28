"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";

const ASSET_BASE = "/wallet-workspace/facelift";
const CLIP_PADDING_PX = 8;

// The bubble is centered on the trigger; when that would cross the nearest
// clipping ancestor (scroll panes, overflow-clip cards), --tt-shift nudges it
// just enough to fit. Measured from layout widths (offsetWidth + wrap rect),
// not the bubble's rect, so the resting scale transform can't skew it.
function clampTooltipShift(wrap: HTMLElement, bubble: HTMLElement) {
  let clipLeft = 0;
  let clipRight = window.innerWidth;
  for (
    let ancestor = wrap.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    const overflow = style.overflow + style.overflowX + style.overflowY;
    if (/(auto|scroll|hidden|clip)/.test(overflow)) {
      const rect = ancestor.getBoundingClientRect();
      clipLeft = rect.left;
      clipRight = rect.right;
      break;
    }
  }

  const wrapRect = wrap.getBoundingClientRect();
  const width = bubble.offsetWidth;
  const centeredLeft = wrapRect.left + wrapRect.width / 2 - width / 2;
  const centeredRight = centeredLeft + width;
  let shift = 0;
  if (centeredLeft < clipLeft + CLIP_PADDING_PX) {
    shift = clipLeft + CLIP_PADDING_PX - centeredLeft;
  } else if (centeredRight > clipRight - CLIP_PADDING_PX) {
    shift = clipRight - CLIP_PADDING_PX - centeredRight;
  }
  bubble.style.setProperty("--tt-shift", `${Math.round(shift)}px`);
}

// transitions.dev "Tooltip open/close" (frontend/transitions/tooltip.md):
// pure CSS — the wrap is the hover target, keyboard focus on the trigger
// also shows the bubble. The trigger is a no-op button so it's focusable.
export function InfoTooltip({
  iconClassName = "size-5",
  placement = "top",
  text,
}: {
  iconClassName?: string;
  placement?: "top" | "bottom";
  text: string;
}) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const bubble = bubbleRef.current;
    if (wrap && bubble) {
      clampTooltipShift(wrap, bubble);
    }
  }, [text]);

  useEffect(() => {
    const handleResize = () => {
      const wrap = wrapRef.current;
      const bubble = bubbleRef.current;
      if (wrap && bubble) {
        clampTooltipShift(wrap, bubble);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <span className="t-tt-wrap" ref={wrapRef}>
      <button
        aria-describedby={id}
        aria-label="More info"
        className="t-tt-trigger flex cursor-help items-center justify-center"
        type="button"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          className={iconClassName}
          src={`${ASSET_BASE}/icon-question.svg`}
        />
      </button>
      <span
        className={`t-tt text-[13px] leading-4 ${
          placement === "bottom" ? "t-tt-bottom" : ""
        }`}
        id={id}
        ref={bubbleRef}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
}
