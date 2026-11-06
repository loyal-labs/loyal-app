"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { dateTime, pct, shortDate, usd } from "./format";

/** Re-runs the server page every minute; the data itself is cached 60 s. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}

type Unit = "pct" | "usd";

const formatValue = (value: unknown, unit: Unit) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return unit === "usd" ? usd(n) : pct(n);
};

export function TimeChart({
  data,
  label,
  unit,
}: {
  data: Array<{ at: string; value: number | null }>;
  label: string;
  unit: Unit;
}) {
  return (
    <div className="h-[180px] w-full min-w-0">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart
          data={data}
          margin={{ bottom: 0, left: 4, right: 8, top: 8 }}
        >
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="at"
            minTickGap={48}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={shortDate}
            tickLine={false}
          />
          <YAxis
            axisLine={false}
            domain={["auto", "auto"]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={(value) => formatValue(value, unit)}
            tickLine={false}
            width={unit === "usd" ? 84 : 56}
          />
          <Tooltip
            content={({ active, label: at, payload }) =>
              active && payload?.length ? (
                <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-sm">
                  <p className="text-muted-foreground">
                    {dateTime(String(at))}
                  </p>
                  <p className="font-mono tabular-nums">
                    {label} {formatValue(payload[0].value, unit)}
                  </p>
                </div>
              ) : null
            }
            cursor={{ stroke: "var(--border)" }}
          />
          <Area
            connectNulls
            dataKey="value"
            dot={false}
            fill="var(--foreground)"
            fillOpacity={0.06}
            isAnimationActive={false}
            stroke="var(--foreground)"
            strokeWidth={1.5}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
