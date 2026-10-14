"use client";

import { journeyTraceparent, type JourneyTraceContext } from "./trace-context";

import type { BrowserChunkRecoveryAction } from "./chunk-load-contract";
import { captureDatadogJourney, getDatadogSessionId } from "./datadog.client";
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
  fallbackRandomUuidV4,
  isCanonicalUuidV4,
  LIFECYCLE_VARIANTS,
  type LifecycleClientPlatform,
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
const JOURNEY_WINDOW_MS = 10 * 60 * 1000;
const browserJourneys = new Map<
  string,
  {
    id: string;
    startedAt: number;
    attempt: number;
  }
>();

const JOURNEY_STORAGE_KEY = "loyal.journeys.v2";
let journeyOwner: string | undefined;
let identityEpoch = 0;

function persistBrowserJourneys(): void {
  if (!journeyOwner || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      JOURNEY_STORAGE_KEY,
      JSON.stringify({ owner: journeyOwner, journeys: [...browserJourneys] })
    );
  } catch {
    /* Storage restrictions must not block a user action. */
  }
}

export async function restoreBrowserJourneys(
  walletAddress: string | null
): Promise<void> {
  if (typeof window === "undefined") return;
  const epoch = identityEpoch;
  try {
    const digest = walletAddress
      ? await crypto.subtle.digest(
          "SHA-256",
          new Uint8Array(new TextEncoder().encode(walletAddress)).buffer
        )
      : null;
    const owner = digest
      ? Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("")
      : "anonymous";
    if (epoch !== identityEpoch || journeyOwner === owner) return;
    const saved = JSON.parse(
      window.sessionStorage.getItem(JOURNEY_STORAGE_KEY) ?? "null"
    );
    if (
      saved?.owner === owner &&
      Array.isArray(saved.journeys) &&
      saved.journeys.length <= 100
    ) {
      const allowed = new Set(
        Object.entries(LIFECYCLE_VARIANTS).flatMap(([flow, variants]) =>
          variants.map(
            (variant) =>
              `${flow}:${variant === "resumed" ? "initial" : variant}`
          )
        )
      );
      for (const entry of saved.journeys) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [key, value] = entry;
        if (
          allowed.has(key) &&
          !browserJourneys.has(key) &&
          value &&
          isCanonicalUuidV4(value.id) &&
          Number.isInteger(value.attempt) &&
          value.attempt >= 1 &&
          value.attempt < 1000 &&
          Number.isFinite(value.startedAt) &&
          value.startedAt <= Date.now() &&
          Date.now() - value.startedAt < JOURNEY_WINDOW_MS
        ) {
          browserJourneys.set(key, {
            id: value.id,
            attempt: value.attempt,
            startedAt: value.startedAt,
          });
        }
      }
    }
    journeyOwner = owner;
    persistBrowserJourneys();
  } catch {
    /* Corrupt storage or unavailable hashing disables reload continuity. */
  }
}

let authenticatedActionState: "idle" | "running" | "complete" = "idle";
const attemptContexts = new Map<
  string,
  {
    journeyId: string;
    attemptNumber: number;
    flowVariant: string;
    traceContext: JourneyTraceContext;
  }
>();

