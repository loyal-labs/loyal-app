// ClickStack error reporting (ASK-1804) — posts unhandled JS errors, fatal JS
// crashes, and unhandled promise rejections to the askloyal.com observability
// ingest at `/api/observability/mobile/errors`, the mobile twin of the browser
// pipeline in `frontend/src/features/observability`. The envelope shape is a
// hand-written twin of `MobileErrorEnvelope` in
// `frontend/src/features/observability/error-contract.ts` — keep them in sync.
//
// Best-effort by design: every path here swallows its own failures. Telemetry
// must never crash the app or block a user flow. Native crashes (JS VM dies
// before this code runs) stay with Datadog — this covers the JS layer only.

import * as Updates from "expo-updates";

import { env } from "@/config/env";

type MobileErrorOperation =
  | "mobile.global_error"
  | "mobile.fatal_error"
  | "mobile.unhandled_rejection";

type MobileErrorEnvelope = {
  environment: string;
  message: string;
  name: string;
  operation: MobileErrorOperation;
  pathname: string;
  release: string;
  stack?: string;
  timestamp: string;
};

// Server-side caps from the error contract — truncate client-side too so
// envelopes stay well under the 16KB request limit.
const MAX_ERROR_NAME_LENGTH = 80;
const MAX_ERROR_MESSAGE_LENGTH = 512;
const MAX_ERROR_STACK_LENGTH = 4096;
const REPORT_TIMEOUT_MS = 1250;
const DEDUP_WINDOW_MS = 5000;
const DEDUP_MAX_ENTRIES = 128;

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

type ErrorUtilsLike = {
  getGlobalHandler?: () => GlobalErrorHandler | null;
  setGlobalHandler?: (handler: GlobalErrorHandler) => void;
};

type HermesInternalLike = {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
  }) => void;
};

let initialized = false;
let currentPathname = "/";
const recentReports = new Map<string, number>();

/** Track the active expo-router pathname so reports name the screen. */
export function setObservabilityPathname(pathname: string): void {
  if (pathname.startsWith("/")) {
    currentPathname = pathname;
  }
}

// Same channel → environment mapping as `src/lib/datadog/datadog.ts`
// (not imported from there: that module top-level imports the Datadog native
// SDK, which must stay lazy-loaded).
function getEnvironment(): string {
  const channel = Updates.channel ?? "";
  if (channel === "production") return "prod";
  if (channel === "preview") return "preview";
  if (channel === "dapp-store") return "prod";
  return "dev";
}

// Binary runtime version plus the OTA update that is actually running — the
// fleet mixes binaries and OTA bundles, so neither alone identifies the code.
function getRelease(): string {
  const updatePrefix = Updates.updateId?.split("-")[0];
  return (
    [Updates.runtimeVersion, updatePrefix].filter(Boolean).join("_") || "dev"
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function normalizeError(error: unknown): {
  message: string;
  name: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      message: truncate(error.message || "Unknown error.", MAX_ERROR_MESSAGE_LENGTH),
      name: truncate(error.name || "Error", MAX_ERROR_NAME_LENGTH),
      ...(error.stack
        ? { stack: truncate(error.stack, MAX_ERROR_STACK_LENGTH) }
        : {}),
    };
  }

  if (typeof error === "string") {
    return {
      message: truncate(error, MAX_ERROR_MESSAGE_LENGTH),
      name: "NonErrorException",
    };
  }

  return {
    message: "Unhandled non-Error exception.",
    name: "NonErrorException",
  };
}

function isDuplicate(envelope: MobileErrorEnvelope): boolean {
  const now = Date.now();
  const fingerprint = [
    envelope.pathname,
    envelope.name,
    envelope.message,
    envelope.stack ?? "",
  ].join("\u0000");

  for (const [key, reportedAt] of recentReports) {
    if (now - reportedAt > DEDUP_WINDOW_MS) {
      recentReports.delete(key);
    }
  }

  const previous = recentReports.get(fingerprint);
  if (previous !== undefined && now - previous <= DEDUP_WINDOW_MS) {
    return true;
  }

  if (recentReports.size >= DEDUP_MAX_ENTRIES) {
    const oldestKey = recentReports.keys().next().value;
    if (typeof oldestKey === "string") {
      recentReports.delete(oldestKey);
    }
  }
  recentReports.set(fingerprint, now);
  return false;
}

