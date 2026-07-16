export const OBSERVABILITY_LIFECYCLE_ENDPOINT = "/api/observability/events";

export const MAX_LIFECYCLE_REQUEST_BYTES = 16 * 1024;
export const LIFECYCLE_SAMPLING_RATIO = 1 as const;

export const LIFECYCLE_FLOW_NAMES = [
  "auth.sign_in",
  "auth.smart_account_provisioning",
  "earn.deposit",
  "earn.withdrawal",
  "earn.autodeposit.configuration",
  "earn.autodeposit.execute_now",
] as const;

export type LifecycleFlowName = (typeof LIFECYCLE_FLOW_NAMES)[number];

export const LIFECYCLE_OUTCOMES = [
  "started",
  "observed",
  "completed",
  "failed",
  "cancelled",
] as const;
export type LifecycleOutcome = (typeof LIFECYCLE_OUTCOMES)[number];

export const LIFECYCLE_SOURCES = [
  "browser",
  "next_api",
  "sse",
  "fallback",
] as const;
export type LifecycleSource = (typeof LIFECYCLE_SOURCES)[number];

export const LIFECYCLE_VARIANTS = {
  "auth.sign_in": ["interactive", "auto_reauth"],
  "auth.smart_account_provisioning": ["wallet_onboarding"],
  "earn.deposit": ["initial", "resumed", "top_up"],
  "earn.withdrawal": ["partial", "full"],
  "earn.autodeposit.configuration": [
    "setup",
    "floor_update",
    "pause",
    "resume",
    "close",
  ],
  "earn.autodeposit.execute_now": ["execute_now"],
} as const satisfies Record<LifecycleFlowName, readonly string[]>;

export const LIFECYCLE_STAGES = {
  "auth.sign_in": [
    "intent",
    "wallet_select",
    "wallet_connect",
    "challenge",
    "wallet_approval",
    "completion",
    "session_refresh",
    "ui_commit",
  ],
  "auth.smart_account_provisioning": [
    "proof_verify",
    "user_resolve",
    "smart_account_lookup",
    "smart_account_reconcile",
    "smart_account_reserve",
    "sponsorship_submit",
    "sponsorship_finalize",
    "signer_verify",
    "completion_persist",
    "session_issue",
  ],
  "earn.deposit": [
    "intent",
    "prepare",
    "review",
    "policy",
    "policy_finalize",
    "wallet_submit_confirm",
    "slot_resolve",
    "backend_confirm",
    "ui_commit",
  ],
  "earn.withdrawal": [
    "intent",
    "prepare",
    "autodeposit_close",
    "wallet_submit_confirm",
    "slot_resolve",
    "backend_confirm",
    "full_exit_verify",
    "cleanup",
    "ui_commit",
  ],
  "earn.autodeposit.configuration": [
    "intent",
    "prepare",
    "wallet_approval",
    "create_policy",
    "create_recurring_delegation",
    "backend_confirm",
    "bootstrap",
    "ui_commit",
  ],
  "earn.autodeposit.execute_now": [
    "intent",
    "request",
    "state_observed",
    "ui_commit",
  ],
} as const satisfies Record<LifecycleFlowName, readonly string[]>;

export const LIFECYCLE_ERROR_CODES = [
  "unexpected_error",
  "invalid_request",
  "unauthenticated",
  "turnstile_verification_failed",
  "wallet_selection_timeout",
  "wallet_connection_timeout",
  "wallet_signing_unsupported",
  "wallet_rejected",
  "invalid_wallet_origin",
  "invalid_wallet_proof_kind",
  "invalid_wallet_signature",
  "wallet_auth_completion_in_progress",
  "smart_account_sponsor_not_configured",
  "smart_account_provisioning_failed",
  "smart_account_reservation_conflict",
  "smart_account_signer_mismatch",
  "smart_account_principal_mismatch",
  "state_not_ready",
  "policy_signer_missing",
  "invalid_source",
  "insufficient_usdc",
  "insufficient_native_sol",
  "instruction_fetch_failed",
  "instruction_validation_failed",
  "transaction_too_large",
  "cluster_mismatch",
  "wallet_unavailable",
  "wallet_mismatch",
  "simulation_failed",
  "send_failed",
  "chain_confirmation_failed",
  "slot_resolution_failed",
  "backend_confirmation_failed",
  "record_failed",
  "full_exit_verification_retryable",
  "autodeposit_not_found",
  "autodeposit_not_active",
  "earn_position_required",
  "no_scheduled_sweeps",
  "request_failed",
  "progress_read_failed",
  "autodeposit_target_closed",
  "unconfirmed_signature",
  "metadata_mismatch",
  "principal_mismatch",
  "slot_mismatch",
  "artifact_missing",
  "token_approval_missing",
  "realtime_unresolved",
] as const;
export type LifecycleErrorCode = (typeof LIFECYCLE_ERROR_CODES)[number];

