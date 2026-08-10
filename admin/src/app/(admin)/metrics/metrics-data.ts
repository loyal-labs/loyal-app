import "server-only";

import { unstable_cache } from "next/cache";

import { serverEnv } from "@/lib/core/config/server";
import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";

const DEFAULT_CLICKSTACK_API_URL =
  "https://loyal-clickstack.onrender.com/api/api/v2";
const DEFAULT_METRICS_SOURCE_ID = "6a58601284f8f1d4ff4d12ab";
const RANGE_MS = 7 * 24 * 60 * 60 * 1_000;
const RESPONSE_SIZE_LIMIT = 5 * 1_024 * 1_024;

// Earn traffic is low enough that 30-minute buckets leave 336 slots holding a
// handful of samples, so every chart degrades into disconnected single points.
// Two-hour buckets keep the same 7-day window while giving each p95 a real
// sample population behind it.
export const BUCKET_MINUTES = 120;
const GRANULARITY = "2h";

const OPERATION_FIELD = "arrayElement(Attributes, 'loyal.operation')";
const PHASE_FIELD = "arrayElement(Attributes, 'loyal.phase')";
const DEPENDENCY_FIELD = "arrayElement(Attributes, 'loyal.dependency')";
const OUTCOME_FIELD = "arrayElement(Attributes, 'loyal.outcome')";
const PLATFORM_FIELD = "arrayElement(Attributes, 'loyal.platform')";
const TIME_BUCKET_FIELD = "__hdx_time_bucket";

type MetricSurface = "desktop" | "mobile";

export type MetricPoint = {
  bucketStartedAt: string;
  dependency: string | null;
  operation: string;
  outcome: string;
  phase: string | null;
  platform: "android" | "desktop" | "ios" | "other";
  p95Ms: number;
};

/** Measurements behind each operation, so a p95 drawn from one sample is obvious. */
export type OperationVolume = {
  completed: number;
  failed: number;
  total: number;
};

export type MetricsDashboardData = {
  bucketMinutes: number;
  desktop: MetricPoint[];
  fetchedAt: string;
  mobile: MetricPoint[];
  rangeEndedAt: string;
  rangeStartedAt: string;
  status: Record<MetricSurface, "available" | "unavailable">;
  volume: Record<MetricSurface, Record<string, OperationVolume>>;
};

type QueryKind = "latency" | "volume";

type ClickStackQuery = {
  environment: "prod" | "production";
  groupBy: string[];
  kind: QueryKind;
  metricName: string;
  serviceName: "loyal-frontend" | "loyal-mobile";
  surface: MetricSurface;
};

type RawMetricRow = Record<string, unknown>;

const DESKTOP_SOURCE = {
  environment: "production",
  metricName: "loyal.frontend.loading.duration",
  serviceName: "loyal-frontend",
  surface: "desktop",
} as const;

const MOBILE_SOURCE = {
  environment: "prod",
  metricName: "loyal.mobile.loading.duration",
  serviceName: "loyal-mobile",
  surface: "mobile",
} as const;

const VOLUME_GROUP_BY = [
  "Attributes['loyal.operation']",
  "Attributes['loyal.outcome']",
];

const QUERIES: ClickStackQuery[] = [
  {
    ...DESKTOP_SOURCE,
    groupBy: [
      "Attributes['loyal.operation']",
      "Attributes['loyal.phase']",
      "Attributes['loyal.dependency']",
      "Attributes['loyal.outcome']",
    ],
    kind: "latency",
  },
  {
    ...MOBILE_SOURCE,
    groupBy: [
      "Attributes['loyal.operation']",
      "Attributes['loyal.outcome']",
      "Attributes['loyal.platform']",
    ],
    kind: "latency",
  },
  { ...DESKTOP_SOURCE, groupBy: VOLUME_GROUP_BY, kind: "volume" },
  { ...MOBILE_SOURCE, groupBy: VOLUME_GROUP_BY, kind: "volume" },
];

function readDimension(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > 120 ||
    !/^[a-zA-Z0-9._:/ -]+$/.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}

function readPlatform(value: unknown): MetricPoint["platform"] {
  const platform = readDimension(value)?.toLowerCase();
  if (platform === "android" || platform === "ios") {
    return platform;
  }
  return "other";
}

function normalizeRow(
  row: RawMetricRow,
  surface: MetricSurface
): MetricPoint | null {
  const operation = readDimension(row[OPERATION_FIELD]);
  const outcome = readDimension(row[OUTCOME_FIELD]) ?? "unknown";
  const p95Ms =
    typeof row.series_0 === "number" ? row.series_0 : Number(row.series_0);
  const bucketStartedAt = readDimension(row[TIME_BUCKET_FIELD]);
  const bucketTime = bucketStartedAt ? Date.parse(bucketStartedAt) : Number.NaN;

  if (
    !operation ||
    !Number.isFinite(p95Ms) ||
    p95Ms < 0 ||
    !bucketStartedAt ||
    !Number.isFinite(bucketTime)
  ) {
    return null;
  }

  return {
    bucketStartedAt: new Date(bucketTime).toISOString(),
    dependency: readDimension(row[DEPENDENCY_FIELD]),
    operation,
    outcome,
    phase: readDimension(row[PHASE_FIELD]),
    platform:
      surface === "desktop" ? "desktop" : readPlatform(row[PLATFORM_FIELD]),
    p95Ms,
  };
}

