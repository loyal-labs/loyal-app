"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DepositScale = "linear" | "log";

/**
 * Log/linear selector for the deposit axis, shared by the Earn rebalance scatter
 * charts. Both ends are labelled because neither reading is the obvious
 * default: log is right for the fleet's long dust tail, linear is right when
 * you care about absolute size.
 */
export function DepositScaleSwitch({
  id,
  onScaleChange,
  scale,
}: {
  id: string;
  onScaleChange: (scale: DepositScale) => void;
  scale: DepositScale;
}) {
  return (
    <div
      aria-label="Deposit axis scale"
      className="inline-flex w-fit shrink-0 self-start rounded-lg bg-muted p-1"
      role="group"
    >
      <Button
        aria-label="Use a linear deposit axis"
        aria-pressed={scale === "linear"}
        className={cn(
          "h-7 rounded-md px-2.5 text-xs shadow-none",
          scale === "linear"
            ? "bg-background text-foreground shadow-xs hover:bg-background"
            : "text-muted-foreground"
        )}
        id={`${id}-linear`}
        onClick={() => onScaleChange("linear")}
        size="sm"
        type="button"
        variant="ghost"
      >
        Linear
      </Button>
      <Button
        aria-label="Use a logarithmic deposit axis"
        aria-pressed={scale === "log"}
        className={cn(
          "h-7 rounded-md px-2.5 text-xs shadow-none",
          scale === "log"
            ? "bg-background text-foreground shadow-xs hover:bg-background"
            : "text-muted-foreground"
        )}
        id={id}
        onClick={() => onScaleChange("log")}
        size="sm"
        type="button"
        variant="ghost"
      >
        Log
      </Button>
    </div>
  );
}
