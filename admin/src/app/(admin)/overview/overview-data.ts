import "server-only";

import { unstable_cache } from "next/cache";

import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";

import {
  getAutodepositTimeSeries,
  getOptimizationVolumeSeries,
  type AutodepositTimeSeriesRange,
  type OptimizationVolumePoint,
} from "../earn/rebalance/rebalance-data";

type SerializedAutodepositTimeSeriesRange = Omit<
  AutodepositTimeSeriesRange,
  "points"
> & {
  points: Array<
    Omit<AutodepositTimeSeriesRange["points"][number], "depositedAmountRaw"> & {
      depositedAmountRaw: string;
    }
  >;
};

type SerializedOptimizationVolumePoint = Omit<
  OptimizationVolumePoint,
  "cumulativeAmountRaw" | "dailyAmountRaw"
> & {
  cumulativeAmountRaw: string;
  dailyAmountRaw: string;
};

type OverviewData = {
  autodeposit: SerializedAutodepositTimeSeriesRange[];
  optimizationVolume: SerializedOptimizationVolumePoint[];
};

async function loadOverviewData(): Promise<OverviewData> {
  const [autodeposit, optimizationVolume] = await Promise.all([
    getAutodepositTimeSeries(),
    getOptimizationVolumeSeries(),
  ]);

  return {
    autodeposit: autodeposit.map((range) => ({
      ...range,
      points: range.points.map((point) => ({
        ...point,
        depositedAmountRaw: point.depositedAmountRaw.toString(),
      })),
    })),
    optimizationVolume: optimizationVolume.map((point) => ({
      ...point,
      cumulativeAmountRaw: point.cumulativeAmountRaw.toString(),
      dailyAmountRaw: point.dailyAmountRaw.toString(),
    })),
  };
}

const getCachedOverviewData = unstable_cache(
  loadOverviewData,
  ["overview-earn-activity"],
  { revalidate: DATA_CACHE_TTL_SECONDS }
);

export async function getOverviewData(): Promise<OverviewData> {
  return getCachedOverviewData();
}
