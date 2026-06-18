export type LlmErrorDetails = {
  [key: string]: unknown;
};

export class LlmError extends Error {
  readonly details?: LlmErrorDetails;

  constructor(message: string, details?: LlmErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export class LlmValidationError extends LlmError {}

export class LlmAssertionError extends LlmError {}

export class LlmProviderError extends LlmError {
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: {
      details?: LlmErrorDetails;
      retryable?: boolean;
    }
  ) {
    super(message, options?.details);
    this.retryable = options?.retryable ?? true;
  }
}

export class LlmRetryExhaustedError extends LlmError {
  readonly attempts: number;
  readonly failureReasons: string[];

  constructor(
    message: string,
    options: {
      attempts: number;
      details?: LlmErrorDetails;
      failureReasons: string[];
    }
  ) {
    super(message, options.details);
    this.attempts = options.attempts;
    this.failureReasons = options.failureReasons;
  }
}

export function isRetryableLlmError(error: unknown): boolean {
  if (error instanceof LlmProviderError) {
    return error.retryable;
  }

  return (
    error instanceof LlmValidationError || error instanceof LlmAssertionError
  );
}
