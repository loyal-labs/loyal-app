import dataset from "./datasets/summaries-v1.json";
import baseline from "./datasets/summaries-v1-baseline.json";
import {
  computeSummaryEvalMetrics,
  type SummaryEvalCase,
  type SummaryEvalMetrics,
} from "./metrics/summaries";

type SummaryEvalBaseline = {
  datasetId: string;
  minimumRates: SummaryEvalMetrics;
};

type SummaryEvalDataset = {
  cases: SummaryEvalCase[];
  datasetId: string;
  version: string;
};

export type SummaryEvalReport = {
  datasetId: string;
  metrics: SummaryEvalMetrics;
  passed: boolean;
  version: string;
};

export function runSummariesEval(
  inputDataset: SummaryEvalDataset = dataset,
  inputBaseline: SummaryEvalBaseline = baseline
): SummaryEvalReport {
  const metrics = computeSummaryEvalMetrics(inputDataset.cases);

  const failedMetrics = Object.entries(inputBaseline.minimumRates).filter(
    ([metricName, threshold]) => {
      const currentValue = metrics[metricName as keyof SummaryEvalMetrics];
      return currentValue < threshold;
    }
  );

  if (failedMetrics.length > 0) {
    const formatted = failedMetrics
      .map(([metricName, threshold]) => {
        const currentValue = metrics[metricName as keyof SummaryEvalMetrics];
        return `${metricName}: ${currentValue.toFixed(3)} < ${threshold.toFixed(
          3
        )}`;
      })
      .join(", ");

    throw new Error(
      `Summary eval regression detected for dataset '${inputDataset.datasetId}': ${formatted}`
    );
  }

  return {
    datasetId: inputDataset.datasetId,
    metrics,
    passed: true,
    version: inputDataset.version,
  };
}

if (import.meta.main) {
  const report = runSummariesEval();
  console.log(JSON.stringify(report, null, 2));
}
