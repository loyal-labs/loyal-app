import { ax, type AxAIService, type AxAssertion } from "@ax-llm/ax";
import { assertValidationResult, type RetryPolicy } from "@loyal-labs/llm-core";
import {
  type AxProgramLike,
  type LlmTelemetrySink,
  runAxProgram,
} from "@loyal-labs/llm-server";

import type {
  OnelinerGenerationInput,
  OnelinerGenerationOutput,
  SummaryGenerationDiagnostics,
  SummaryGenerationRequest,
  SummaryGenerationResponse,
  SummaryProgramSpec,
  TopicExtractionInput,
  TopicExtractionOutput,
} from "./types";
import {
  dedupeParticipants,
  trimOneliner,
  validateSummaryOneliner,
  validateSummaryTopics,
} from "./validation";

type CreateAxSummaryGenerationServiceParams = {
  ai: AxAIService;
  defaultModel: string;
  maxAttempts: number;
  spec: SummaryProgramSpec;
  telemetry?: LlmTelemetrySink;
  testPrograms?: {
    onelinerProgram: AxProgramLike<
      OnelinerGenerationInput,
      OnelinerGenerationOutput
    >;
    topicProgram: AxProgramLike<TopicExtractionInput, TopicExtractionOutput>;
  };
};

export type SummaryGenerationService = {
  generate: (
    request: SummaryGenerationRequest
  ) => Promise<SummaryGenerationResponse>;
};

export function createAxSummaryGenerationService(
  params: CreateAxSummaryGenerationServiceParams
): SummaryGenerationService {
  const retryPolicy: RetryPolicy = {
    backoffMultiplier: 2,
    initialDelayMs: 150,
    jitterRatio: 0.15,
    maxAttempts: Math.max(1, params.maxAttempts),
    maxDelayMs: 1_200,
  };

  const topicProgram =
    params.testPrograms?.topicProgram ?? createTopicProgram(params.spec);
  const onelinerProgram =
    params.testPrograms?.onelinerProgram ?? createOnelinerProgram(params.spec);

  return {
    generate: async (request) => {
      validateRequest(request);

      const participants = dedupeParticipants(request.participants);
      const model = request.modelKey?.trim() || params.defaultModel;
      const startTime = Date.now();

      const topicInput: TopicExtractionInput = {
        chatTitle: request.chatTitle,
        dayKeyUtc: request.dayKeyUtc,
        messageTranscript: request.transcript,
        participants,
        qualityRules: params.spec.qualityRules,
      };

      const topicAsserts: AxAssertion[] = [
        {
          fn: (values) => {
            const result = validateSummaryTopics(
              (values as TopicExtractionOutput).topics,
              {
                participants,
              }
            );
            return result.ok || result.reason;
          },
        },
      ];

      const topicResult = await runAxProgram({
        ai: params.ai,
        asserts: topicAsserts,
        input: topicInput,
        label: "summaries.topic_extraction",
        model,
        normalizeOutput: (output) => {
          return assertValidationResult(
            validateSummaryTopics(output.topics, { participants }),
            {
              model,
              phase: "topic_extraction",
            }
          );
        },
        program: topicProgram,
        retryPolicy,
        telemetry: params.telemetry,
      });

      const onelinerInput: OnelinerGenerationInput = {
        chatTitle: request.chatTitle,
        dayKeyUtc: request.dayKeyUtc,
        topics: topicResult.value,
      };

      const onelinerAsserts: AxAssertion[] = [
        {
          fn: (values) => {
            const result = validateSummaryOneliner(
              (values as OnelinerGenerationOutput).oneliner
            );
            return result.ok || result.reason;
          },
        },
      ];

      const onelinerResult = await runAxProgram({
        ai: params.ai,
        asserts: onelinerAsserts,
        input: onelinerInput,
        label: "summaries.oneliner",
        model,
        normalizeOutput: (output) => {
          const normalized = assertValidationResult(
            validateSummaryOneliner(output.oneliner),
            {
              model,
              phase: "oneliner",
            }
          );

          return trimOneliner(normalized);
        },
        program: onelinerProgram,
        retryPolicy,
        telemetry: params.telemetry,
      });

      const diagnostics: SummaryGenerationDiagnostics = {
        attempts:
          topicResult.diagnostics.attempts +
          onelinerResult.diagnostics.attempts,
        failureReasons: [
          ...topicResult.diagnostics.failureReasons,
          ...onelinerResult.diagnostics.failureReasons,
        ],
        finalModel: model,
        latencyMs: Date.now() - startTime,
        usedExampleSet: params.spec.id,
      };

      return {
        diagnostics,
        oneliner: onelinerResult.value,
        topics: topicResult.value,
      };
    },
  };
}

function validateRequest(request: SummaryGenerationRequest): void {
  if (!request.chatTitle.trim()) {
    throw new Error("Summary generation request requires a chat title");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.dayKeyUtc)) {
    throw new Error(
      "Summary generation request requires dayKeyUtc in YYYY-MM-DD format"
    );
  }

  if (!request.transcript.trim()) {
    throw new Error(
      "Summary generation request requires a non-empty transcript"
    );
  }
}

function createTopicProgram(
  spec: SummaryProgramSpec
): AxProgramLike<TopicExtractionInput, TopicExtractionOutput> {
  const program = ax(spec.topicExtraction.signature, {
    maxRetries: 1,
    modelConfig: {
      temperature: spec.defaults.topicTemperature,
    },
  });

  program.setExamples(spec.topicExtraction.examples);
  // Runtime assertions are enforced in runAxProgram() via `asserts` + normalizeOutput.
  // Keeping Ax internal addAssert() disabled avoids brittle provider-side repair loops.

  return program;
}

function createOnelinerProgram(
  spec: SummaryProgramSpec
): AxProgramLike<OnelinerGenerationInput, OnelinerGenerationOutput> {
  const program = ax(spec.oneliner.signature, {
    maxRetries: 1,
    modelConfig: {
      temperature: spec.defaults.onelinerTemperature,
    },
  });

  program.setExamples(spec.oneliner.examples);
  // Runtime assertions are enforced in runAxProgram() via `asserts` + normalizeOutput.
  // Keeping Ax internal addAssert() disabled avoids brittle provider-side repair loops.

  return program;
}