export const EXECUTE_NOW_STATES = [
  "requested",
  "selected",
  "pull_confirmed",
  "completed",
  "failed",
  "released",
  "canceled",
] as const;
export type ExecuteNowState = (typeof EXECUTE_NOW_STATES)[number];

export const PROVISIONING_OUTCOMES = [
  "existing_ready",
  "delegated_root_signer",
  "reconciled_ready",
  "sponsored_existing_record",
  "sponsored_new_record",
  "retried_failed_record",
  "reservation_conflict",
  "signer_mismatch",
  "sponsor_unconfigured",
  "sponsorship_failed",
] as const;

const PROOF_KINDS = ["siws", "message", "transaction"] as const;
const EXECUTION_MODES = ["batch", "sequential", "single"] as const;
const POLICY_MODES = ["create", "reuse"] as const;
const CHAIN_STATES = [
  "not_submitted",
  "submitted",
  "confirmed",
  "failed",
] as const;
const PERSISTENCE_STATES = ["not_started", "recorded", "failed"] as const;
const TRANSACTION_VERSIONS = ["legacy", "v0"] as const;

export type LifecycleFlowVariant<
  F extends LifecycleFlowName = LifecycleFlowName
> = (typeof LIFECYCLE_VARIANTS)[F][number];
export type LifecycleFlowStage<
  F extends LifecycleFlowName = LifecycleFlowName
> = (typeof LIFECYCLE_STAGES)[F][number];

export type LifecycleDiagnostics = {
  authProofKind?: (typeof PROOF_KINDS)[number];
  autodepositCloseRequired?: boolean;
  chainState?: (typeof CHAIN_STATES)[number];
  cleanupRequired?: boolean;
  errorCode?: LifecycleErrorCode;
  executeNowState?: ExecuteNowState;
  executionMode?: (typeof EXECUTION_MODES)[number];
  httpStatus?: number;
  instructionCount?: number;
  lookupTableUsed?: boolean;
  persistenceState?: (typeof PERSISTENCE_STATES)[number];
  policyMode?: (typeof POLICY_MODES)[number];
  provisioningOutcome?: (typeof PROVISIONING_OUTCOMES)[number];
  recoveryRequired?: boolean;
  reviewBypassed?: boolean;
  scheduledSlotId?: string;
  setupRequired?: boolean;
  stageCount?: number;
  stageIndex?: number;
  transactionVersion?: (typeof TRANSACTION_VERSIONS)[number];
};

export type BrowserLifecycleEnvelope = LifecycleDiagnostics & {
  durationMs: number;
  elapsedMs: number;
  flowId: string;
  flowName: LifecycleFlowName;
  flowVariant: LifecycleFlowVariant;
  outcome: LifecycleOutcome;
  pathname: string;
  runtime: "browser" | "node";
  source: LifecycleSource;
  stage: LifecycleFlowStage;
  timestamp: string;
};

export type NormalizedLifecycleEvent = BrowserLifecycleEnvelope & {
  actorId?: string;
  deploymentEnvironment: string;
  release: string;
  serviceName: "loyal-frontend";
};

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SCHEDULED_SLOT_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const MAX_EVENT_AGE_MS = 60 * 60 * 1000;
const MAX_EVENT_CLOCK_SKEW_MS = 5 * 60 * 1000;

export class InvalidLifecycleEnvelopeError extends Error {
  constructor() {
    super("Invalid observability lifecycle envelope.");
    this.name = "InvalidLifecycleEnvelopeError";
  }
}