function getSeriesUrl(): string {
  const apiUrl = serverEnv.clickStackApiUrl ?? DEFAULT_CLICKSTACK_API_URL;
  return `${apiUrl.replace(/\/$/, "")}/charts/series`;
}

async function queryMetrics(
  query: ClickStackQuery,
  startTime: number,
  endTime: number
): Promise<RawMetricRow[]> {
  const apiKey = serverEnv.clickStackApiKey;
  if (!apiKey) {
    throw new Error("ClickStack API key is not configured");
  }

  const response = await fetch(getSeriesUrl(), {
    body: JSON.stringify({
      endTime,
      granularity: GRANULARITY,
      series: [
        {
          dataSource: "metrics",
          field: "Value",
          groupBy: query.groupBy,
          metricDataType: "gauge",
          metricName: query.metricName,
          sourceId:
            serverEnv.clickStackMetricsSourceId ?? DEFAULT_METRICS_SOURCE_ID,
          where: `ServiceName = '${query.serviceName}' AND ResourceAttributes['deployment.environment.name'] = '${query.environment}'`,
          whereLanguage: "sql",
          ...(query.kind === "volume"
            ? { aggFn: "count" }
            : { aggFn: "quantile", level: 0.95 }),
        },
      ],
      seriesReturnType: "column",
      startTime,
    }),
    cache: "no-store",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`ClickStack returned HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > RESPONSE_SIZE_LIMIT) {
    throw new Error("ClickStack response exceeded the size limit");
  }

  const body = await response.text();
  if (body.length > RESPONSE_SIZE_LIMIT) {
    throw new Error("ClickStack response exceeded the size limit");
  }

  const parsed = JSON.parse(body) as { data?: unknown };
  if (!Array.isArray(parsed.data)) {
    throw new Error("ClickStack returned an invalid metrics response");
  }

  return parsed.data.filter(
    (row): row is RawMetricRow =>
      typeof row === "object" && row !== null && !Array.isArray(row)
  );
}

function toLatencyPoints(
  rows: RawMetricRow[],
  surface: MetricSurface
): MetricPoint[] {
  return rows
    .map((row) => normalizeRow(row, surface))
    .filter((point): point is MetricPoint => point !== null)
    .sort((left, right) =>
      left.bucketStartedAt.localeCompare(right.bucketStartedAt)
    );
}

function toVolumeByOperation(
  rows: RawMetricRow[]
): Record<string, OperationVolume> {
  const volume: Record<string, OperationVolume> = {};

  for (const row of rows) {
    const operation = readDimension(row[OPERATION_FIELD]);
    const outcome = readDimension(row[OUTCOME_FIELD]) ?? "unknown";
    const count = Number(row.series_0);

    if (!operation || !Number.isFinite(count) || count <= 0) {
      continue;
    }

    const current = volume[operation] ?? { completed: 0, failed: 0, total: 0 };
    volume[operation] = {
      completed: current.completed + (outcome === "completed" ? count : 0),
      failed: current.failed + (outcome === "failed" ? count : 0),
      total: current.total + count,
    };
  }

  return volume;
}

async function loadMetricsData(): Promise<MetricsDashboardData> {
  const rangeEndedAt = new Date();
  const rangeStartedAt = new Date(rangeEndedAt.getTime() - RANGE_MS);
  const results = await Promise.allSettled(
    QUERIES.map((query) =>
      queryMetrics(query, rangeStartedAt.getTime(), rangeEndedAt.getTime())
    )
  );

  const data: MetricsDashboardData = {
    bucketMinutes: BUCKET_MINUTES,
    desktop: [],
    fetchedAt: new Date().toISOString(),
    mobile: [],
    rangeEndedAt: rangeEndedAt.toISOString(),
    rangeStartedAt: rangeStartedAt.toISOString(),
    status: { desktop: "unavailable", mobile: "unavailable" },
    volume: { desktop: {}, mobile: {} },
  };

  results.forEach((result, index) => {
    const query = QUERIES[index];
    if (result.status === "fulfilled") {
      if (query.kind === "latency") {
        data[query.surface] = toLatencyPoints(result.value, query.surface);
        data.status[query.surface] = "available";
      } else {
        data.volume[query.surface] = toVolumeByOperation(result.value);
      }
      return;
    }

    console.error("ClickStack metrics query failed", {
      errorMessage:
        result.reason instanceof Error
          ? result.reason.message
          : "Unknown error",
      errorName: result.reason instanceof Error ? result.reason.name : "Error",
      kind: query.kind,
      surface: query.surface,
    });
  });

  return data;
}

const getCachedMetricsData = unstable_cache(
  loadMetricsData,
  ["admin-clickstack-loading-metrics"],
  { revalidate: DATA_CACHE_TTL_SECONDS }
);

export async function getMetricsData(): Promise<MetricsDashboardData> {
  return getCachedMetricsData();
}
