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
import {
  isConnectionFailure,
  isConnectionTimeout,
} from "@/lib/network/connection-failure";
import { isInsufficientSolError } from "@/lib/wallet/insufficient-sol-error";
import { hasLandedProgress, isWalletRejection } from "@/lib/wallet/rejection";
import {
  isWalletSessionError,
  type WalletSessionFailure,
} from "@/lib/wallet/wallet-session-error";

type MobileErrorOperation =
  | "mobile.global_error"
  | "mobile.fatal_error"
  | "mobile.unhandled_rejection";

type MobileErrorEnvelope = {
  deviceId?: string;
  devicePlatform?: "android" | "ios";
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

// Injected from `@/services/device-identity` at app init rather than imported:
// this module must stay free of react-native/storage imports so its test
// suite only has to mock expo-updates (ASK-2097). Envelopes sent before the
// injection simply omit the fields — the ingest treats them as optional.
let deviceIdentity: {
  deviceId: string;
  devicePlatform: "android" | "ios";
} | null = null;

export function setObservabilityDeviceIdentity(identity: {
  deviceId: string;
  devicePlatform: "android" | "ios";
}): void {
  deviceIdentity = identity;
}

// Same channel → environment mapping as `src/lib/datadog/datadog.ts`
// (not imported from there: that module top-level imports the Datadog native
// SDK, which must stay lazy-loaded).
export function getObservabilityEnvironment(): string {
  const channel = Updates.channel ?? "";
  if (channel === "production") return "prod";
  if (channel === "preview") return "preview";
  if (channel === "dapp-store") return "prod";
  return "dev";
}

// Binary runtime version plus the OTA update that is actually running — the
// fleet mixes binaries and OTA bundles, so neither alone identifies the code.
export function getObservabilityRelease(): string {
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
      message: truncate(
        error.message || "Unknown error.",
        MAX_ERROR_MESSAGE_LENGTH,
      ),
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

export async function postObservabilityJson(
  path: string,
  payload: unknown,
): Promise<void> {
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
  return postObservabilityJson("/api/observability/mobile/errors", envelope);
}

function report(
  error: unknown,
  operation: MobileErrorOperation,
  messagePrefix?: string,
): void {
  try {
    const normalized = normalizeError(error);
    const envelope: MobileErrorEnvelope = {
      ...normalized,
      ...(deviceIdentity ?? {}),
      environment: getObservabilityEnvironment(),
      ...(messagePrefix
        ? {
            message: truncate(
              `${messagePrefix} ${normalized.message}`,
              MAX_ERROR_MESSAGE_LENGTH,
            ),
          }
        : {}),
      operation,
      pathname: currentPathname,
      release: getObservabilityRelease(),
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
    | "cleanup_prepare"
    | "cleanup_wallet_submit_confirm"
    | "cleanup_backend_confirm"
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

// Every value here must exist in the backend's LIFECYCLE_ERROR_CODES
// (frontend/src/features/observability/lifecycle-contract.ts) — the ingest
// drops the whole envelope on an unknown code, so a typo costs the event.
type LifecycleErrorCode =
  | "unexpected_error"
  | "request_failed"
  | "unconfirmed_signature"
  | "backend_confirmation_failed"
  | "send_failed"
  | "insufficient_native_sol"
  | "wallet_rejected"
  | "wallet_authorization_expired"
  | "wallet_unavailable"
  | "wallet_connection_failed"
  | "wallet_connection_timeout"
  | "wallet_signing_failed";

// Same contract, same cost on a typo — an unknown detail is dropped rather
// than failing the envelope, so a mistake here costs the field silently.
// Mirrors the `request_failed` arm of the backend's LIFECYCLE_ERROR_DETAILS.
export type LifecycleErrorDetail =
  | "network_unreachable"
  | "request_timeout"
  | "kamino_upstream_unavailable"
  | "rpc_request_failed";

const LIFECYCLE_ERROR_DETAILS: readonly LifecycleErrorDetail[] = [
  "network_unreachable",
  "request_timeout",
  "kamino_upstream_unavailable",
  "rpc_request_failed",
];

export type LifecycleDiagnostics = {
  autodepositCloseRequired?: boolean;
  chainState?: "not_submitted" | "submitted" | "confirmed" | "failed";
  cleanupRequired?: boolean;
  errorCode?: LifecycleErrorCode;
  /**
   * Which underlying cause produced a broad `errorCode`. Set automatically by
   * `failFrom`; only worth passing by hand when a call site knows something
   * the error shape does not carry.
   */
  errorDetail?: LifecycleErrorDetail;
  executeNowState?:
    | "requested"
    | "selected"
    | "pull_confirmed"
    | "completed"
    | "failed"
    | "released"
    | "canceled";
  executionMode?: "batch" | "sequential" | "single";
  /**
   * Status the backend actually answered with. Its presence is the signal that
   * separates a real server failure from `request_failed` raised without any
   * response — a dead connection, or a wallet error that never left the device.
   */
  httpStatus?: number;
  persistenceState?: "not_started" | "recorded" | "failed";
  policyMode?: "create" | "reuse";
  recoveryRequired?: boolean;
  /**
   * Substage coordinates inside a coarse stage — which ordered sub-call a
   * `prepare` failure died in (ASK-2095). The ingest contract bounds them
   * (index 0–15, count 1–16); an out-of-range value drops the whole event.
   */
  stageCount?: number;
  stageIndex?: number;
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
  /**
   * Terminate the flow from a caught error, classifying it first: a user
   * declining a wallet prompt latches as `cancelled` (ingested at INFO),
   * everything else as `failed` (ERROR). Prefer this over `fail` in catch
   * blocks so no call site has to remember the distinction.
   */
  failFrom: (
    stage: LifecycleStageMap[F],
    error: unknown,
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

const WALLET_SESSION_ERROR_CODES: Record<
  WalletSessionFailure,
  LifecycleErrorCode
> = {
  authorization_expired: "wallet_authorization_expired",
  connection_failed: "wallet_connection_failed",
  signing_failed: "wallet_signing_failed",
  timeout: "wallet_connection_timeout",
  unavailable: "wallet_unavailable",
};

/** Map a flow failure onto the contract's error-code vocabulary. */
export function mapLifecycleErrorCode(error: unknown): LifecycleErrorCode {
  // Both wallet checks run before the `code` probe below: a rejection is a user
  // decision and a dead wallet session never reached the network, yet both
  // carry a `code` and so would otherwise report as `request_failed` (ASK-1872).
  if (isWalletRejection(error)) return "wallet_rejected";
  if (isWalletSessionError(error)) {
    return WALLET_SESSION_ERROR_CODES[error.failure];
  }
  // A wallet that can't fee-pay is user state, not an app defect — named so
  // it neither pages as `unexpected_error` nor hides as `request_failed`.
  if (isInsufficientSolError(error)) return "insufficient_native_sol";
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "unconfirmed_signature") return "unconfirmed_signature";
    return "request_failed";
  }
  // Only a connection-level TypeError is a failed request. Every other one is
  // a bug in our own code, and calling it `request_failed` both inflated that
  // code and hid the bug: `request_failed` is deliberately kept out of the
  // sanitized error ingest, so its message and stack were never reported
  // anywhere. As `unexpected_error` it reaches that ingest and is diagnosable.
  if (isConnectionFailure(error)) return "request_failed";
  return "unexpected_error";
}

function declaredErrorDetail(value: unknown): LifecycleErrorDetail | undefined {
  return LIFECYCLE_ERROR_DETAILS.includes(value as LifecycleErrorDetail)
    ? (value as LifecycleErrorDetail)
    : undefined;
}

// web3.js throws SolanaJSONRPCError with a numeric `code` and no HTTP status,
// so it lands in `request_failed` looking exactly like a dead connection.
// Brand-checked by name for the same reason as KaminoUpstreamError: Metro can
// resolve web3.js to more than one module instance, which would quietly make
// `instanceof` false.
function isRpcError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "SolanaJSONRPCError" &&
    typeof (error as { code?: unknown }).code === "number"
  );
}

/**
 * Name the cause behind a broad `errorCode`. Only a `request_failed` with no
 * `httpStatus` really needs this — nothing answered, so there is no status to
 * explain the failure and four unrelated incidents look identical (ASK-2018).
 *
 * Returns undefined when the cause is genuinely unknown. That is the honest
 * answer and a better one than a token that sends on-call somewhere wrong.
 */
export function mapLifecycleErrorDetail(
  error: unknown,
): LifecycleErrorDetail | undefined {
  // Already classified at the throw site, which saw the cause this layer
  // cannot: `withConnectionRetry` knows what it retried before giving up.
  const carried = declaredErrorDetail(
    error && typeof error === "object"
      ? (error as { detail?: unknown }).detail
      : undefined,
  );
  if (carried) return carried;
  if (error instanceof Error && error.name === "FetchTimeoutError") {
    return "request_timeout";
  }
  // Checked before the broader failure test, which also covers timeouts.
  if (isConnectionTimeout(error)) return "request_timeout";
  if (isConnectionFailure(error)) return "network_unreachable";
  if (isRpcError(error)) return "rpc_request_failed";
  return undefined;
}

/**
 * The HTTP status an API error carried, when the backend actually answered.
 * Duck-typed rather than imported so telemetry stays independent of the Earn
 * API client. Absent for network-level failures, which is the point: a
 * `request_failed` with no status never got a response.
 */
function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { status } = error as { status?: unknown };
  // Range-checked against the ingest's own bounds: an out-of-range value would
  // fail envelope validation and cost the entire event, not just this field.
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
    ? status
    : undefined;
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
// The lifecycle ingest drops any envelope whose flowId isn't a canonical v4,
// so an adopted id is checked before it can cost the whole flow's events.
const FLOW_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function startLifecycleFlow<F extends LifecycleFlowName>(args: {
  /**
   * Adopt the caller's id instead of minting one. The UI starts its loading
   * metric before this flow exists, so handing that metric's id down here is
   * what lets a latency point on the metrics dashboard join back to the
   * lifecycle events and error records that explain it. A malformed id is
   * ignored rather than propagated: telemetry never breaks the flow it traces.
   */
  flowId?: string;
  flowName: F;
  flowVariant: LifecycleVariantMap[F];
  /** Emit a correlated exception record when failFrom maps to unexpected_error. */
  reportUnexpectedErrors?: boolean;
  walletAddress?: string;
}): LifecycleFlow<F> {
  const flowId =
    args.flowId && FLOW_ID_PATTERN.test(args.flowId)
      ? args.flowId
      : generateFlowId();
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
        ...(deviceIdentity ?? {}),
        durationMs: Math.min(900_000, Math.max(0, current - lastAt)),
        elapsedMs: Math.min(86_400_000, Math.max(0, current - startedAt)),
        environment: getObservabilityEnvironment(),
        flowId,
        flowName: args.flowName,
        flowVariant: variant,
        outcome,
        pathname: currentPathname,
        release: getObservabilityRelease(),
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
      void postObservabilityJson("/api/observability/mobile/events", envelope);
    } catch {
      // Telemetry is best-effort and must never affect the flow it traces.
    }
  };

  return {
    cancel: (stage, diagnostics) => emit("cancelled", stage, diagnostics),
    complete: (stage, diagnostics) => emit("completed", stage, diagnostics),
    fail: (stage, diagnostics) => emit("failed", stage, diagnostics),
    failFrom: (stage, error, diagnostics) => {
      if (terminal) return;
      const errorCode = mapLifecycleErrorCode(error);
      // Only a decline that changed nothing on-chain is a clean cancellation.
      // Declining after an earlier step landed leaves confirmed-but-unrecorded
      // state, which has to stay at ERROR so on-call still sees it.
      const cancelled =
        errorCode === "wallet_rejected" && !hasLandedProgress(error);
      const httpStatus = httpStatusOf(error);
      // An explicit `errorDetail` from the call site wins: it was passed
      // because the caller knew something the error shape does not carry.
      const errorDetail =
        diagnostics?.errorDetail ?? mapLifecycleErrorDetail(error);
      emit(cancelled ? "cancelled" : "failed", stage, {
        ...diagnostics,
        errorCode,
        ...(errorDetail !== undefined ? { errorDetail } : {}),
        ...(httpStatus !== undefined ? { httpStatus } : {}),
      });
      if (errorCode === "unexpected_error" && args.reportUnexpectedErrors) {
        // Lifecycle `errorDetail` is deliberately enum-only. Use the existing
        // sanitized error ingest and add searchable flow context instead.
        report(
          error,
          "mobile.global_error",
          `[flow_id=${flowId} flow_name=${args.flowName} flow_stage=${stage}]`,
        );
      }
    },
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
