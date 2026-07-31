"use client";

import type { BrowserChunkRecoveryAction } from "./chunk-load-contract";
import {
  inspectBrowserChunkLoadError,
  planBrowserChunkRecovery,
  recoverBrowserChunkLoadErrorOnce,
} from "./chunk-load-recovery";
import {
  type BrowserErrorEnvelope,
  type BrowserErrorOperation,
  createBrowserErrorEnvelope,
  createErrorDeduplicator,
  type ErrorDeduplicator,
  isCapWidgetInternalError,
  isThirdPartyExtensionError,
  OBSERVABILITY_ERROR_ENDPOINT,
} from "./error-contract";
import {
  type BrowserLifecycleEnvelope,
  createLifecycleTracker,
  type LifecycleFlowName,
  type LifecycleFlowVariant,
  type LifecycleTracker,
  OBSERVABILITY_LIFECYCLE_ENDPOINT,
} from "./lifecycle-contract";

const CLIENT_REPORT_TIMEOUT_MS = 1250;
const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_GIT_COMMIT_HASH ?? "unknown";

export type BrowserErrorProcessor = {
  process: (error: unknown, operation: BrowserErrorOperation) => Promise<void>;
};

declare global {
  interface Window {
    __loyalObservabilityListenersInstalled__?: boolean;
  }
}

async function postBrowserError(envelope: BrowserErrorEnvelope): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    CLIENT_REPORT_TIMEOUT_MS
  );

  try {
    await fetch(OBSERVABILITY_ERROR_ENDPOINT, {
      body: JSON.stringify(envelope),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
      signal: controller.signal,
    });
  } catch {
    // Telemetry is best-effort and must never affect the user flow.
  } finally {
    window.clearTimeout(timeout);
  }
}

async function postBrowserLifecycle(
  envelope: BrowserLifecycleEnvelope
): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    CLIENT_REPORT_TIMEOUT_MS
  );

  try {
    await fetch(OBSERVABILITY_LIFECYCLE_ENDPOINT, {
      body: JSON.stringify(envelope),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
      signal: controller.signal,
    });
  } catch {
    // Lifecycle telemetry is best-effort and must never affect the user flow.
  } finally {
    window.clearTimeout(timeout);
  }
}

export function captureBrowserLifecycle(
  envelope: BrowserLifecycleEnvelope
): void {
  try {
    void postBrowserLifecycle(envelope).catch(() => undefined);
  } catch {
    // Lifecycle capture itself is never allowed to throw.
  }
}

export function createBrowserLifecycleTracker(args: {
  flowId?: string;
  flowName: LifecycleFlowName;
  flowVariant: LifecycleFlowVariant;
  pathname?: string;
}): LifecycleTracker {
  return createLifecycleTracker({
    emit: captureBrowserLifecycle,
    ...(args.flowId ? { flowId: args.flowId } : {}),
    flowName: args.flowName,
    flowVariant: args.flowVariant,
    pathname:
      args.pathname ??
      (typeof window === "undefined" ? "/" : window.location.pathname),
  });
}

export function lifecycleFlowHeaders(flowId: string): HeadersInit {
  return { "x-loyal-flow-id": flowId };
}

function withChunkRecoveryAction(
  envelope: BrowserErrorEnvelope,
  recoveryAction: BrowserChunkRecoveryAction
): BrowserErrorEnvelope {
  return envelope.diagnostics
    ? { ...envelope, diagnostics: { ...envelope.diagnostics, recoveryAction } }
    : envelope;
}

export function createBrowserErrorProcessor(
  options: {
    deduplicator?: ErrorDeduplicator;
  } = {}
): BrowserErrorProcessor {
  const deduplicator = options.deduplicator ?? createErrorDeduplicator();

  return {
    process: async (error, operation) => {
      try {
        const chunkFailure = inspectBrowserChunkLoadError(
          error,
          CLIENT_BUILD_ID
        );
        const captured = createBrowserErrorEnvelope(error, operation, {
          ...(chunkFailure?.telemetry ?? {}),
        });
        if (
          isThirdPartyExtensionError(captured.operation, captured.stack) ||
          isCapWidgetInternalError(captured.operation, captured.message)
        ) {
          return;
        }
        if (deduplicator.isDuplicate(captured)) {
          return;
        }

        // Planned only after the drop checks: a suppressed duplicate must not
        // consume one of the bounded recovery attempts.
        const action = chunkFailure
          ? planBrowserChunkRecovery(chunkFailure.chunkUrl)
          : undefined;
        const envelope = action
          ? withChunkRecoveryAction(captured, action)
          : captured;

        const reportPromise = postBrowserError(envelope);
        if (
          action &&
          (await recoverBrowserChunkLoadErrorOnce(reportPromise, action))
        ) {
          return;
        }

        await reportPromise;
      } catch {
        // Error capture and recovery must never affect the user flow.
      }
    },
  };
}

const browserErrorProcessor = createBrowserErrorProcessor();

export function captureBrowserError(
  error: unknown,
  operation: BrowserErrorOperation
): void {
  try {
    void browserErrorProcessor.process(error, operation).catch(() => undefined);
  } catch {
    // Error capture itself is never allowed to throw.
  }
}

export function installBrowserErrorListeners(): void {
  if (
    typeof window === "undefined" ||
    window.__loyalObservabilityListenersInstalled__
  ) {
    return;
  }

  window.__loyalObservabilityListenersInstalled__ = true;
  window.addEventListener("error", (event) => {
    captureBrowserError(
      event.error ?? event.message ?? "Unknown browser error.",
      "browser.window.error"
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    captureBrowserError(event.reason, "browser.unhandled_rejection");
  });
}