function includes<T extends string>(
  values: readonly T[],
  value: unknown
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function isCanonicalUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

export function normalizeLifecycleErrorCode(
  value: unknown
): LifecycleErrorCode {
  return includes(LIFECYCLE_ERROR_CODES, value) ? value : "unexpected_error";
}

function isIntegerInRange(
  value: unknown,
  min: number,
  max: number
): value is number {
  return (
    Number.isInteger(value) && Number(value) >= min && Number(value) <= max
  );
}

function assertOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): asserts value is T | undefined {
  if (value !== undefined && !includes(allowed, value)) {
    throw new InvalidLifecycleEnvelopeError();
  }
}

function assertOptionalBoolean(
  value: unknown
): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new InvalidLifecycleEnvelopeError();
  }
}

export function parseBrowserLifecycleEnvelope(
  value: unknown,
  now = Date.now()
): BrowserLifecycleEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidLifecycleEnvelopeError();
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "authProofKind",
    "autodepositCloseRequired",
    "chainState",
    "cleanupRequired",
    "durationMs",
    "elapsedMs",
    "errorCode",
    "executeNowState",
    "executionMode",
    "flowId",
    "flowName",
    "flowVariant",
    "httpStatus",
    "instructionCount",
    "lookupTableUsed",
    "outcome",
    "pathname",
    "persistenceState",
    "policyMode",
    "provisioningOutcome",
    "recoveryRequired",
    "reviewBypassed",
    "runtime",
    "scheduledSlotId",
    "setupRequired",
    "source",
    "stage",
    "stageCount",
    "stageIndex",
    "timestamp",
    "transactionVersion",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new InvalidLifecycleEnvelopeError();
  }

  if (
    !isCanonicalUuidV4(record.flowId) ||
    !includes(LIFECYCLE_FLOW_NAMES, record.flowName)
  ) {
    throw new InvalidLifecycleEnvelopeError();
  }
  const flowName = record.flowName;
  if (
    !includes(LIFECYCLE_VARIANTS[flowName], record.flowVariant) ||
    !includes(LIFECYCLE_STAGES[flowName], record.stage) ||
    !includes(LIFECYCLE_OUTCOMES, record.outcome) ||
    !includes(LIFECYCLE_SOURCES, record.source)
  ) {
    throw new InvalidLifecycleEnvelopeError();
  }
  if (record.runtime !== "browser" && record.runtime !== "node") {
    throw new InvalidLifecycleEnvelopeError();
  }
  if (
    !isIntegerInRange(record.durationMs, 0, 900_000) ||
    !isIntegerInRange(record.elapsedMs, 0, 86_400_000)
  ) {
    throw new InvalidLifecycleEnvelopeError();
  }

  const timestamp = record.timestamp;
  const timestampMs =
    typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
  if (
    typeof timestamp !== "string" ||
    !Number.isFinite(timestampMs) ||
    new Date(timestampMs).toISOString() !== timestamp ||
    timestampMs < now - MAX_EVENT_AGE_MS ||
    timestampMs > now + MAX_EVENT_CLOCK_SKEW_MS
  ) {
    throw new InvalidLifecycleEnvelopeError();
  }

  const pathname = typeof record.pathname === "string" ? record.pathname : "";
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    pathname.includes("?") ||
    pathname.includes("#") ||
    pathname.includes("\\") ||
    pathname.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(pathname)
  ) {
    throw new InvalidLifecycleEnvelopeError();
  }

  assertOptionalEnum(record.errorCode, LIFECYCLE_ERROR_CODES);
  assertOptionalEnum(record.executeNowState, EXECUTE_NOW_STATES);
  assertOptionalEnum(record.authProofKind, PROOF_KINDS);
  assertOptionalEnum(record.executionMode, EXECUTION_MODES);
  assertOptionalEnum(record.policyMode, POLICY_MODES);
  assertOptionalEnum(record.chainState, CHAIN_STATES);
  assertOptionalEnum(record.persistenceState, PERSISTENCE_STATES);
  assertOptionalEnum(record.transactionVersion, TRANSACTION_VERSIONS);
  assertOptionalEnum(record.provisioningOutcome, PROVISIONING_OUTCOMES);
  for (const key of [
    "autodepositCloseRequired",
    "cleanupRequired",
    "lookupTableUsed",
    "recoveryRequired",
    "reviewBypassed",
    "setupRequired",
  ] as const) {
    assertOptionalBoolean(record[key]);
  }
  if (
    record.httpStatus !== undefined &&
    !isIntegerInRange(record.httpStatus, 100, 599)
  )
    throw new InvalidLifecycleEnvelopeError();
  if (
    record.stageIndex !== undefined &&
    !isIntegerInRange(record.stageIndex, 0, 15)
  )
    throw new InvalidLifecycleEnvelopeError();
  if (
    record.stageCount !== undefined &&
    !isIntegerInRange(record.stageCount, 1, 16)
  )
    throw new InvalidLifecycleEnvelopeError();
  if (
    record.instructionCount !== undefined &&
    !isIntegerInRange(record.instructionCount, 0, 64)
  )
    throw new InvalidLifecycleEnvelopeError();
  if (
    record.scheduledSlotId !== undefined &&
    (typeof record.scheduledSlotId !== "string" ||
      !SCHEDULED_SLOT_ID_PATTERN.test(record.scheduledSlotId))
  ) {
    throw new InvalidLifecycleEnvelopeError();
  }

  if (record.authProofKind !== undefined && flowName !== "auth.sign_in")
    throw new InvalidLifecycleEnvelopeError();
  if (
    record.provisioningOutcome !== undefined &&
    flowName !== "auth.smart_account_provisioning"
  )
    throw new InvalidLifecycleEnvelopeError();
  if (
    (record.executeNowState !== undefined ||
      record.scheduledSlotId !== undefined) &&
    flowName !== "earn.autodeposit.execute_now"
  )
    throw new InvalidLifecycleEnvelopeError();
  const isMoneyFlow =
    flowName === "earn.deposit" || flowName === "earn.withdrawal";
  const isTransactionFlow =
    isMoneyFlow || flowName === "earn.autodeposit.configuration";
  if (
    (record.chainState !== undefined ||
      record.persistenceState !== undefined ||
      record.executionMode !== undefined ||
      record.transactionVersion !== undefined ||
      record.lookupTableUsed !== undefined ||
      record.instructionCount !== undefined) &&
    !isTransactionFlow
  )
    throw new InvalidLifecycleEnvelopeError();
  if (
    (record.policyMode !== undefined ||
      record.setupRequired !== undefined ||
      record.reviewBypassed !== undefined) &&
    flowName !== "earn.deposit"
  ) {
    throw new InvalidLifecycleEnvelopeError();
  }
  if (
    (record.autodepositCloseRequired !== undefined ||
      record.cleanupRequired !== undefined) &&
    flowName !== "earn.withdrawal"
  )
    throw new InvalidLifecycleEnvelopeError();
  if (
    record.recoveryRequired === true &&
    (!isMoneyFlow ||
      record.stage !== "backend_confirm" ||
      record.outcome !== "observed" ||
      record.chainState !== "confirmed" ||
      record.persistenceState !== "failed" ||
      (record.errorCode !== "backend_confirmation_failed" &&
        record.errorCode !== "record_failed"))
  ) {
    throw new InvalidLifecycleEnvelopeError();
  }
  if (
    flowName === "earn.autodeposit.execute_now" &&
    record.executeNowState !== undefined
  ) {
    const mapped = mapExecuteNowState(record.executeNowState);
    if (record.stage === "request") {
      if (
        record.executeNowState !== "requested" ||
        record.outcome !== "observed"
      ) {
        throw new InvalidLifecycleEnvelopeError();
      }
    } else if (
      record.stage !== "state_observed" ||
      record.outcome !== mapped.outcome
    ) {
      throw new InvalidLifecycleEnvelopeError();
    }
  }

  return record as BrowserLifecycleEnvelope;
}

