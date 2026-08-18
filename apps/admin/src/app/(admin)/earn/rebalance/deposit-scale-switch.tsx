"use client";

import { Switch } from "@/components/ui/switch";

export type DepositScale = "linear" | "log";

/**
 * Log/linear switch for the deposit axis, shared by the Earn rebalance scatter
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
  const isLog = scale === "log";

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={
          isLog ? "text-muted-foreground" : "font-medium text-foreground"
        }
      >
        Linear scale
      </span>
      <Switch
        aria-label="Use a logarithmic deposit axis"
        checked={isLog}
        id={id}
        onCheckedChange={(checked) => onScaleChange(checked ? "log" : "linear")}
      />
      <span
        className={
          isLog ? "font-medium text-foreground" : "text-muted-foreground"
        }
      >
        Log scale
      </span>
    </div>
  );
}
