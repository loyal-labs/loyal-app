"use client";

import type { BrowserChunkRecoveryAction } from "./chunk-load-contract";
import {
  getBrowserPageSessionId,
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
import {
  type BrowserLoadingMetricEnvelope,
  classifyBrowserLoadingDependencyUrl,
  createBrowserLoadingMetricEnvelope,
  type FrontendLoadingDependency,
  type FrontendLoadingOperation,
  type FrontendLoadingOutcome,
  type FrontendLoadingPhase,
  type FrontendLoadingPresentation,
  OBSERVABILITY_METRICS_ENDPOINT,
} from "./metrics-contract";

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

async function postBrowserLoadingMetric(
  envelope: BrowserLoadingMetricEnvelope
): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    CLIENT_REPORT_TIMEOUT_MS
  );

  try {
    await fetch(OBSERVABILITY_METRICS_ENDPOINT, {
      body: JSON.stringify(envelope),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
      signal: controller.signal,
    });
  } catch {
    // Performance telemetry is best-effort and must never affect the flow.
  } finally {
    window.clearTimeout(timeout);
  }
}

export type CaptureBrowserLoadingMetricArgs = {
  dependency?: FrontendLoadingDependency;
  durationMs: number;
  flowId?: string;
  operation: FrontendLoadingOperation;
  outcome?: FrontendLoadingOutcome;
  phase: FrontendLoadingPhase;
  presentation?: FrontendLoadingPresentation;
  requestCount?: number;
};

export function captureBrowserLoadingMetric(
  args: CaptureBrowserLoadingMetricArgs
): void {
  try {
    const envelope = createBrowserLoadingMetricEnvelope({
      ...args,
      outcome: args.outcome ?? "completed",
      pageSessionId: getBrowserPageSessionId(),
    });
    void postBrowserLoadingMetric(envelope).catch(() => undefined);
  } catch {
    // Performance capture itself is never allowed to throw.
  }
}

export function getBrowserPerformanceNow(): number {
  try {
    return window.performance.now();
  } catch {
    return Date.now();
  }
}

export function captureBrowserLoadingMetricAfterPaint(
  args: Omit<CaptureBrowserLoadingMetricArgs, "durationMs"> & {
    shouldCapture?: () => boolean;
    startedAtMs: number;
  }
): void {
  const { shouldCapture, startedAtMs, ...metric } = args;
  const emit = () => {
    if (shouldCapture && !shouldCapture()) {
      return;
    }
    captureBrowserLoadingMetric({
      ...metric,
      durationMs: Math.max(0, getBrowserPerformanceNow() - startedAtMs),
    });
  };

  try {
    if (document.visibilityState === "visible") {
      window.requestAnimationFrame(() => window.requestAnimationFrame(emit));
      return;
    }
    window.setTimeout(emit, 0);
  } catch {
    emit();
  }
}

export function captureBrowserSubmittedFailureMetricAfterPaint(args: {
  flowId: string;
  operation: Exclude<FrontendLoadingOperation, "page_load">;
  startedAtMs: number | null;
}): void {
  if (args.startedAtMs === null) {
    return;
  }

  captureBrowserLoadingMetricAfterPaint({
    flowId: args.flowId,
    operation: args.operation,
    outcome: "failed",
    phase: "wallet_confirmation_to_ui",
    startedAtMs: args.startedAtMs,
  });
}

type BrowserResourceEntry = {
  duration: number;
  initiatorType?: string;
  name: string;
  startTime: number;
};

const DEPENDENCY_INITIATOR_TYPES = new Set(["fetch", "xmlhttprequest"]);

type DependencyEntryCollector = {
  collect: () => BrowserResourceEntry[];
};

// The Resource Timing buffer stops recording once it fills (250 entries by
// default), and this app polls Solana RPC for the life of the tab. Observing
// the stream keeps preparation measurable in a long-lived session instead of
// silently reporting zeroes once the buffer is full.
function observeDependencyEntries(): DependencyEntryCollector | null {
  try {
    if (typeof window.PerformanceObserver !== "function") {
      return null;
    }

    const observed: BrowserResourceEntry[] = [];
    const observer = new window.PerformanceObserver((list) => {
      observed.push(
        ...(list.getEntries() as unknown as BrowserResourceEntry[])
      );
    });
    observer.observe({ buffered: false, type: "resource" });

    return {
      collect: () => {
        try {
          // Entries recorded just before disconnect are still queued for the
          // callback task, so drain them before dropping the observer.
          observed.push(
            ...(observer.takeRecords() as unknown as BrowserResourceEntry[])
          );
          observer.disconnect();
        } catch {
          // A partial observation still describes the preparation window.
        }
        return observed;
      },
    };
  } catch {
    return null;
  }
}

function readBufferedDependencyEntries(): BrowserResourceEntry[] {
  try {
    return window.performance.getEntriesByType(
      "resource"
    ) as unknown as BrowserResourceEntry[];
  } catch {
    return [];
  }
}

function summarizeDependencyEntries(args: {
  endedAtMs: number;
  entries: readonly BrowserResourceEntry[];
  rpcEndpoint: string | undefined;
  startedAtMs: number;
}): Map<
  FrontendLoadingDependency,
  { durationMs: number; requestCount: number }
> {
  const totals = new Map<
    FrontendLoadingDependency,
    { durationMs: number; requestCount: number }
  >(
    (["loyal_api", "solana_rpc", "third_party_api"] as const).map(
      (dependency) => [dependency, { durationMs: 0, requestCount: 0 }]
    )
  );
  try {
    for (const entry of args.entries) {
      if (
        entry.startTime < args.startedAtMs ||
        entry.startTime > args.endedAtMs ||
        !DEPENDENCY_INITIATOR_TYPES.has(entry.initiatorType ?? "")
      ) {
        continue;
      }
      const dependency = classifyBrowserLoadingDependencyUrl({
        pageOrigin: window.location.origin,
        resourceUrl: entry.name,
        rpcEndpoint: args.rpcEndpoint,
      });
      if (!dependency) continue;

      const current = totals.get(dependency);
      if (!current) continue;
      current.durationMs += Math.max(0, entry.duration);
      current.requestCount += 1;
    }
  } catch {
    // Resource Timing is optional; zero-count metrics still describe coverage.
  }

  return totals;
}

export async function measureBrowserLoadingDependencies<T>(args: {
  flowId: string;
  operation: Exclude<FrontendLoadingOperation, "page_load">;
  rpcEndpoint?: string;
  run: () => Promise<T>;
}): Promise<T> {
  const collector = observeDependencyEntries();
  const startedAtMs = getBrowserPerformanceNow();
  let outcome: FrontendLoadingOutcome = "completed";
  try {
    return await args.run();
  } catch (error) {
    outcome = "failed";
    throw error;
  } finally {
    const endedAtMs = getBrowserPerformanceNow();
    const dependencies = summarizeDependencyEntries({
      endedAtMs,
      entries: collector
        ? collector.collect()
        : readBufferedDependencyEntries(),
      rpcEndpoint: args.rpcEndpoint,
      startedAtMs,
    });
    for (const [dependency, measurement] of dependencies) {
      captureBrowserLoadingMetric({
        dependency,
        durationMs: measurement.durationMs,
        flowId: args.flowId,
        operation: args.operation,
        outcome,
        phase: "dependency",
        requestCount: measurement.requestCount,
      });
    }
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