export function resetBrowserJourneys(): void {
  identityEpoch += 1;
  journeyOwner = undefined;
  try {
    window.sessionStorage.removeItem(JOURNEY_STORAGE_KEY);
  } catch {
    /* SSR/private browsing. */
  }
  authenticatedActionState = "idle";
  attemptContexts.clear();
  browserJourneys.clear();
}

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
): Promise<"external" | "internal" | "synthetic" | undefined> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    // Allow session resolution and the 1.25s exporter budget to return the cohort.
    5000
  );

  try {
    const response = await fetch(OBSERVABILITY_LIFECYCLE_ENDPOINT, {
      body: JSON.stringify(envelope),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (["external", "internal", "synthetic"].includes(body?.trafficKind))
      return body.trafficKind;
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
    const epoch = identityEpoch;
    const rumSessionId = getDatadogSessionId();
    if (rumSessionId) envelope = { ...envelope, rumSessionId };
    void postBrowserLifecycle(envelope)
      .then((trafficKind) => {
        if (identityEpoch === epoch)
          captureDatadogJourney(envelope, trafficKind);
      })
      .catch(() => undefined);
  } catch {
    // Lifecycle capture itself is never allowed to throw.
  }
}

// Client Hints where available, user-agent tokens otherwise. iPadOS reports a
// "Macintosh" user agent; multi-touch is the only tell, and it is scoped to
// that UA so touchscreen laptops keep reporting desktop.
function detectBrowserClientPlatform(): LifecycleClientPlatform {
  try {
    const userAgentData = (
      navigator as Navigator & { userAgentData?: { mobile?: boolean } }
    ).userAgentData;
    if (typeof userAgentData?.mobile === "boolean") {
      return userAgentData.mobile ? "mobile" : "desktop";
    }
    const userAgent = navigator.userAgent;
    if (/Android|iPad|iPhone|iPod|Mobile/i.test(userAgent)) {
      return "mobile";
    }
    if (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1) {
      return "mobile";
    }
    return "desktop";
  } catch {
    return "desktop";
  }
}

export function createBrowserLifecycleTracker(args: {
  flowId?: string;
  flowName: LifecycleFlowName;
  flowVariant: LifecycleFlowVariant;
  pathname?: string;
}): LifecycleTracker {
  const trackerIdentityEpoch = identityEpoch;
  const key = `${args.flowName}:${
    args.flowVariant === "resumed" ? "initial" : args.flowVariant
  }`;
  const previous = browserJourneys.get(key);
  const pageSessionId = getBrowserPageSessionId();
  const journey =
    previous &&
    Date.now() - previous.startedAt < JOURNEY_WINDOW_MS &&
    previous.attempt < 1000
      ? { ...previous, attempt: previous.attempt + 1 }
      : { id: fallbackRandomUuidV4(), startedAt: Date.now(), attempt: 1 };
  browserJourneys.set(key, journey);
  persistBrowserJourneys();
  const traceContext = {
    traceId: fallbackRandomUuidV4().replaceAll("-", ""),
    spanId: fallbackRandomUuidV4().replaceAll("-", "").slice(0, 16),
  };
  const tracker = createLifecycleTracker({
    traceContext,
    journeyId: journey.id,
    attemptNumber: journey.attempt,
    ...(/^[0-9a-f]{40}$/.test(CLIENT_BUILD_ID)
      ? { clientBuildId: CLIENT_BUILD_ID }
      : {}),
    ...(pageSessionId ? { pageSessionId } : {}),
    ...(typeof window === "undefined"
      ? {}
      : { clientPlatform: detectBrowserClientPlatform() }),
    emit: (event) => {
      if (trackerIdentityEpoch !== identityEpoch) return;
      captureBrowserLifecycle(event);
      if (event.flowName === "auth.authenticated_action") {
        if (event.outcome === "completed")
          authenticatedActionState = "complete";
        if (event.outcome === "failed" || event.outcome === "cancelled")
          authenticatedActionState = "idle";
      }
      if (
        event.outcome === "completed" &&
        browserJourneys.get(key)?.id === journey.id
      ) {
        browserJourneys.delete(key);
        persistBrowserJourneys();
      }
    },
    ...(args.flowId ? { flowId: args.flowId } : {}),
    flowName: args.flowName,
    flowVariant: args.flowVariant,
    pathname:
      args.pathname ??
      (typeof window === "undefined" ? "/" : window.location.pathname),
  });
  if (attemptContexts.size >= 1000) attemptContexts.clear();
  attemptContexts.set(tracker.flowId, {
    traceContext,
    journeyId: journey.id,
    attemptNumber: journey.attempt,
    flowVariant: args.flowVariant,
  });
  return tracker;
}

export function createAuthenticatedActionTracker(): LifecycleTracker | null {
  if (authenticatedActionState !== "idle") return null;
  authenticatedActionState = "running";
  return createBrowserLifecycleTracker({
    flowName: "auth.authenticated_action",
    flowVariant: "overview",
  });
}

export function lifecycleFlowHeaders(flowId: string): Record<string, string> {
  const context = attemptContexts.get(flowId);
  return {
    "x-loyal-flow-id": flowId,
    ...(context
      ? {
          traceparent: journeyTraceparent(context.traceContext),
          "x-loyal-journey-id": context.journeyId,
          "x-loyal-attempt-number": String(context.attemptNumber),
          "x-loyal-flow-variant": context.flowVariant,
        }
      : {}),
  };
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