export type LifecycleTracker = {
  cancel: (
    stage: LifecycleFlowStage,
    diagnostics?: LifecycleDiagnostics,
    options?: LifecycleEmitOptions
  ) => void;
  complete: (
    stage: LifecycleFlowStage,
    diagnostics?: LifecycleDiagnostics,
    options?: LifecycleEmitOptions
  ) => void;
  fail: (
    stage: LifecycleFlowStage,
    diagnostics?: LifecycleDiagnostics,
    options?: LifecycleEmitOptions
  ) => void;
  flowId: string;
  observe: (
    stage: LifecycleFlowStage,
    diagnostics?: LifecycleDiagnostics,
    options?: LifecycleEmitOptions
  ) => void;
  recovery: (diagnostics: LifecycleDiagnostics) => void;
  start: (
    stage: LifecycleFlowStage,
    diagnostics?: LifecycleDiagnostics,
    options?: LifecycleEmitOptions
  ) => void;
};

export type LifecycleEmitOptions = {
  source?: LifecycleSource;
  timestamp?: string;
};

export function createLifecycleTracker(args: {
  emit: (event: BrowserLifecycleEnvelope) => void;
  flowId?: string;
  flowName: LifecycleFlowName;
  flowVariant: LifecycleFlowVariant;
  now?: () => number;
  pathname: string;
  randomUUID?: () => string;
  runtime?: "browser" | "node";
  source?: LifecycleSource;
}): LifecycleTracker {
  const now = args.now ?? Date.now;
  const randomUUID = args.randomUUID ?? (() => crypto.randomUUID());
  const flowId = args.flowId ?? randomUUID();
  if (!isCanonicalUuidV4(flowId)) throw new InvalidLifecycleEnvelopeError();
  const createdAt = now();
  let lastAt = createdAt;
  let terminal: LifecycleOutcome | null = null;
  let recoveryEmitted = false;

  const emit = (
    outcome: LifecycleOutcome,
    stage: LifecycleFlowStage,
    diagnostics: LifecycleDiagnostics = {},
    options: LifecycleEmitOptions = {}
  ) => {
    if (terminal) return;
    const current = now();
    const timestamp = options.timestamp ?? new Date(current).toISOString();
    try {
      const event = parseBrowserLifecycleEnvelope(
        {
          ...diagnostics,
          durationMs: Math.min(
            900_000,
            Math.max(0, Math.round(current - lastAt))
          ),
          elapsedMs: Math.min(
            86_400_000,
            Math.max(0, Math.round(current - createdAt))
          ),
          flowId,
          flowName: args.flowName,
          flowVariant: args.flowVariant,
          outcome,
          pathname: args.pathname,
          runtime: args.runtime ?? "browser",
          source: options.source ?? args.source ?? "browser",
          stage,
          timestamp,
        },
        current
      );
      lastAt = current;
      if (
        outcome === "completed" ||
        outcome === "failed" ||
        outcome === "cancelled"
      )
        terminal = outcome;
      args.emit(event);
    } catch {
      // Telemetry validation or transport callbacks never affect product code.
    }
  };

  return {
    cancel: (stage, diagnostics, options) =>
      emit("cancelled", stage, diagnostics, options),
    complete: (stage, diagnostics, options) =>
      emit("completed", stage, diagnostics, options),
    fail: (stage, diagnostics, options) =>
      emit("failed", stage, diagnostics, options),
    flowId,
    observe: (stage, diagnostics, options) =>
      emit("observed", stage, diagnostics, options),
    recovery: (diagnostics) => {
      if (terminal !== "completed" || recoveryEmitted) return;
      const current = now();
      const errorCode = diagnostics.errorCode;
      if (
        errorCode !== "backend_confirmation_failed" &&
        errorCode !== "record_failed"
      )
        return;
      recoveryEmitted = true;
      try {
        args.emit(
          parseBrowserLifecycleEnvelope(
            {
              ...diagnostics,
              chainState: "confirmed",
              durationMs: Math.min(
                900_000,
                Math.max(0, Math.round(current - lastAt))
              ),
              elapsedMs: Math.min(
                86_400_000,
                Math.max(0, Math.round(current - createdAt))
              ),
              flowId,
              flowName: args.flowName,
              flowVariant: args.flowVariant,
              outcome: "observed",
              pathname: args.pathname,
              persistenceState: "failed",
              recoveryRequired: true,
              runtime: args.runtime ?? "browser",
              source: args.source ?? "browser",
              stage: "backend_confirm",
              timestamp: new Date(current).toISOString(),
            },
            current
          )
        );
      } catch {
        // Recovery telemetry is best-effort and non-throwing.
      }
    },
    start: (stage, diagnostics, options) =>
      emit("started", stage, diagnostics, options),
  };
}

export function mapExecuteNowState(state: ExecuteNowState): {
  outcome: LifecycleOutcome;
  stage: "state_observed";
} {
  if (state === "completed")
    return { outcome: "completed", stage: "state_observed" };
  if (state === "failed" || state === "released")
    return { outcome: "failed", stage: "state_observed" };
  if (state === "canceled")
    return { outcome: "cancelled", stage: "state_observed" };
  return { outcome: "observed", stage: "state_observed" };
}
