import {
  type LifecycleDiagnostics,
  type LifecycleErrorClass,
  type LifecycleErrorCode,
  type LifecycleFlowStage,
  type LifecycleHttpRoute,
  type LifecycleTracker,
  normalizeLifecycleErrorCode,
} from "@/features/observability/lifecycle-contract";
import {
  earnAutodepositConfigFromLoadedState,
  type LoadedEarnAutodepositConfig,
  type LoadedEarnAutodepositState,
} from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";

export const EARN_AUTODEPOSIT_SETUP_CONFIRM_ROUTE =
  "/api/smart-accounts/yield-optimization/autodeposit/setup/confirm" as const satisfies LifecycleHttpRoute;

export type EarnAutodepositSetupFailureStage = Extract<
  LifecycleFlowStage<"earn.autodeposit.configuration">,
  "backend_confirm" | "prepare" | "ui_commit" | "wallet_approval"
>;

export type EarnAutodepositSetupFailure = {
  chainState?: "confirmed" | "failed" | "not_submitted" | "submitted";
  errorClass: LifecycleErrorClass;
  errorCode: LifecycleErrorCode;
  httpRoute?: LifecycleHttpRoute;
  httpStatus?: number;
  persistenceState?: "failed" | "not_started" | "recorded";
  reconcileAuthoritativeState: boolean;
  stage: EarnAutodepositSetupFailureStage;
};

type EarnAutodepositSetupHttpErrorArgs = {
  errorClass: Extract<
    LifecycleErrorClass,
    "http_response_error" | "response_parse_error"
  >;
  errorCode?: unknown;
  httpStatus: number;
  message: string;
};

export class EarnAutodepositSetupHttpError extends Error {
  readonly errorClass: EarnAutodepositSetupHttpErrorArgs["errorClass"];
  readonly errorCode: LifecycleErrorCode;
  readonly httpStatus: number;

  constructor(args: EarnAutodepositSetupHttpErrorArgs) {
    super(args.message);
    this.name = "EarnAutodepositSetupHttpError";
    this.errorClass = args.errorClass;
    this.errorCode = normalizeLifecycleErrorCode(args.errorCode);
    this.httpStatus = args.httpStatus;
  }
}

function isWalletRejection(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return ["reject", "denied", "declined", "cancelled", "canceled"].some(
    (marker) => message.includes(marker)
  );
}

export function classifyLifecycleError(error: unknown): LifecycleErrorClass {
  if (error instanceof EarnAutodepositSetupHttpError) {
    return error.errorClass;
  }
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return "dom_exception";
  }
  if (error instanceof TypeError) {
    return "type_error";
  }
  if (error instanceof Error) {
    return "error";
  }
  return "non_error";
}

export function createEarnAutodepositSetupFailure(args: {
  chainState?: EarnAutodepositSetupFailure["chainState"];
  error: unknown;
  errorCode?: unknown;
  httpRoute?: LifecycleHttpRoute;
  httpStatus?: number;
  persistenceState?: EarnAutodepositSetupFailure["persistenceState"];
  reconcileAuthoritativeState?: boolean;
  stage: EarnAutodepositSetupFailureStage;
}): EarnAutodepositSetupFailure {
  const httpError =
    args.error instanceof EarnAutodepositSetupHttpError ? args.error : null;
  const walletRejected =
    args.stage === "wallet_approval" &&
    !httpError &&
    isWalletRejection(args.error);

  return {
    ...(args.chainState ? { chainState: args.chainState } : {}),
    errorClass: walletRejected
      ? "wallet_rejection"
      : classifyLifecycleError(args.error),
    errorCode: walletRejected
      ? "wallet_rejected"
      : normalizeLifecycleErrorCode(args.errorCode ?? httpError?.errorCode),
    ...(args.httpRoute || httpError || args.httpStatus !== undefined
      ? {
          httpRoute: args.httpRoute ?? EARN_AUTODEPOSIT_SETUP_CONFIRM_ROUTE,
        }
      : {}),
    ...(args.httpStatus !== undefined || httpError
      ? { httpStatus: args.httpStatus ?? httpError?.httpStatus }
      : {}),
    ...(args.persistenceState
      ? { persistenceState: args.persistenceState }
      : {}),
    reconcileAuthoritativeState:
      args.reconcileAuthoritativeState ??
      (args.stage === "backend_confirm" || args.stage === "ui_commit"),
    stage: args.stage,
  };
}

export function getEarnAutodepositSetupFailureDiagnostics(
  failure: EarnAutodepositSetupFailure
): LifecycleDiagnostics {
  return {
    ...(failure.chainState ? { chainState: failure.chainState } : {}),
    errorClass: failure.errorClass,
    errorCode: failure.errorCode,
    ...(failure.httpRoute ? { httpRoute: failure.httpRoute } : {}),
    ...(failure.httpStatus !== undefined
      ? { httpStatus: failure.httpStatus }
      : {}),
    ...(failure.persistenceState
      ? { persistenceState: failure.persistenceState }
      : {}),
  };
}

export async function reconcileRecordedEarnAutodepositSetup(args: {
  failure: EarnAutodepositSetupFailure;
  refreshEarnAutodeposit: () => Promise<LoadedEarnAutodepositState | null>;
}): Promise<LoadedEarnAutodepositConfig | null> {
  if (!args.failure.reconcileAuthoritativeState) {
    return null;
  }

  try {
    const autodeposit = await args.refreshEarnAutodeposit();
    if (autodeposit?.status !== "active" || !autodeposit.recurringDelegation) {
      return null;
    }

    const config = earnAutodepositConfigFromLoadedState(autodeposit);
    return config?.state === "created" ? config : null;
  } catch {
    return null;
  }
}

export async function settleEarnAutodepositSetupFailure(args: {
  failure: EarnAutodepositSetupFailure;
  onReconciled: (config: LoadedEarnAutodepositConfig) => void;
  refreshEarnAutodeposit: () => Promise<LoadedEarnAutodepositState | null>;
  tracker: LifecycleTracker;
}): Promise<boolean> {
  const reconciled = await reconcileRecordedEarnAutodepositSetup({
    failure: args.failure,
    refreshEarnAutodeposit: args.refreshEarnAutodeposit,
  });
  if (reconciled) {
    try {
      args.onReconciled(reconciled);
    } catch {
      // The authoritative refresh already committed the setup state. A local
      // view callback cannot turn that recorded setup back into a failure.
    }
    args.tracker.observe("backend_confirm", {
      chainState: "confirmed",
      httpRoute: EARN_AUTODEPOSIT_SETUP_CONFIRM_ROUTE,
      ...(args.failure.httpStatus !== undefined
        ? { httpStatus: args.failure.httpStatus }
        : {}),
      persistenceState: "recorded",
    });
    args.tracker.complete("ui_commit", {
      chainState: "confirmed",
      persistenceState: "recorded",
    });
    return true;
  }

  const diagnostics = getEarnAutodepositSetupFailureDiagnostics(args.failure);
  if (args.failure.errorCode === "wallet_rejected") {
    args.tracker.cancel(args.failure.stage, diagnostics);
  } else {
    args.tracker.fail(args.failure.stage, diagnostics);
  }
  return false;
}
