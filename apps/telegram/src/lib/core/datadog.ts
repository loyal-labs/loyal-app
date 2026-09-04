import { datadogLogs } from "@datadog/browser-logs";
import type { RumErrorEvent } from "@datadog/browser-rum";
import { datadogRum } from "@datadog/browser-rum";
import { reactPlugin } from "@datadog/browser-rum-react";

import { publicEnv } from "@/lib/core/config/public";
import type { TelegramIdentity } from "@/lib/telegram/mini-app/init-data-transform";

interface EarlyError {
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  timestamp: number;
}

declare global {
  interface Window {
    __dd_early_errors?: EarlyError[];
  }
}

function getDatadogEnv(): string {
  const branch = publicEnv.gitBranch;
  if (branch === "main") return "prod";
  if (branch === "dev") return "dev";
  return "preview";
}

// Shared config — RUM and Logs SDKs must agree on session-related
// options so they share the same _dd_s cookie for correlation.
const sharedConfig = {
  clientToken: "pub65e82b493fbf5faa4c3847345e32e609",
  site: "us5.datadoghq.com",
  service: "app-frontend",
  env: getDatadogEnv(),
  version: publicEnv.gitCommitHash,
} as const;

/**
 * Drop opaque "Script error." events that carry no actionable info.
 * These are produced by cross-origin script failures (Same-Origin Policy)
 * and are especially common in Telegram WebViews on Android.
 */
function isOpaqueScriptError(event: RumErrorEvent): boolean {
  const msg = event.error.message;
  return msg === "Script error." || msg === "Script error";
}

/**
 * Install a global error handler BEFORE Datadog SDK loads so we can
 * capture real error details that the browser would otherwise mask as
 * "Script error." for cross-origin scripts.
 */
function installEarlyErrorCatcher() {
  if (typeof window === "undefined") return;
  if (window.__dd_early_errors) return;

  const earlyErrors: EarlyError[] = [];
  window.__dd_early_errors = earlyErrors;

  const originalOnError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    const msg = typeof message === "string" ? message : String(message);
    // Only capture non-opaque errors (ones with real info)
    if (msg !== "Script error." && msg !== "Script error") {
      earlyErrors.push({
        message: error?.stack ?? msg,
        source: source ?? undefined,
        lineno: lineno ?? undefined,
        colno: colno ?? undefined,
        timestamp: Date.now(),
      });
    }
    if (originalOnError) {
      return originalOnError.call(
        window,
        message,
        source,
        lineno,
        colno,
        error
      );
    }
    return false;
  };
}

let initialized = false;

export function initDatadog() {
  if (initialized) return;

  if (typeof window !== "undefined") {
    const { hostname } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") return;
  }

  installEarlyErrorCatcher();

  initialized = true;

  datadogRum.init({
    ...sharedConfig,
    applicationId: "67ad7dc6-b0d4-4ef4-9dec-3ded01bf7a9a",
    sessionSampleRate: 100,
    sessionReplaySampleRate: 0,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    defaultPrivacyLevel: "mask-user-input",
    plugins: [reactPlugin({ router: false })],
    beforeSend(event) {
      if (
        event.type === "error" &&
        isOpaqueScriptError(event as RumErrorEvent)
      ) {
        return false;
      }
      return true;
    },
  });

  datadogLogs.init({
    ...sharedConfig,
    sessionSampleRate: 100,
    forwardErrorsToLogs: true,
    forwardConsoleLogs: ["warn", "error"],
    forwardReports: "all",
    beforeSend(event) {
      if (
        event.message === "Script error." ||
        event.message === "Script error"
      ) {
        return false;
      }
      return true;
    },
  });

  // Forward any real errors captured before DD SDK initialized
  if (window.__dd_early_errors?.length) {
    for (const err of window.__dd_early_errors) {
      datadogLogs.logger.error("Early boot error", {
        message: err.message,
        source: err.source,
        lineno: err.lineno,
        colno: err.colno,
        capturedAt: err.timestamp,
      });
    }
    window.__dd_early_errors = [];
  }
}

export function identifyDatadogUser(identity: TelegramIdentity): void {
  datadogRum.setUser({
    id: identity.telegramId,
    name: identity.username ?? identity.firstName,
    telegramUsername: identity.username,
    isPremium: identity.isPremium,
  });
}
