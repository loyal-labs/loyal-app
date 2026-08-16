import type {
  EarnApySample,
  EarnForecastSummary,
} from "@/lib/solana/earn/earn-api";

// Real-data model for the APY + Forecast charts, ported from the web
// `earn-detail-view`. The APY series come from the global forecast summary
// (loyal + mainUsdcReserve have real histories); T-Bill is a fixed benchmark
// with no live feed. Forecast lines project a principal forward at each APY.

// Fixed T-Bill benchmark (no live series), matching the web constant.
export const TBILL_APY_BPS = 365;
// Fallbacks when the summary hasn't loaded / lacks a series.
export const LOYAL_FALLBACK_APY_BPS = 1006;
export const MAIN_FALLBACK_APY_BPS = 559;
const MIN_APY_BPS = 50;

export function clampApyBps(apyBps: number): number {
  return Math.max(Number.isFinite(apyBps) ? apyBps : 0, MIN_APY_BPS);
}

// 12-month growth factor at a given APY (simple, matching the web forecast).
export function targetMultiplier(apyBps: number): number {
  return 1 + clampApyBps(apyBps) / 10_000;
}

function findSeries(
  summary: EarnForecastSummary | null,
  key: "loyal" | "mainUsdcReserve",
): EarnApySample[] {
  const series = summary?.history.series?.find((s) => s.key === key);
  if (series?.samples?.length) {
    return series.samples;
  }
  // The top-level `samples` is the loyal history when no series array is sent.
  if (key === "loyal" && summary?.history.samples?.length) {
    return summary.history.samples;
  }
  return [];
}

export function getLoyalSamples(
  summary: EarnForecastSummary | null,
): EarnApySample[] {
  return findSeries(summary, "loyal");
}

export function getMainSamples(
  summary: EarnForecastSummary | null,
): EarnApySample[] {
  return findSeries(summary, "mainUsdcReserve");
}

export function getLoyalApyBps(summary: EarnForecastSummary | null): number {
  return summary?.forecast.apyBps ?? LOYAL_FALLBACK_APY_BPS;
}

// Latest observed Main Kamino reserve APY, else the web fallback.
export function getMainApyBps(summary: EarnForecastSummary | null): number {
  const latest = getMainSamples(summary).at(-1);
  return latest && Number.isFinite(latest.apyBps)
    ? latest.apyBps
    : MAIN_FALLBACK_APY_BPS;
}

// Evenly downsample a sample series to `n` points (keeps first + last).
export function resampleSamples(
  samples: EarnApySample[],
  n: number,
): EarnApySample[] {
  if (samples.length <= n) {
    return samples;
  }
  const out: EarnApySample[] = [];
  for (let i = 0; i < n; i += 1) {
    const idx = Math.round((i / (n - 1)) * (samples.length - 1));
    out.push(samples[idx]);
  }
  return out;
}

// Round up to a "nice" axis ceiling (1/2/2.5/5/10 × 10ⁿ), matching the web.
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step =
    normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 2.5
          ? 2.5
          : normalized <= 5
            ? 5
            : 10;
  return step * magnitude;
}

// 12-month projection of `principal` at `apyBps`, eased like the web model.
export function buildProjection(
  principal: number,
  apyBps: number,
  points: number,
): number[] {
  const target = principal * targetMultiplier(apyBps);
  return Array.from({ length: points }, (_, i) => {
    const progress = i / (points - 1);
    const eased = progress ** 1.08;
    return principal + (target - principal) * eased;
  });
}
