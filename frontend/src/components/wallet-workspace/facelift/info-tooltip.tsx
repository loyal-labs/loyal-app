"use client";

import { useId } from "react";

const ASSET_BASE = "/wallet-workspace/facelift";

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
  return (
    <span className="t-tt-wrap">
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
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
}
