import {
  normalizeResourceValue,
  normalizeTelemetryPathname,
  sanitizeTelemetryText,
} from "./error-contract";

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
  "earn.autoswap.configuration",
  "wallet.swap",
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
  "mobile_app",
] as const;
export type LifecycleSource = (typeof LIFECYCLE_SOURCES)[number];

export const LIFECYCLE_VARIANTS = {
  // seed_vault/wallet_adapter/import_wallet/new_wallet are the mobile app's
  // wallet-onboarding modes (Seed Vault, MWA, seed import, fresh keypair).
  "auth.sign_in": [
    "interactive",
    "auto_reauth",
    "seed_vault",
    "wallet_adapter",
    "import_wallet",
    "new_wallet",
  ],
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
  "earn.autoswap.configuration": ["setup", "pause", "resume", "delete"],
  // Direct wallet-adapter signing vs the smart-account execution context.
  "wallet.swap": ["wallet_adapter", "smart_account"],
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
    "cleanup_prepare",
    "cleanup_wallet_submit_confirm",
    "cleanup_backend_confirm",
    "cleanup",
    "ui_commit",
  ],
  "earn.autodeposit.configuration": [
    "intent",
    "prepare",
    "wallet_approval",
    "create_policy",
    "create_recurring_delegation",
    "slot_resolve",
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
  // Setup/delete sign wallet transactions (two shard policies on setup, one
  // revocation on delete); pause/resume are backend-only generation bumps.
  "earn.autoswap.configuration": [
    "intent",
    "prepare",
    "wallet_approval",
    "create_policy",
    "slot_resolve",
    "backend_confirm",
    "ui_commit",
  ],
  "wallet.swap": [
    "intent",
    "quote_refresh",
    "build",
    "wallet_submit_confirm",
    "ui_commit",
  ],
} as const satisfies Record<LifecycleFlowName, readonly string[]>;

