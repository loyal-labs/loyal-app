import "server-only";

import { unstable_cache } from "next/cache";

import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";

import {
  getAutodepositTimeSeries,
  getOptimizationVolumeSeries,
  type AutodepositTimeSeriesRange,
  type OptimizationVolumePoint,
} from "../earn/rebalance/rebalance-data";

type SerializedAutodepositTimeSeriesRange = Pick<
  AutodepositTimeSeriesRange,
  "bucketHours" | "key"
> & {
  points: Array<
    Pick<
      AutodepositTimeSeriesRange["points"][number],
      "bucketStartedAt" | "successful"
    > & {
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
      bucketHours: range.bucketHours,
      key: range.key,
      points: range.points.map((point) => ({
        bucketStartedAt: point.bucketStartedAt,
        depositedAmountRaw: point.depositedAmountRaw.toString(),
        successful: point.successful,
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
