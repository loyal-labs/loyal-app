"use client";

import { useMemo, useState } from "react";

export type WeeklyChartPoint = {
  label: string;
  periodLabel: string;
  value: number;
  valueRaw: string;
};

type ChartPoint = WeeklyChartPoint & {
  barHeight: number;
  barWidth: number;
  centerX: number;
  height: number;
  index: number;
  x: number;
  y: number;
};

const chartWidth = 1120;
const chartHeight = 560;
const chartPadding = {
  top: 58,
  right: 42,
  bottom: 86,
  left: 108,
};
const tooltipWidth = 238;
const tooltipHeight = 94;

function formatCurrencyTick(value: number) {
  if (value === 0) {
    return "$0";
  }

  if (value >= 1_000_000) {
    return `$${value / 1_000_000}M`;
  }

  if (value >= 1_000) {
    return `$${value / 1_000}K`;
  }

  return `$${value}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatCompactCurrency(value: number) {
  if (value === 0) {
    return "$0";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
    notation: "compact",
    style: "currency",
  }).format(value);
}

function formatChange(value: number) {
  if (value === 0) {
    return "$0.00";
  }

  const absolute = formatCurrency(Math.abs(value));
  return value > 0 ? `+${absolute}` : `-${absolute}`;
}

function getNiceChartMax(value: number) {
  if (value <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

  return niceNormalized * magnitude;
}

function getChartTicks(maxValue: number) {
  return Array.from({ length: 5 }, (_, index) => (maxValue / 4) * index);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getChartPoints(points: WeeklyChartPoint[], maxValue: number) {
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const baseline = chartPadding.top + plotHeight;
  const slotWidth = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.min(92, Math.max(32, slotWidth * 0.64));

  return points.map((point, index) => {
    const rawHeight = (Math.min(point.value, maxValue) / maxValue) * plotHeight;
    const barHeight = point.value > 0 ? Math.max(rawHeight, 2) : 0;
    const x = chartPadding.left + index * slotWidth + (slotWidth - barWidth) / 2;
    const y = baseline - barHeight;

    return {
      ...point,
      barHeight,
      barWidth,
      centerX: x + barWidth / 2,
      height: barHeight,
      index,
      x,
      y,
    };
  });
}

function getTooltipPosition(point: ChartPoint) {
  const maxX = chartWidth - chartPadding.right - tooltipWidth;
  const x = clamp(point.centerX - tooltipWidth / 2, chartPadding.left, maxX);
  const preferredY = point.y - tooltipHeight - 14;
  const y =
    preferredY >= chartPadding.top
      ? preferredY
      : point.y + Math.min(point.height + 18, 44);

  return { x, y };
}

export function EarnAumBarChart({
  ariaLabel,
  metricLabel,
  points,
}: {
  ariaLabel: string;
  metricLabel: string;
  points: WeeklyChartPoint[];
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chartMaxValue = useMemo(
    () => getNiceChartMax(Math.max(...points.map((point) => point.value), 0)),
    [points]
  );
  const chartTicks = useMemo(() => getChartTicks(chartMaxValue), [chartMaxValue]);
  const chartPoints = useMemo(
    () => getChartPoints(points, chartMaxValue),
    [chartMaxValue, points]
  );
  const activePoint =
    activeIndex === null ? null : chartPoints[activeIndex] ?? null;
  const previousPoint =
    activeIndex === null ? null : chartPoints[activeIndex - 1] ?? null;
  const weeklyChange =
    activePoint && previousPoint ? activePoint.value - previousPoint.value : null;
  const tooltipPosition = activePoint ? getTooltipPosition(activePoint) : null;
  const baseline =
    chartHeight - chartPadding.bottom;

  return (
    <div className="mt-6">
      <svg
        aria-label={ariaLabel}
        className="h-auto w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        {chartTicks.map((tick) => {
          const plotHeight =
            chartHeight - chartPadding.top - chartPadding.bottom;
          const y =
            chartPadding.top +
            plotHeight -
            (tick / chartMaxValue) * plotHeight;

          return (
            <g key={tick}>
              <line
                stroke="#dce3ea"
                strokeDasharray="7 9"
                strokeWidth="1.5"
                x1={chartPadding.left}
                x2={chartWidth - chartPadding.right}
                y1={y}
                y2={y}
              />
              <text
                fill="#6f7782"
                fontSize="20"
                textAnchor="end"
                x={chartPadding.left - 18}
                y={y + 7}
              >
                {formatCurrencyTick(tick)}
              </text>
            </g>
          );
        })}

        {chartPoints.map((point, index) => {
          const active = index === activeIndex;

          return (
            <g key={point.label}>
              <rect
                fill={active ? "#f9363c" : "#0b0d0f"}
                height={point.barHeight}
                rx="7"
                x={point.x}
                y={point.y}
                width={point.barWidth}
              />
              {point.value > 0 ? (
                <text
                  fill={active ? "#f9363c" : "#101418"}
                  fontSize="18"
                  fontWeight="650"
                  textAnchor="middle"
                  x={point.centerX}
                  y={Math.max(chartPadding.top - 18, point.y - 14)}
                >
                  {formatCompactCurrency(point.value)}
                </text>
              ) : null}
              <rect
                aria-label={`${point.periodLabel}: ${formatCurrency(point.value)} ${metricLabel}`}
                fill="transparent"
                height={baseline - chartPadding.top}
                onBlur={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(index)}
                onPointerEnter={() => setActiveIndex(index)}
                onPointerLeave={() => setActiveIndex(null)}
                onPointerMove={() => setActiveIndex(index)}
                role="button"
                tabIndex={0}
                x={point.x - 10}
                y={chartPadding.top}
                width={point.barWidth + 20}
              />
              <text
                fill="#6f7782"
                fontSize="18"
                textAnchor="middle"
                x={point.centerX}
                y={chartHeight - 24}
              >
                {point.label}
              </text>
            </g>
          );
        })}

        {activePoint && tooltipPosition ? (
          <g pointerEvents="none">
            <line
              stroke="#f9363c"
              strokeDasharray="4 6"
              strokeWidth="1.5"
              x1={activePoint.centerX}
              x2={activePoint.centerX}
              y1={chartPadding.top}
              y2={baseline}
            />
            <circle
              cx={activePoint.centerX}
              cy={activePoint.y}
              fill="#ffffff"
              r="5"
              stroke="#f9363c"
              strokeWidth="3"
            />
            <rect
              fill="#101418"
              height={tooltipHeight}
              rx="8"
              width={tooltipWidth}
              x={tooltipPosition.x}
              y={tooltipPosition.y}
            />
            <text
              fill="#cdd4dc"
              fontSize="15"
              x={tooltipPosition.x + 16}
              y={tooltipPosition.y + 25}
            >
              {activePoint.periodLabel}
            </text>
            <text
              fill="#ffffff"
              fontSize="24"
              fontWeight="700"
              x={tooltipPosition.x + 16}
              y={tooltipPosition.y + 56}
            >
              {formatCurrency(activePoint.value)}
            </text>
            <text
              fill={
                weeklyChange === null || weeklyChange >= 0
                  ? "#8ff0c0"
                  : "#ffb0b0"
              }
              fontSize="15"
              x={tooltipPosition.x + 16}
              y={tooltipPosition.y + 80}
            >
              {weeklyChange === null
                ? "First data point"
                : `${formatChange(weeklyChange)} vs prior week`}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
