"use client";

import {
  type BrowserErrorOperation,
  createBrowserErrorEnvelope,
  createErrorDeduplicator,
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
const errorDeduplicator = createErrorDeduplicator();

declare global {
  interface Window {
    __loyalObservabilityListenersInstalled__?: boolean;
  }
}

async function postBrowserError(
  envelope: ReturnType<typeof createBrowserErrorEnvelope>
): Promise<void> {
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

export function captureBrowserError(
  error: unknown,
  operation: BrowserErrorOperation
): void {
  try {
    const envelope = createBrowserErrorEnvelope(error, operation);
    if (errorDeduplicator.isDuplicate(envelope)) {
      return;
    }

    void postBrowserError(envelope).catch(() => undefined);
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
