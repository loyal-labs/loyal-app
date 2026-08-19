"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { RebalanceRouteMode } from "./rebalance-data";

export function RouteModeSwitch({
  id,
  mode,
  onModeChange,
}: {
  id: string;
  mode: RebalanceRouteMode;
  onModeChange: (mode: RebalanceRouteMode) => void;
}) {
  return (
    <div
      aria-label="Rebalance route"
      className="inline-flex shrink-0 items-center rounded-lg bg-muted p-1"
      role="group"
    >
      <Button
        aria-label="Show same-mint monitoring"
        aria-pressed={mode === "same_mint"}
        className={cn(
          "h-7 rounded-md px-2.5 text-xs shadow-none",
          mode === "same_mint"
            ? "bg-background text-foreground shadow-xs hover:bg-background"
            : "text-muted-foreground"
        )}
        id={`${id}-same-mint`}
        onClick={() => onModeChange("same_mint")}
        size="sm"
        type="button"
        variant="ghost"
      >
        Same-mint
      </Button>
      <Button
        aria-label="Show Crossmint monitoring"
        aria-pressed={mode === "cross_mint"}
        className={cn(
          "h-7 rounded-md px-2.5 text-xs shadow-none",
          mode === "cross_mint"
            ? "bg-background text-foreground shadow-xs hover:bg-background"
            : "text-muted-foreground"
        )}
        id={id}
        onClick={() => onModeChange("cross_mint")}
        size="sm"
        type="button"
        variant="ghost"
      >
        Crossmint
      </Button>
    </div>
  );
}
