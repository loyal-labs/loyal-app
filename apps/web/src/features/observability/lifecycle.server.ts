import "server-only";

import { after } from "next/server";

import {
  createLifecycleTracker,
  LIFECYCLE_VARIANTS,
  normalizeLifecycleErrorCode,
  type LifecycleDiagnostics,
  type LifecycleFlowStage,
  fallbackRandomUuidV4,
  isCanonicalUuidV4,
  type LifecycleFlowName,
  type LifecycleFlowVariant,
  type LifecycleTracker,
} from "./lifecycle-contract";
import { reportBrowserLifecycleEnvelope } from "./server";
import { parseJourneyTraceparent } from "./trace-context";

export type RequestLifecycle = {
  setVerifiedWallet: (walletAddress: string) => void;
  tracker: LifecycleTracker;
};

export function createRequestLifecycle(args: {
  flowName: LifecycleFlowName;
  flowVariant: LifecycleFlowVariant;
  request: Request;
}): RequestLifecycle | null {
  const flowId = args.request.headers.get("x-loyal-flow-id")?.trim();
  if (!isCanonicalUuidV4(flowId)) return null;

  const requestedVariant = args.request.headers.get("x-loyal-flow-variant");
  const flowVariant =
    requestedVariant &&
    (LIFECYCLE_VARIANTS[args.flowName] as readonly string[]).includes(
      requestedVariant
    )
      ? (requestedVariant as LifecycleFlowVariant)
      : args.flowVariant;
  const journeyId = args.request.headers.get("x-loyal-journey-id");
  const attemptNumber = Number(
    args.request.headers.get("x-loyal-attempt-number")
  );
  const journeyContext =
    isCanonicalUuidV4(journeyId) &&
    Number.isInteger(attemptNumber) &&
    attemptNumber >= 1 &&
    attemptNumber <= 1000
      ? { journeyId, attemptNumber }
      : {};
  const parent = parseJourneyTraceparent(
    args.request.headers.get("traceparent")
  );
  let walletAddress: string | undefined;
  const tracker = createLifecycleTracker({
    ...journeyContext,
    ...(parent
      ? {
          traceContext: {
            traceId: parent.traceId,
            parentSpanId: parent.spanId,
            spanId: fallbackRandomUuidV4().replaceAll("-", "").slice(0, 16),
          },
        }
      : {}),
    emit: (event) => {
      const eventWalletAddress = walletAddress;
      after(async () => {
        await reportBrowserLifecycleEnvelope(event, eventWalletAddress);
      });
    },
    flowId,
    flowName: args.flowName,
    flowVariant,
    pathname: new URL(args.request.url).pathname,
    runtime: "node",
    source: "next_api",
  });

  return {
    setVerifiedWallet: (verifiedWalletAddress) => {
      walletAddress = verifiedWalletAddress.trim() || undefined;
    },
    tracker,
  };
}

// Keep response/error semantics unchanged; export remains best-effort via after().
export async function withRequestLifecycle(args: {
  request: Request;
  flowName: LifecycleFlowName;
  flowVariant: LifecycleFlowVariant;
  stage: LifecycleFlowStage;
  success?: LifecycleDiagnostics;
  run: (lifecycle: RequestLifecycle | null) => Promise<Response>;
}): Promise<Response> {
  const lifecycle = createRequestLifecycle(args);
  lifecycle?.tracker.start(args.stage);
  try {
    const response = await args.run(lifecycle);
    if (response.ok) {
      lifecycle?.tracker.complete(args.stage, {
        ...args.success,
        httpStatus: response.status,
      });
    } else if (lifecycle) {
      let body: { error?: { code?: unknown } } | null = null;
      try {
        body = await response.clone().json();
      } catch {
        /* Telemetry must not change the response. */
      }
      lifecycle.tracker.fail(args.stage, {
        errorCode: normalizeLifecycleErrorCode(body?.error?.code),
        httpStatus: response.status,
      });
    }
    return response;
  } catch (error) {
    lifecycle?.tracker.fail(args.stage, {
      errorCode: "unexpected_error",
      httpStatus: 500,
    });
    throw error;
  }
}