async function postJson(path: string, payload: unknown): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (env.vercelProtectionBypass) {
      headers["x-vercel-protection-bypass"] = env.vercelProtectionBypass;
    }
    await fetch(`${env.earnApiBaseUrl}${path}`, {
      body: JSON.stringify(payload),
      headers,
      method: "POST",
      signal: controller.signal,
    });
  } catch {
    // Telemetry is best-effort and must never affect the app.
  } finally {
    clearTimeout(timeout);
  }
}

function postEnvelope(envelope: MobileErrorEnvelope): Promise<void> {
  return postJson("/api/observability/mobile/errors", envelope);
}

function report(error: unknown, operation: MobileErrorOperation): void {
  try {
    const envelope: MobileErrorEnvelope = {
      ...normalizeError(error),
      environment: getEnvironment(),
      operation,
      pathname: currentPathname,
      release: getRelease(),
      timestamp: new Date().toISOString(),
    };
    if (isDuplicate(envelope)) {
      return;
    }
    void postEnvelope(envelope);
  } catch {
    // Never let the reporter itself throw inside a global error handler.
  }
}

/**
 * Install the global JS error and unhandled-rejection hooks. Call once on app
 * boot. Chains onto any previously installed handler (Datadog registers its
 * own via `trackErrors`), so both sinks keep receiving errors.
 */
export function initObservability(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  try {
    const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike })
      .ErrorUtils;
    const previousHandler = errorUtils?.getGlobalHandler?.() ?? null;
    errorUtils?.setGlobalHandler?.((error, isFatal) => {
      report(error, isFatal ? "mobile.fatal_error" : "mobile.global_error");
      previousHandler?.(error, isFatal);
    });

    const hermes = (globalThis as { HermesInternal?: HermesInternalLike })
      .HermesInternal;
    hermes?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, rejection) => {
        report(rejection, "mobile.unhandled_rejection");
        if (__DEV__) {
          // Enabling the tracker replaces RN's default dev warning — keep it.
          console.warn("Possible unhandled promise rejection:", rejection);
        }
      },
    });
  } catch (error) {
    console.warn("[observability] init failed", error);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle flow tracing — twin of `createLifecycleTracker` in
// `frontend/src/features/observability/lifecycle-contract.ts`, posting to the
// mobile events ingest. Flow/variant/stage names and every diagnostics field
// are validated server-side against that contract; an envelope that drifts
// from it is silently dropped, so keep the vocabularies below in sync.

type LifecycleVariantMap = {
  "auth.sign_in":
    | "seed_vault"
    | "wallet_adapter"
    | "import_wallet"
    | "new_wallet";
  "earn.deposit": "initial" | "top_up";
  "earn.withdrawal": "partial" | "full";
  "earn.autodeposit.configuration":
    | "setup"
    | "floor_update"
    | "pause"
    | "resume"
    | "close";
  "earn.autodeposit.execute_now": "execute_now";
};

type LifecycleStageMap = {
  "auth.sign_in":
    | "intent"
    | "wallet_connect"
    | "challenge"
    | "completion"
    | "ui_commit";
  "earn.deposit":
    | "intent"
    | "prepare"
    | "policy"
    | "policy_finalize"
    | "wallet_submit_confirm"
    | "backend_confirm"
    | "ui_commit";
  "earn.withdrawal":
    | "intent"
    | "prepare"
    | "autodeposit_close"
    | "wallet_submit_confirm"
    | "backend_confirm"
    | "full_exit_verify"
    | "cleanup"
    | "ui_commit";
  "earn.autodeposit.configuration":
    | "intent"
    | "prepare"
    | "wallet_approval"
    | "create_policy"
    | "create_recurring_delegation"
    | "backend_confirm"
    | "bootstrap"
    | "ui_commit";
  "earn.autodeposit.execute_now":
    | "intent"
    | "request"
    | "state_observed"
    | "ui_commit";
};

type LifecycleFlowName = keyof LifecycleVariantMap;

type LifecycleErrorCode =
  | "unexpected_error"
  | "request_failed"
  | "unconfirmed_signature"
  | "backend_confirmation_failed"
  | "send_failed";

export type LifecycleDiagnostics = {
  autodepositCloseRequired?: boolean;
  chainState?: "not_submitted" | "submitted" | "confirmed" | "failed";
  cleanupRequired?: boolean;
  errorCode?: LifecycleErrorCode;
  executeNowState?: "requested" | "completed";
  executionMode?: "batch" | "sequential" | "single";
  persistenceState?: "not_started" | "recorded" | "failed";
  policyMode?: "create" | "reuse";
  recoveryRequired?: boolean;
};

export type LifecycleFlow<F extends LifecycleFlowName> = {
  cancel: (
    stage: LifecycleStageMap[F],
    diagnostics?: LifecycleDiagnostics,
  ) => void;
  complete: (
    stage: LifecycleStageMap[F],
    diagnostics?: LifecycleDiagnostics,
  ) => void;
  fail: (
    stage: LifecycleStageMap[F],
    diagnostics?: LifecycleDiagnostics,
  ) => void;
  /** Sent as `x-loyal-flow-id` so server-side stages join the same flow. */
  flowId: string;
  observe: (
    stage: LifecycleStageMap[F],
    diagnostics?: LifecycleDiagnostics,
  ) => void;
  setVariant: (variant: LifecycleVariantMap[F]) => void;
  setWalletAddress: (walletAddress: string) => void;
  start: (
    stage: LifecycleStageMap[F],
    diagnostics?: LifecycleDiagnostics,
  ) => void;
};

/** Map a flow failure onto the contract's error-code vocabulary. */
export function mapLifecycleErrorCode(error: unknown): LifecycleErrorCode {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "unconfirmed_signature") return "unconfirmed_signature";
    return "request_failed";
  }
  if (error instanceof TypeError) return "request_failed";
  return "unexpected_error";
}

