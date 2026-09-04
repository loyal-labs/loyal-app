import type { LifecycleErrorDetail } from "@/features/observability/lifecycle-contract";

// Prepare routes legitimately run long (Safe reserve selection + Kamino RPC
// round trips measured at ~10s in production, longer on dev cold compiles),
// so the bound only guards against a hung connection, not a slow prepare.
const EARN_PREPARE_REQUEST_TIMEOUT_MS = 45_000;

export class EarnPrepareRequestError extends Error {
  readonly code: string | undefined;
  readonly errorDetail: LifecycleErrorDetail | undefined;
  readonly httpStatus: number | undefined;

  constructor(
    message: string,
    args: {
      cause?: unknown;
      code?: string;
      errorDetail?: LifecycleErrorDetail;
      httpStatus?: number;
    } = {}
  ) {
    super(
      message,
      args.cause === undefined ? undefined : { cause: args.cause }
    );
    this.name = "EarnPrepareRequestError";
    this.code = args.code;
    this.errorDetail = args.errorDetail;
    this.httpStatus = args.httpStatus;
  }
}

function classifyEarnPrepareTransportError(args: {
  error: unknown;
  timedOut: boolean;
}): LifecycleErrorDetail | undefined {
  if (args.timedOut) {
    return "request_timeout";
  }
  if (!(args.error instanceof Error)) {
    return undefined;
  }
  const text = `${args.error.name}: ${args.error.message}`;
  return /Failed to fetch|Network request failed|NetworkError|Load failed/i.test(
    text
  )
    ? "network_unreachable"
    : undefined;
}

export async function fetchEarnPrepare(args: {
  body: string;
  fetchImpl: typeof fetch;
  flowId?: string;
  url: string;
}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, EARN_PREPARE_REQUEST_TIMEOUT_MS);
    try {
      // Invoke with an explicit receiver: `args.fetchImpl(...)` would call the
      // native fetch with `this === args`, which browsers reject with
      // "Failed to execute 'fetch' on 'Window': Illegal invocation".
      return await args.fetchImpl.call(globalThis, args.url, {
        body: args.body,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(args.flowId ? { "x-loyal-flow-id": args.flowId } : {}),
        },
        method: "POST",
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;
      const errorDetail = classifyEarnPrepareTransportError({
        error,
        timedOut,
      });
      if (attempt === 0 && errorDetail) {
        continue;
      }
      throw new EarnPrepareRequestError(
        errorDetail === "request_timeout"
          ? "Earn prepare request timed out."
          : "Earn prepare request failed.",
        {
          cause: error,
          errorDetail,
        }
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new EarnPrepareRequestError("Earn prepare request failed.", {
    cause: lastError,
  });
}

export function getEarnPrepareLifecycleDiagnostics(error: unknown): {
  errorCode: "request_failed";
  errorDetail?: LifecycleErrorDetail;
  httpStatus?: number;
} {
  return {
    errorCode: "request_failed",
    ...(error instanceof EarnPrepareRequestError && error.errorDetail
      ? { errorDetail: error.errorDetail }
      : {}),
    ...(error instanceof EarnPrepareRequestError && error.httpStatus
      ? { httpStatus: error.httpStatus }
      : {}),
  };
}
