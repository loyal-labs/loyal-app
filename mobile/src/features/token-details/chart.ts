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
  locationX: number
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
  }
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
    const x =
      points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y =
      priceRange === 0
        ? topInset + drawableHeight / 2
        : topInset +
          drawableHeight -
          ((point.priceUsd - minPrice) / priceRange) * drawableHeight;

    return {
      ...point,
      x,
      y,
    };
  });
}

export function buildTokenChartPath(coordinates: { x: number; y: number }[]) {
  if (coordinates.length === 0) {
    return "";
  }

  return coordinates
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    )
    .join(" ");
}

/**
 * Bucket-average raw price points down to ~targetCount samples to suppress
 * sub-bucket noise. Each output bucket carries the mean priceUsd and the
 * timestamp of its first point (so timeline labels stay anchored to real
 * trades). When the input is already <= targetCount, the array is returned
 * unchanged.
 */
export function downsampleTokenChartPoints(
  points: TokenChartPoint[],
  targetCount: number
): TokenChartPoint[] {
  if (targetCount <= 0) return [];
  if (points.length <= targetCount) return points;

  const bucketSize = points.length / targetCount;
  const out: TokenChartPoint[] = [];
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(points.length, Math.floor((i + 1) * bucketSize));
    if (end <= start) continue;
    let sum = 0;
    for (let j = start; j < end; j++) sum += points[j].priceUsd;
    out.push({
      timestamp: points[start].timestamp,
      priceUsd: sum / (end - start),
    });
  }
  return out;
}

/**
 * Emit an SVG path that connects the coordinates with a monotone cubic
 * spline (Fritsch–Carlson tangents). Produces visually smooth curves
 * without overshooting peaks/troughs — important so smoothing doesn't lie
 * about the price ever exceeding the data range.
 */
export function buildTokenChartSplinePath(
  coordinates: { x: number; y: number }[]
) {
  const n = coordinates.length;
  if (n === 0) return "";
  if (n === 1) {
    const p = coordinates[0];
    return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }

  // Slopes of the secant lines.
  const dx: number[] = new Array(n - 1);
  const dy: number[] = new Array(n - 1);
  const slope: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = coordinates[i + 1].x - coordinates[i].x;
    dy[i] = coordinates[i + 1].y - coordinates[i].y;
    slope[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }

  // Tangent at each point — Fritsch–Carlson monotone cubic interpolation.
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (slope[i - 1] + slope[i]) / 2;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  let path = `M ${coordinates[0].x.toFixed(2)} ${coordinates[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = coordinates[i].x + dx[i] / 3;
    const c1y = coordinates[i].y + (m[i] * dx[i]) / 3;
    const c2x = coordinates[i + 1].x - dx[i] / 3;
    const c2y = coordinates[i + 1].y - (m[i + 1] * dx[i]) / 3;
    path +=
      ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)},` +
      ` ${c2x.toFixed(2)} ${c2y.toFixed(2)},` +
      ` ${coordinates[i + 1].x.toFixed(2)} ${coordinates[i + 1].y.toFixed(2)}`;
  }
  return path;
}
