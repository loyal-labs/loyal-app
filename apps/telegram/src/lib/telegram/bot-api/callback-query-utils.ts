export function isMessageNotModifiedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as {
    description?: unknown;
    message?: unknown;
  };

  return (
    (typeof maybeError.description === "string" &&
      maybeError.description.includes("message is not modified")) ||
    (typeof maybeError.message === "string" &&
      maybeError.message.includes("message is not modified"))
  );
}
