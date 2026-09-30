"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/** Re-runs the server component every minute; the page itself is static. */
export function EarnMaxRefresh() {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(timer);
  }, [router]);

  return null;
}

type Unit = "pct" | "usd";

function formatValue(value: unknown, unit: Unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return unit === "usd"
    ? `$${n.toLocaleString("en-US", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      })}`
    : `${n.toFixed(2)}%`;
}

function formatTime(value: unknown, withMinutes: boolean) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: withMinutes ? "2-digit" : undefined,
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

export function TimeChart({
  data,
  label,
  unit,
}: {
  data: Array<{ at: string; value: number | null }>;
  label: string;
  unit: Unit;
}) {
  const config = {
    value: { color: "var(--foreground)", label },
  } satisfies ChartConfig;

  return (
    <ChartContainer
      className="aspect-auto h-[180px] w-full min-w-0"
      config={config}
    >
      <AreaChart data={data} margin={{ bottom: 0, left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="at"
          minTickGap={48}
          tickFormatter={(value) => formatTime(value, false)}
          tickLine={false}
        />
        <YAxis
          axisLine={false}
          domain={["auto", "auto"]}
          tickFormatter={(value) => formatValue(value, unit)}
          tickLine={false}
          width={unit === "usd" ? 76 : 52}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => `${formatTime(value, true)} UTC`}
              valueFormatter={(value) => formatValue(value, unit)}
            />
          }
        />
        <Area
          connectNulls
          dataKey="value"
          dot={false}
          fill="var(--color-value)"
          fillOpacity={0.08}
          isAnimationActive={false}
          stroke="var(--color-value)"
          strokeWidth={1.5}
          type="monotone"
        />
      </AreaChart>
    </ChartContainer>
  );
}