function generateFlowId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  // v4-shaped fallback — the id only correlates events within one flow.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.trunc(Math.random() * 16);
    const value = char === "x" ? random : (random % 4) + 8;
    return value.toString(16);
  });
}

/**
 * Start a traced flow. Emissions are fire-and-forget; a terminal outcome
 * (complete/fail) latches the flow and later emissions become no-ops, so a
 * blanket `fail` in an outer catch never overwrites a more precise inner one.
 */
// The ingest drops any envelope whose walletAddress isn't base58 — guard here
// so one bad address never costs the whole event.
const WALLET_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function startLifecycleFlow<F extends LifecycleFlowName>(args: {
  flowName: F;
  flowVariant: LifecycleVariantMap[F];
  walletAddress?: string;
}): LifecycleFlow<F> {
  const flowId = generateFlowId();
  const startedAt = Date.now();
  let lastAt = startedAt;
  let variant: LifecycleVariantMap[F] = args.flowVariant;
  let walletAddress =
    args.walletAddress && WALLET_ADDRESS_PATTERN.test(args.walletAddress)
      ? args.walletAddress
      : undefined;
  let terminal = false;

  const emit = (
    outcome: "started" | "observed" | "completed" | "failed" | "cancelled",
    stage: LifecycleStageMap[F],
    diagnostics: LifecycleDiagnostics = {},
  ): void => {
    try {
      if (terminal) return;
      const current = Date.now();
      const envelope = {
        ...diagnostics,
        durationMs: Math.min(900_000, Math.max(0, current - lastAt)),
        elapsedMs: Math.min(86_400_000, Math.max(0, current - startedAt)),
        environment: getEnvironment(),
        flowId,
        flowName: args.flowName,
        flowVariant: variant,
        outcome,
        pathname: currentPathname,
        release: getRelease(),
        runtime: "mobile",
        source: "mobile_app",
        stage,
        timestamp: new Date(current).toISOString(),
        ...(walletAddress ? { walletAddress } : {}),
      };
      lastAt = current;
      if (
        outcome === "completed" ||
        outcome === "failed" ||
        outcome === "cancelled"
      ) {
        terminal = true;
      }
      void postJson("/api/observability/mobile/events", envelope);
    } catch {
      // Telemetry is best-effort and must never affect the flow it traces.
    }
  };

  return {
    cancel: (stage, diagnostics) => emit("cancelled", stage, diagnostics),
    complete: (stage, diagnostics) => emit("completed", stage, diagnostics),
    fail: (stage, diagnostics) => emit("failed", stage, diagnostics),
    flowId,
    observe: (stage, diagnostics) => emit("observed", stage, diagnostics),
    setVariant: (next) => {
      variant = next;
    },
    setWalletAddress: (next) => {
      if (WALLET_ADDRESS_PATTERN.test(next)) {
        walletAddress = next;
      }
    },
    start: (stage, diagnostics) => emit("started", stage, diagnostics),
  };
}
