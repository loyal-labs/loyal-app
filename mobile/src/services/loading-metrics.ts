import { Platform } from "react-native";

import { env } from "@/config/env";

import {
  getObservabilityEnvironment,
  getObservabilityRelease,
  postObservabilityJson,
} from "./observability";
import {
  MOBILE_LOADING_METRIC_NAME,
  parseMobileLoadingMetricEnvelope,
  type MobileLoadingMetricEnvelope,
  type MobileLoadingOperation,
} from "./loading-metrics-contract";

export type { MobileLoadingOperation } from "./loading-metrics-contract";

type MobileLoadingAttempt = {
  completeAfterPaint: () => void;
  failAfterPaint: () => void;
  flowId: string;
};

declare global {
  // Initialized in mobile/index.js before expo-router loads route modules.
  // `var` is required for a global declaration merged into JavaScript globals.
  var __loyalMobileAppStartedAtMs: number | undefined;
}

const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MOBILE_METRICS_PATH = "/api/observability/mobile/metrics";

let currentPathname = "/";
let appLoadCaptured = false;

function generateUuid(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.trunc(Math.random() * 16);
    const value = char === "x" ? random : (random % 4) + 8;
    return value.toString(16);
  });
}

const appSessionId = generateUuid();

function normalizeDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return 0;
  return (
    Math.round(Math.min(MAX_DURATION_MS, Math.max(0, durationMs)) * 1000) / 1000
  );
}

function afterPaint(callback: () => void): void {
  const schedule = globalThis.requestAnimationFrame;
  if (typeof schedule !== "function") {
    setTimeout(callback, 0);
    return;
  }
  schedule(() => schedule(callback));
}

function reportMetric(args: {
  durationMs: number;
  flowId?: string;
  operation: MobileLoadingOperation;
  outcome: "completed" | "failed";
  phase: MobileLoadingMetricEnvelope["phase"];
}): void {
  try {
    const envelope = parseMobileLoadingMetricEnvelope({
      appSessionId,
      durationMs: normalizeDuration(args.durationMs),
      environment: getObservabilityEnvironment(),
      ...(args.flowId ? { flowId: args.flowId } : {}),
      metricName: MOBILE_LOADING_METRIC_NAME,
      operation: args.operation,
      outcome: args.outcome,
      pathname: currentPathname,
      phase: args.phase,
      platform: Platform.OS === "ios" ? "ios" : "android",
      release: getObservabilityRelease(),
      timestamp: new Date().toISOString(),
    });
    void postObservabilityJson(
      MOBILE_METRICS_PATH,
      envelope,
      env.observabilityBaseUrl
    );
  } catch {
    // Metrics are best-effort and must never alter application behavior.
  }
}

export function setMobileLoadingMetricsPathname(pathname: string): void {
  if (pathname.startsWith("/")) currentPathname = pathname;
}

export function startMobileLoadingMetric(
  operation: Exclude<MobileLoadingOperation, "app_load">
): MobileLoadingAttempt {
  const flowId = generateUuid();
  const startedAtMs = Date.now();
  let terminal = false;

  const finish = (outcome: "completed" | "failed") => {
    if (terminal) return;
    terminal = true;
    afterPaint(() => {
      reportMetric({
        durationMs: Date.now() - startedAtMs,
        flowId,
        operation,
        outcome,
        phase: "interaction_to_ui",
      });
    });
  };

  return {
    completeAfterPaint: () => finish("completed"),
    failAfterPaint: () => finish("failed"),
    flowId,
  };
}

export function captureMobileAppLoadMetricAfterPaint(): void {
  if (appLoadCaptured) return;
  appLoadCaptured = true;
  const startedAtMs = globalThis.__loyalMobileAppStartedAtMs ?? Date.now();
  afterPaint(() => {
    reportMetric({
      durationMs: Date.now() - startedAtMs,
      operation: "app_load",
      outcome: "completed",
      phase: "app_ready",
    });
  });
}
