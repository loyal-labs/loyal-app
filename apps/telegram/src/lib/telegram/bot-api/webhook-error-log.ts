type ErrorContextValue = boolean | null | number | string | undefined;

export type WebhookErrorLogContext = Record<string, ErrorContextValue>;

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export function logWebhookHandlerError(
  message: string,
  error: unknown,
  context: WebhookErrorLogContext
): void {
  const normalizedError = normalizeError(error);

  console.error(
    message,
    {
      ...context,
      errorMessage: normalizedError.message,
      errorName: normalizedError.name,
      errorStack: normalizedError.stack,
    },
    normalizedError
  );
}
