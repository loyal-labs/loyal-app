"use client";

import { type ReactNode, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** A disabled native button cannot receive focus or touch; its wrapper can. */
export function PendingWithdrawalTooltip({
  children,
  className,
  pending,
}: {
  children: ReactNode;
  className?: string;
  pending: boolean;
}) {
  return pending ? (
    <PendingTooltip className={className}>{children}</PendingTooltip>
  ) : children;
}

function PendingTooltip({ children, className }: {
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip onOpenChange={setOpen} open={open}>
      <TooltipTrigger asChild>
        <span
          aria-label="Withdraw unavailable"
          className={`inline-flex cursor-help rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${className ?? ""}`}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          role="group"
          tabIndex={0}
        >
          <span className="pointer-events-none flex w-full">{children}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 rounded-xl px-3 py-2 text-[13px] leading-4" sideOffset={6}>
        Finish your current withdrawal before requesting another.
      </TooltipContent>
    </Tooltip>
  );
}
