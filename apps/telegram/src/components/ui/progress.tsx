import * as React from "react";

import { cn } from "@/lib/utils";

export interface ProgressProps
  extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-slate-800/80",
        className,
      )}
      {...props}
    >
      <div
        className="h-full bg-gradient-to-r from-slate-100 via-slate-200 to-slate-50 transition-all duration-300 ease-out dark:from-slate-300 dark:via-white dark:to-slate-200"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  ),
);
Progress.displayName = "Progress";
