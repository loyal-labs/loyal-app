import type { MobileTokenDetailResponse } from "@/services/api";

export type TokenChartPoint = MobileTokenDetailResponse["chart"][number];

export function normalizeTokenChartTimestamp(timestamp: number) {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

export function formatTokenChartTimeLabel(timestamp: number) {
  const date = new Date(normalizeTokenChartTimestamp(timestamp));
  const hasMinutes = date.getMinutes() !== 0;

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    ...(hasMinutes ? { minute: "2-digit" } : {}),
  }).format(date);
}

export function getTokenChartPointIndex(
  points: TokenChartPoint[],
  chartWidth: number,
  locationX: number,
) {
  if (points.length === 0 || chartWidth <= 0) {
    return null;
  }

  if (points.length === 1) {
    return 0;
  }

  const clampedX = Math.min(Math.max(locationX, 0), chartWidth);
  return Math.round((clampedX / chartWidth) * (points.length - 1));
}

export function buildTokenChartCoordinates(
  points: TokenChartPoint[],
  width: number,
  height: number,
  options?: {
    topInset?: number;
    bottomInset?: number;
  },
) {
  if (points.length === 0 || width <= 0 || height <= 0) {
    return [];
  }

  const topInset = options?.topInset ?? 0;
  const bottomInset = options?.bottomInset ?? 0;
  const drawableHeight = Math.max(height - topInset - bottomInset, 1);
  const prices = points.map((point) => point.priceUsd);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;

  return points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y =
      priceRange === 0
        ? topInset + drawableHeight / 2
        : topInset + drawableHeight - ((point.priceUsd - minPrice) / priceRange) * drawableHeight;

    return {
      ...point,
      x,
      y,
    };
  });
}

export function buildTokenChartPath(
  coordinates: { x: number; y: number }[],
) {
  if (coordinates.length === 0) {
    return "";
  }

  return coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}
