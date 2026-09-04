import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = {
  default:
    "border-transparent bg-slate-100 text-slate-900 hover:bg-slate-100/80",
  secondary:
    "border-transparent bg-slate-800 text-slate-100 hover:bg-slate-800/80",
  outline:
    "border border-slate-700 text-slate-200 hover:bg-slate-800/50",
} as const;

export type BadgeVariant = keyof typeof badgeVariants;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex h-7 items-center rounded-full px-3 text-xs font-medium uppercase tracking-[0.18em]",
        badgeVariants[variant],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";
