import type { AxAIService, AxAssertion } from "@ax-llm/ax";
import {
  getErrorMessage,
  isRetryableLlmError,
  LlmAssertionError,
  LlmError,
  LlmProviderError,
  LlmValidationError,
  runWithRetryPolicy,
  type LlmRunMeta,
  type RetryPolicy,
} from "@loyal-labs/llm-core";

import type { LlmTelemetryEvent, LlmTelemetrySink } from "./telemetry";

export type AxProgramLike<TInput, TOutput> = {
  forward: (
    ai: AxAIService,
    input: TInput,
    options?: {
      asserts?: AxAssertion[];
      model?: string;
    }
  ) => Promise<TOutput>;
};

export type RunAxProgramParams<TInput, TOutput, TResult> = {
  ai: AxAIService;
  asserts?: AxAssertion[];
  input: TInput;
  label: string;
  model: string;
  normalizeOutput: (output: TOutput) => TResult;
  program: AxProgramLike<TInput, TOutput>;
  retryPolicy: RetryPolicy;
  telemetry?: LlmTelemetrySink;
};

export type RunAxProgramResult<TResult> = {
  diagnostics: LlmRunMeta;
  value: TResult;
};

export async function runAxProgram<TInput, TOutput, TResult>(
  params: RunAxProgramParams<TInput, TOutput, TResult>
): Promise<RunAxProgramResult<TResult>> {
  const startTimeMs = Date.now();

  const runResult = await runWithRetryPolicy({
    label: params.label,
    onAttemptFailure: (failure) => {
      const errorFields = buildTelemetryErrorFields(failure.error);

      params.telemetry?.({
        attempt: failure.attempt,
        errorMessage: failure.reason,
        ...errorFields,
        event: "llm_attempt_failed",
        latencyMs: Date.now() - startTimeMs,
        model: params.model,
        program: params.label,
      });
    },
    policy: params.retryPolicy,
    shouldRetry: (error) => {
      if (error instanceof LlmValidationError) {
        return true;
      }

      return isRetryableLlmError(error);
    },
    task: async () => {
      let output: TOutput;
      try {
        output = await params.program.forward(params.ai, params.input, {
          asserts: params.asserts,
          model: params.model,
        });
      } catch (error) {
        if (
          error instanceof LlmValidationError ||
          error instanceof LlmAssertionError ||
          error instanceof LlmProviderError
        ) {
          throw error;
        }

        const wrappedErrorDetails: Record<string, unknown> = {
          program: params.label,
        };

        if (error instanceof Error) {
          const errorDetails = extractErrorDetails(error);
          const errorCauseMessage = getErrorCauseMessage(error);

          if (Object.keys(errorDetails).length > 0) {
            wrappedErrorDetails.errorDetails = errorDetails;
          }

          if (errorCauseMessage) {
            wrappedErrorDetails.cause = errorCauseMessage;
          }
        }

        const wrappedProviderError = new LlmProviderError(
          getErrorMessage(error),
          {
            details: wrappedErrorDetails,
            retryable: true,
          }
        );

        if (error instanceof Error) {
          (wrappedProviderError as Error & { cause?: unknown }).cause = error;
        }

        throw wrappedProviderError;
      }

      try {
        return params.normalizeOutput(output);
      } catch (error) {
        if (
          error instanceof LlmValidationError ||
          error instanceof LlmAssertionError
        ) {
          throw error;
        }

        throw new LlmValidationError(getErrorMessage(error), {
          program: params.label,
        });
      }
    },
  });

  const diagnostics: LlmRunMeta = {
    attempts: runResult.attempts,
    failureReasons: runResult.failureReasons,
    finalModel: params.model,
    latencyMs: Date.now() - startTimeMs,
  };

  params.telemetry?.({
    event: "llm_completed",
    latencyMs: diagnostics.latencyMs,
    model: params.model,
    program: params.label,
  });

  return {
    diagnostics,
    value: runResult.value,
  };
}

const MAX_ERROR_FIELD_LENGTH = 2_000;

function buildTelemetryErrorFields(
  error: unknown
): Pick<
  LlmTelemetryEvent,
  "errorCauseMessage" | "errorDetails" | "errorName" | "errorStack"
> {
  if (!(error instanceof Error)) {
    return {
      errorDetails: {
        nonErrorValue: truncateValue(stringifyUnknown(error)),
      },
    };
  }

  const details = extractErrorDetails(error);
  const errorStack = error.stack
    ? truncateValue(error.stack.split("\n").slice(0, 6).join("\n"))
    : undefined;

  return {
    errorCauseMessage: getErrorCauseMessage(error),
    errorDetails: Object.keys(details).length > 0 ? details : undefined,
    errorName: error.name,
    errorStack,
  };
}

function extractErrorDetails(error: Error): Record<string, string> {
  const details: Record<string, string> = {};
  const baseRecord = error as Error & Record<string, unknown>;

  if (error instanceof LlmError && error.details) {
    details.llmErrorDetails = truncateValue(stringifyUnknown(error.details));
  }

  if (baseRecord.details !== undefined) {
    details.details = truncateValue(stringifyUnknown(baseRecord.details));
  }

  const directKeys = [
    "code",
    "status",
    "statusCode",
    "type",
    "param",
    "requestId",
  ];
  for (const key of directKeys) {
    const value = baseRecord[key];
    if (value !== undefined) {
      details[key] = truncateValue(stringifyUnknown(value));
    }
  }

  const response = baseRecord.response;
  if (response !== undefined) {
    details.response = truncateValue(stringifyUnknown(response));
  }

  return details;
}

function getErrorCauseMessage(error: Error): string | undefined {
  const maybeErrorWithCause = error as Error & {
    cause?: unknown;
  };

  if (maybeErrorWithCause.cause === undefined) {
    return undefined;
  }

  if (maybeErrorWithCause.cause instanceof Error) {
    return truncateValue(maybeErrorWithCause.cause.message);
  }

  return truncateValue(stringifyUnknown(maybeErrorWithCause.cause));
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value === undefined) {
    return "undefined";
  }

  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }

      if (typeof currentValue === "function") {
        return `[Function ${currentValue.name || "anonymous"}]`;
      }

      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }
        seen.add(currentValue);
      }

      return currentValue;
    });
  } catch {
    return String(value);
  }
}

function truncateValue(value: string): string {
  if (value.length <= MAX_ERROR_FIELD_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_ERROR_FIELD_LENGTH)}…(truncated)`;
}
