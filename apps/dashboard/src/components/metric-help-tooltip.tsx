"use client";

import { CircleHelp } from "lucide-react";
import { useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function MetricHelpTooltip({
  ariaLabel,
  tooltip,
}: {
  ariaLabel: string;
  tooltip: string;
}) {
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  return (
    <Tooltip open={isTooltipOpen}>
      <TooltipTrigger asChild>
        <button
          aria-label={ariaLabel}
          className={[
            "inline-flex size-5 flex-none cursor-help items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground transition-[color,transform]",
            "hover:-translate-y-px hover:text-foreground",
            "focus-visible:-translate-y-px focus-visible:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            isHighlighted ? "-translate-y-px text-foreground" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onBlur={() => {
            setIsHighlighted(false);
            setIsTooltipOpen(false);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onFocus={() => {
            setIsHighlighted(true);
            setIsTooltipOpen(true);
          }}
          onMouseEnter={() => {
            setIsHighlighted(true);
            setIsTooltipOpen(true);
          }}
          onMouseLeave={() => {
            setIsHighlighted(false);
            setIsTooltipOpen(false);
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsTooltipOpen(true);
          }}
          type="button"
        >
          <CircleHelp aria-hidden="true" size={18} strokeWidth={2.1} />
        </button>
      </TooltipTrigger>
      <TooltipContent
        className="max-w-[280px] text-left leading-[18px]"
        side="top"
        sideOffset={8}
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
