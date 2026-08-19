"use client";

import { Switch } from "@/components/ui/switch";

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
  const isCrossMint = mode === "cross_mint";

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={
          isCrossMint ? "text-muted-foreground" : "font-medium text-foreground"
        }
      >
        Same-mint
      </span>
      <Switch
        aria-label="Show Crossmint monitoring"
        checked={isCrossMint}
        id={id}
        onCheckedChange={(checked) =>
          onModeChange(checked ? "cross_mint" : "same_mint")
        }
      />
      <span
        className={
          isCrossMint ? "font-medium text-foreground" : "text-muted-foreground"
        }
      >
        Crossmint
      </span>
    </div>
  );
}