export const LIFECYCLE_ERROR_CODES = [
  "unexpected_error",
  "invalid_request",
  "unauthenticated",
  "captcha_verification_failed",
  "wallet_selection_timeout",
  "wallet_connection_timeout",
  // The adapter refused or dropped the connection outright. Distinct from
  // `wallet_connection_timeout`, which means one of our settle watchdogs
  // elapsed while the adapter never resolved either way.
  "wallet_connection_failed",
  // A stored Mobile Wallet Adapter authorization was revoked. The app clears
  // it and sends the user through reconnect; no backend request was made.
  "wallet_authorization_expired",
  // The wallet could not produce a signature. Distinct from
  // `invalid_wallet_signature`, which means a signature was produced and the
  // backend rejected it during verification.
  "wallet_signing_failed",
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
  // The route's output fell below the quote's minimum-out (Jupiter 6001).
  "slippage_exceeded",
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
  // Terminal sweep failure codes forwarded from the yield backend's bounded
  // completion_failure_code set. Codes outside this union still collapse to
  // `unexpected_error` via `normalizeLifecycleErrorCode`.
  "execution_failed",
  "kamino_top_up_failed",
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

// Underlying causes behind a broad `errorCode`. Every value is a token this
// repo defines — never a string forwarded from a vendor SDK — so nothing a
// client holds can reach `loyal.error.detail`. Emitters map their native error
// onto one of these; add a token here when a new cause needs telling apart.
//
// `mwa_*` are Mobile Wallet Adapter session failures, whose native codes are
// EUNSPECIFIED (the module's catch-all), ERROR_WALLET_NOT_FOUND,
// ERROR_SESSION_TIMEOUT, ERROR_SESSION_CLOSED, "Timed out waiting for local
// association to be ready", and "Failed to end session".
//
// The rest name what went wrong behind a `request_failed` that carries no
// `httpStatus` — meaning no response ever arrived, so the status that usually
// explains a failure is absent. Four unrelated incidents look identical
// without them: the device is offline, our own client timeout elapsed, Kamino
// is down, or an RPC answered with an error (ASK-2018).
export const MAX_LIFECYCLE_ERROR_MESSAGE_LENGTH = 256;

// Where a browser flow ran. Bounded and derived by our own detection code —
// never a raw user-agent string, which is both high-cardinality and a
// fingerprinting liability. Server (`node`) and app (`mobile` runtime) events
// simply leave it unset.
export const LIFECYCLE_CLIENT_PLATFORMS = ["desktop", "mobile"] as const;
export type LifecycleClientPlatform =
  (typeof LIFECYCLE_CLIENT_PLATFORMS)[number];

// Which OS fleet a mobile device belongs to — same vocabulary as the metrics
// contract's `platform` (ASK-2097). Distinct from `clientPlatform`, which is
// a browser form-factor token.
export const MOBILE_DEVICE_PLATFORMS = ["android", "ios"] as const;
export type MobileDevicePlatform = (typeof MOBILE_DEVICE_PLATFORMS)[number];

export const LIFECYCLE_ERROR_DETAILS = [
  "mwa_unspecified",
  "mwa_wallet_not_found",
  "mwa_session_timeout",
  "mwa_association_timeout",
  "mwa_session_closed",
  "mwa_end_session_failed",
  // Connection-level fetch failure: DNS, TLS or a reset socket. React Native
  // surfaces all of them as a bare TypeError("Network request failed").
  "network_unreachable",
  // One of our own client deadlines elapsed, not the server's.
  "request_timeout",
  // Kamino answered 5xx/429 and kept doing so until the retries ran out. An
  // upstream incident, not anything wrong on the device.
  "kamino_upstream_unavailable",
  // A Solana JSON-RPC call returned an error object rather than a result.
  "rpc_request_failed",
] as const;
export type LifecycleErrorDetail = (typeof LIFECYCLE_ERROR_DETAILS)[number];

// The wallet adapter behind a sign-in attempt. Wallet-standard adapters
// register under arbitrary display names the extension controls, so this is a
// closed token set for the same reason as `LIFECYCLE_ERROR_DETAILS`: known
// names map to their token, anything else collapses into `other`, and no
// string a wallet holds can reach the exported attribute.
export const LIFECYCLE_WALLET_PROVIDERS = [
  "backpack",
  "brave_wallet",
  "coinbase_wallet",
  "exodus",
  "glow",
  "jupiter",
  "ledger",
  "loyal",
  "magic_eden",
  "metamask",
  "nightly",
  "okx_wallet",
  "other",
  "phantom",
  "solflare",
  "trust",
] as const;
export type LifecycleWalletProvider =
  (typeof LIFECYCLE_WALLET_PROVIDERS)[number];

// Maps an adapter's display name ("Coinbase Wallet", "Magic Eden") onto its
// token. Unknown non-empty names become `other` — still counted, bounded
// cardinality — while a missing name stays unset.
export function normalizeLifecycleWalletProvider(
  value: unknown
): LifecycleWalletProvider | undefined {
  if (typeof value !== "string") return undefined;
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  if (!token) return undefined;
  return includes(LIFECYCLE_WALLET_PROVIDERS, token) ? token : "other";
}

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
  /**
   * Which underlying cause produced `errorCode`, for codes that several
   * distinct causes collapse into — every mobile wallet-session failure, for
   * instance. Names the cause without minting a lifecycle code per vendor
   * error.
   *
   * An enum, not a string: clients map their native error onto one of the
   * tokens below and anything else is dropped. Character-level sanitizing
   * would not do — base58 addresses, JWTs and API keys consist entirely of
   * token-safe characters, so a free-text field would export them intact.
   */
  errorDetail?: LifecycleErrorDetail;
  /**
   * The underlying error's own words, for failures whose `errorCode` names a
   * category several vendor errors collapse into and no `errorDetail` token
   * exists yet — a wallet refusing to sign said *something*, and without it
   * the two Brave events in ASK-2049 were undiagnosable.
   *
   * Free text is admissible here where it was not for `errorDetail` because
   * it takes the same path as `exception.message` in the error channel:
   * `sanitizeTelemetryText` at the parse boundary redacts base58/hex/encoded
   * identifiers, bearer tokens and secret-shaped values before export, and
   * the result is capped at MAX_LIFECYCLE_ERROR_MESSAGE_LENGTH. Only kept on
   * `failed`/`cancelled` outcomes; dropped elsewhere, never costing the event.
   */
  errorMessage?: string;
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
  walletProvider?: LifecycleWalletProvider;
};

