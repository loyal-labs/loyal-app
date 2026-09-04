// Shared geometry, colors, and timestamp formatting for the Earn line charts
// (ApyChart, ForecastChart). The point window is anchored to the designed
// Jun 1–Jun 30 range so labels match the mock regardless of the real date.

export const POINT_COUNT = 60;
export const DOT_RADIUS = 4;
// Vertical breathing room so peaks/endpoints don't clip at the chart edges.
export const CHART_TOP_INSET = 10;
export const CHART_BOTTOM_INSET = 10;

export const COLOR_LOYAL = "#F9363C";
export const COLOR_MAIN = "#A7B3F6";
export const COLOR_TBILL = "#666666";
export const COLOR_DIM_WHITE_60 = "rgba(255, 255, 255, 0.6)";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Map a normalized [0..1] height (0 = chart bottom, 1 = top) to a y pixel.
export function yForNorm(norm: number, height: number): number {
  const usable = Math.max(0, height - CHART_TOP_INSET - CHART_BOTTOM_INSET);
  return CHART_TOP_INSET + (1 - norm) * usable;
}

// SVG path ("M … L …") across the full width for a normalized height series.
export function buildLinePath(
  norm: number[],
  width: number,
  height: number,
): string {
  if (norm.length === 0 || width <= 0) {
    return "";
  }
  return norm
    .map((n, i) => {
      const x = (i / (norm.length - 1)) * width;
      const y = yForNorm(n, height);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

// "Jun 18" or, with time, "Jun 18, 6:00 PM" — for historical (APY) axis/scrub.
export function formatChartDate(date: Date, withTime: boolean): string {
  const monthDay = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  if (!withTime) {
    return monthDay;
  }
  const hour24 = date.getHours();
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${monthDay}, ${hour12}:00 ${ampm}`;
}

// "Jul 2026" — for the forward-looking (Forecast) axis/scrub.
export function formatMonthYear(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
