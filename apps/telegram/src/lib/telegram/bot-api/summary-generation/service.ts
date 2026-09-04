import "server-only";

import {
  createAxOpenAiClient,
  createConsoleTelemetrySink,
} from "@loyal-labs/llm-server";

import {
  createAxSummaryGenerationService,
  type SummaryGenerationService as AxSummaryGenerationService,
} from "@/lib/ai/ax/programs/summaries/generate";
import { getSummaryProgramSpec } from "@/lib/ai/ax/programs/summaries/spec";
import type {
  SummaryGenerationDiagnostics,
  SummaryGenerationRequest,
  SummaryGenerationResponse,
  SummaryTopic,
} from "@/lib/ai/ax/programs/summaries/types";
import { serverEnv } from "@/lib/core/config/server";
import { REDPILL_BASE_URL } from "@/lib/redpill/constants";

export type {
  SummaryGenerationDiagnostics,
  SummaryGenerationRequest,
  SummaryGenerationResponse,
  SummaryTopic,
};

export interface SummaryGenerationService {
  generate(
    request: SummaryGenerationRequest
  ): Promise<SummaryGenerationResponse>;
}

let defaultSummaryGenerationService: SummaryGenerationService | null = null;

export function getSummaryGenerationService(): SummaryGenerationService {
  if (defaultSummaryGenerationService) {
    return defaultSummaryGenerationService;
  }

  const ai = createAxOpenAiClient({
    apiKey: serverEnv.redpillApiKey,
    apiURL: REDPILL_BASE_URL,
    name: "openai",
  });

  const summaryService: AxSummaryGenerationService =
    createAxSummaryGenerationService({
      ai,
      defaultModel: serverEnv.axSummaryModelDefault,
      maxAttempts: serverEnv.axSummaryMaxAttempts,
      spec: getSummaryProgramSpec(serverEnv.axSummaryExamplesVersion),
      telemetry: createConsoleTelemetrySink(serverEnv.axSummaryEnableTelemetry),
    });

  defaultSummaryGenerationService = {
    generate: (request) => summaryService.generate(request),
  };

  return defaultSummaryGenerationService;
}
