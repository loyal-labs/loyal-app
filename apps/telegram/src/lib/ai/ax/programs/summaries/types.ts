import type { AxSignature } from "@ax-llm/ax";

export type SummaryTopic = {
  content: string;
  sources: string[];
  title: string;
};

export type SummaryGenerationRequest = {
  chatTitle: string;
  dayKeyUtc: string;
  modelKey?: string;
  participants: string[];
  transcript: string;
};

export type SummaryGenerationDiagnostics = {
  attempts: number;
  failureReasons: string[];
  finalModel: string;
  latencyMs: number;
  usedExampleSet: string;
};

export type SummaryGenerationResponse = {
  diagnostics: SummaryGenerationDiagnostics;
  oneliner: string;
  topics: SummaryTopic[];
};

export type TopicExtractionInput = {
  chatTitle: string;
  dayKeyUtc: string;
  messageTranscript: string;
  participants: string[];
  qualityRules: string;
};

export type TopicExtractionOutput = {
  topics: SummaryTopic[];
};

export type OnelinerGenerationInput = {
  chatTitle: string;
  dayKeyUtc: string;
  topics: SummaryTopic[];
};

export type OnelinerGenerationOutput = {
  oneliner: string;
};

export type SummaryProgramSpec = {
  defaults: {
    onelinerTemperature: number;
    topicTemperature: number;
  };
  id: string;
  metric: (response: SummaryGenerationResponse) => number;
  oneliner: {
    assertions: Array<(values: OnelinerGenerationOutput) => true | string>;
    examples: Array<OnelinerGenerationInput & { oneliner: string }>;
    signature: AxSignature<OnelinerGenerationInput, OnelinerGenerationOutput>;
  };
  qualityRules: string;
  topicExtraction: {
    assertions: Array<(values: TopicExtractionOutput) => true | string>;
    examples: Array<TopicExtractionInput & { topics: SummaryTopic[] }>;
    signature: AxSignature<TopicExtractionInput, TopicExtractionOutput>;
  };
  version: string;
};
