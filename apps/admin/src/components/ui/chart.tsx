"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

export type ChartConfig = {
  [key: string]: {
    label?: string;
    color?: string;
  };
};

type ChartContextValue = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextValue | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within ChartContainer");
  }
  return context;
}

type ChartContainerProps = React.ComponentProps<"div"> & {
  config: ChartConfig;
};

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const styles = Object.entries(config)
    .filter(([, item]) => Boolean(item.color))
    .map(([key, item]) => `  --color-${key}: ${item.color};`)
    .join("\n");

  if (!styles) return null;

  return (
    <style
      // This is scoped to a single chart container via data-chart.
      dangerouslySetInnerHTML={{
        __html: `[data-chart="${id}"] {\n${styles}\n}`,
      }}
    />
  );
}

const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  ({ id, className, children, config, ...props }, ref) => {
    const uniqueId = React.useId().replace(/:/g, "");
    const chartId = `chart-${id ?? uniqueId}`;

    return (
      <ChartContext.Provider value={{ config }}>
        <div
          ref={ref}
          data-chart={chartId}
          className={cn(
            "flex justify-center text-xs",
            "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
            "[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50",
            "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border",
            "[&_.recharts-layer]:outline-none",
            "[&_.recharts-sector[stroke='#fff']]:stroke-transparent",
            "[&_.recharts-dot[stroke='#fff']]:stroke-transparent",
            className,
          )}
          {...props}
        >
          <ChartStyle id={chartId} config={config} />
          <RechartsPrimitive.ResponsiveContainer>
            {children as React.ComponentProps<
              typeof RechartsPrimitive.ResponsiveContainer
            >["children"]}
          </RechartsPrimitive.ResponsiveContainer>
        </div>
      </ChartContext.Provider>
    );
  },
);
ChartContainer.displayName = "ChartContainer";

const ChartTooltip = RechartsPrimitive.Tooltip;

type TooltipPayloadItem = {
  color?: string;
  dataKey?: string;
  name?: string;
  value?: number | string;
};

type ChartTooltipContentProps = React.ComponentProps<"div"> &
  React.ComponentProps<typeof RechartsPrimitive.Tooltip> & {
    hideLabel?: boolean;
    nameKey?: string;
    labelFormatter?: (value: unknown) => React.ReactNode;
  };

const ChartTooltipContent = React.forwardRef<HTMLDivElement, ChartTooltipContentProps>(
  (
    { active, payload, className, hideLabel = false, label, labelFormatter, nameKey: _nameKey },
    ref,
  ) => {
    const { config } = useChart();

    if (!active || !payload?.length) {
      return null;
    }

    const renderedLabel = hideLabel
      ? null
      : labelFormatter
        ? labelFormatter(label)
        : label;

    return (
      <div
        ref={ref}
        className={cn(
          "grid min-w-[8rem] gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs shadow-xl",
          className,
        )}
      >
        {renderedLabel ? <div className="font-medium text-foreground">{renderedLabel}</div> : null}
        <div className="grid gap-1">
          {payload.map((item, index) => {
            const payloadItem = item as unknown as TooltipPayloadItem;
            const seriesKey = payloadItem.dataKey ?? "";
            const seriesConfig = config[seriesKey];
            const seriesLabel = seriesConfig?.label ?? payloadItem.name ?? seriesKey;
            const seriesColor = payloadItem.color ?? `var(--color-${seriesKey})`;

            return (
              <div key={`${seriesKey}-${index}`} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-[2px]"
                    style={{ backgroundColor: seriesColor }}
                    aria-hidden
                  />
                  <span className="text-muted-foreground">{seriesLabel}</span>
                </div>
                <span className="font-mono font-medium tabular-nums text-foreground">
                  {typeof payloadItem.value === "number"
                    ? payloadItem.value.toLocaleString()
                    : payloadItem.value}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
ChartTooltipContent.displayName = "ChartTooltipContent";

export { ChartContainer, ChartTooltip, ChartTooltipContent };
