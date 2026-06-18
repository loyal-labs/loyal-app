import type { SummaryTopic } from "../../programs/summaries/types";
import {
  validateSummaryOneliner,
  validateSummaryTopics,
} from "../../programs/summaries/validation";

export type SummaryEvalCase = {
  id: string;
  output: {
    oneliner: string;
    topics: SummaryTopic[];
  };
  participants: string[];
};

export type SummaryEvalMetrics = {
  onelinerLengthComplianceRate: number;
  sourceAttributionValidityRate: number;
  structureValidityRate: number;
  topicCountComplianceRate: number;
};

export function computeSummaryEvalMetrics(
  cases: SummaryEvalCase[]
): SummaryEvalMetrics {
  if (cases.length === 0) {
    return {
      onelinerLengthComplianceRate: 0,
      sourceAttributionValidityRate: 0,
      structureValidityRate: 0,
      topicCountComplianceRate: 0,
    };
  }

  let structureValidCount = 0;
  let sourceAttributionValidCount = 0;
  let topicCountValidCount = 0;
  let onelinerLengthValidCount = 0;

  for (const testCase of cases) {
    const structureValidation = validateSummaryTopics(testCase.output.topics);
    if (structureValidation.ok) {
      structureValidCount += 1;
    }

    const sourceValidation = validateSummaryTopics(testCase.output.topics, {
      participants: testCase.participants,
    });
    if (sourceValidation.ok) {
      sourceAttributionValidCount += 1;
    }

    if (
      Array.isArray(testCase.output.topics) &&
      testCase.output.topics.length >= 1 &&
      testCase.output.topics.length <= 5
    ) {
      topicCountValidCount += 1;
    }

    const onelinerValidation = validateSummaryOneliner(
      testCase.output.oneliner
    );
    if (onelinerValidation.ok) {
      onelinerLengthValidCount += 1;
    }
  }

  return {
    onelinerLengthComplianceRate: onelinerLengthValidCount / cases.length,
    sourceAttributionValidityRate: sourceAttributionValidCount / cases.length,
    structureValidityRate: structureValidCount / cases.length,
    topicCountComplianceRate: topicCountValidCount / cases.length,
  };
}