export type BrowserLifecycleEnvelope = LifecycleDiagnostics & {
  clientPlatform?: LifecycleClientPlatform;
  durationMs: number;
  elapsedMs: number;
  flowId: string;
  flowName: LifecycleFlowName;
  flowVariant: LifecycleFlowVariant;
  outcome: LifecycleOutcome;
  pathname: string;
  runtime: "browser" | "mobile" | "node";
  source: LifecycleSource;
  stage: LifecycleFlowStage;
  timestamp: string;
};

// Mobile envelopes carry their own release/environment (the app fleet mixes
// binary versions and OTA bundles) plus an optional wallet address that the
// ingest route forwards verbatim, the same way web sessions report theirs.
export type MobileLifecycleEnvelope = BrowserLifecycleEnvelope & {
  /**
   * Stable per-install UUID, the join key for a device's whole telemetry
   * trail across sessions and wallets (ASK-2097). Optional: older clients
   * predate it.
   */
  deviceId?: string;
  devicePlatform?: MobileDevicePlatform;
  environment: string;
  release: string;
  walletAddress?: string;
};

export type NormalizedLifecycleEvent = BrowserLifecycleEnvelope & {
  deploymentEnvironment: string;
  deviceId?: string;
  devicePlatform?: MobileDevicePlatform;
  release: string;
  serviceName: "loyal-frontend" | "loyal-mobile";
  walletAddress?: string;
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

/**
 * Keep a reported detail only when it is one of our own tokens, else drop it.
 *
 * Dropping (rather than rejecting the envelope) because the field only ever
 * annotates an event, so an unrecognized value must not cost the event it
 * describes. Matching against the enum (rather than sanitizing characters)
 * because base58 addresses, JWTs and API keys are made entirely of token-safe
 * characters and would survive any character filter intact.
 */
function normalizeErrorDetail(value: unknown): LifecycleErrorDetail | undefined {
  return includes(LIFECYCLE_ERROR_DETAILS, value) ? value : undefined;
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
    "clientPlatform",
    "durationMs",
    "elapsedMs",
    "errorCode",
    "errorDetail",
    "errorMessage",
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
    "walletProvider",
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
  if (
    record.runtime !== "browser" &&
    record.runtime !== "node" &&
    record.runtime !== "mobile"
  ) {
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

  const pathname =
    typeof record.pathname === "string"
      ? normalizeTelemetryPathname(record.pathname)
      : null;
  if (!pathname) {
    throw new InvalidLifecycleEnvelopeError();
  }

  assertOptionalEnum(record.errorCode, LIFECYCLE_ERROR_CODES);
  const errorDetail = normalizeErrorDetail(record.errorDetail);
  // Sanitized on every parse — the client tracker and the ingest route share
  // this function, so a message is redacted before it leaves the browser and
  // again before it reaches the exporter.
  const errorMessage =
    (record.outcome === "failed" || record.outcome === "cancelled") &&
    typeof record.errorMessage === "string"
      ? sanitizeTelemetryText(
          record.errorMessage,
          MAX_LIFECYCLE_ERROR_MESSAGE_LENGTH
        ) || undefined
      : undefined;
  const clientPlatform = includes(
    LIFECYCLE_CLIENT_PLATFORMS,
    record.clientPlatform
  )
    ? record.clientPlatform
    : undefined;
  // Exact-token match only: at the ingest boundary an unrecognized value is
  // dropped, never bucketed into `other` — mapping display names onto tokens
  // is the emitter's job via normalizeLifecycleWalletProvider.
  const walletProvider = includes(
    LIFECYCLE_WALLET_PROVIDERS,
    record.walletProvider
  )
    ? record.walletProvider
    : undefined;
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
    isMoneyFlow ||
    flowName === "earn.autodeposit.configuration" ||
    flowName === "earn.autoswap.configuration";
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
      (record.stage !== "backend_confirm" &&
        !(
          flowName === "earn.withdrawal" &&
          record.stage === "cleanup_backend_confirm"
        )) ||
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

  // Normalized fields always overwrite the raw value; undefined when absent
  // or normalized away, which downstream treats as "not set".
  return {
    ...record,
    pathname,
    clientPlatform,
    errorDetail,
    errorMessage,
    walletProvider,
  } as BrowserLifecycleEnvelope;
}

const WALLET_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_RELEASE_LENGTH = 80;
const MAX_ENVIRONMENT_LENGTH = 32;

export function parseMobileLifecycleEnvelope(
  value: unknown,
  now = Date.now()
): MobileLifecycleEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidLifecycleEnvelopeError();
  }
  const { deviceId, devicePlatform, environment, release, walletAddress, ...rest } =
    value as Record<string, unknown>;

  const normalizedEnvironment =
    typeof environment === "string"
      ? normalizeResourceValue(environment, MAX_ENVIRONMENT_LENGTH)
      : null;
  const normalizedRelease =
    typeof release === "string"
      ? normalizeResourceValue(release, MAX_RELEASE_LENGTH)
      : null;
  if (!normalizedEnvironment || !normalizedRelease) {
    throw new InvalidLifecycleEnvelopeError();
  }
  if (
    walletAddress !== undefined &&
    (typeof walletAddress !== "string" ||
      !WALLET_ADDRESS_PATTERN.test(walletAddress))
  ) {
    throw new InvalidLifecycleEnvelopeError();
  }
  if (
    deviceId !== undefined &&
    (typeof deviceId !== "string" || !UUID_V4_PATTERN.test(deviceId))
  ) {
    throw new InvalidLifecycleEnvelopeError();
  }
  if (
    devicePlatform !== undefined &&
    !includes(MOBILE_DEVICE_PLATFORMS, devicePlatform)
  ) {
    throw new InvalidLifecycleEnvelopeError();
  }
  if (rest.runtime !== "mobile") {
    throw new InvalidLifecycleEnvelopeError();
  }

  return {
    ...parseBrowserLifecycleEnvelope(rest, now),
    environment: normalizedEnvironment,
    release: normalizedRelease,
    ...(walletAddress ? { walletAddress } : {}),
    ...(deviceId !== undefined ? { deviceId } : {}),
    ...(devicePlatform !== undefined ? { devicePlatform } : {}),
  };
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

// crypto.randomUUID only exists in secure contexts (https/localhost); on
// http LAN dev hosts it is undefined and would crash every flow that starts a
// tracker. getRandomValues is available everywhere, so derive a canonical v4.
function fallbackRandomUuidV4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Formats an unknown error for the `errorMessage` diagnostic: class name plus
// message, with the wallet adapter's nested cause appended when present —
// adapters wrap the provider's real error under `.error` (or `.cause`), and
// that inner message is usually the diagnosis. Redaction happens at the parse
// boundary, not here.
export function lifecycleErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause =
    (error as Error & { error?: unknown }).error ?? error.cause;
  const base = `${error.name}: ${error.message}`;
  if (cause instanceof Error) return `${base} <- ${cause.name}: ${cause.message}`;
  if (cause !== undefined && cause !== null) return `${base} <- ${String(cause)}`;
  return base;
}

export function createLifecycleTracker(args: {
  clientPlatform?: LifecycleClientPlatform;
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
  const randomUUID =
    args.randomUUID ??
    (() =>
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : fallbackRandomUuidV4());
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
          ...(args.clientPlatform
            ? { clientPlatform: args.clientPlatform }
            : {}),
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
              ...(args.clientPlatform
                ? { clientPlatform: args.clientPlatform }
                : {}),
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
