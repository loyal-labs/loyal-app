import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";

import {
  findCurrentUser,
  getOrCreateCurrentUser,
} from "@/features/chat/server/app-user";
import {
  EARN_REALTIME_EVENT_TYPES,
  EARN_REALTIME_SCHEMA_VERSION,
  type EarnAutodepositProgressState,
} from "@/features/earn-realtime/types";
import { authenticateMobileEarnRequest } from "@/features/identity/server/mobile-earn-session";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  findCurrentEarnAutodepositState,
  findEarnAutodepositScheduledSweepProgress,
  requestImmediateEarnAutodepositScheduledSweep,
  type BalanceSweepTargetRecord,
  type EarnAutodepositScheduledSweepProgressRecord,
  type ImmediateEarnAutodepositScheduledSweepRequestResult,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import {
  EARN_POSITION_REQUIRED_ERROR,
  hasActiveEarnRoutePolicyPair,
} from "@/lib/yield-optimization/earn-position-gate.server";

// Mobile twin of `yield-optimization/autodeposit/sweeps/execute`. Lets the
// native app ask the worker to run the pending scheduled Autodeposit sweep now
// instead of waiting out its ~1h window. The web route trusts the session
// principal; mobile authenticates with a purpose-scoped wallet signature, then
// self-resolves the smart account before the shared repository call. Like the
// session route, execution is delegated to the worker by advancing the chosen
// scheduled slot. GET is the progress read the native app burst-polls after an
// execute (the web gets these transitions over SSE; mobile polls the same
// fallback contract) — read-only and wallet-address-keyed like
// `mobile/earn/autodeposit/state`. Keep in sync with the session route.
const EARN_VAULT_INDEX = 1 as const;

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function serializeTarget(target: BalanceSweepTargetRecord) {
  return {
    active: target.active,
    balanceSweepPolicyId: target.balanceSweepPolicyId?.toString() ?? null,
    id: target.id.toString(),
    lifecycleStatus: target.lifecycleStatus,
    policyAccount: target.policyAccount,
    recurringDelegation: target.recurringDelegation,
    walletBalanceFloorRaw: target.walletBalanceFloorRaw?.toString() ?? null,
  };
}

function serializeRequestResult(
  result: ImmediateEarnAutodepositScheduledSweepRequestResult
) {
  return {
    acceleratedAmountRaw: result.acceleratedAmountRaw.toString(),
    acceleratedLotCount: result.acceleratedLotCount,
    eligibleAfter: result.eligibleAfter.toISOString(),
    slotId: result.slotId.toString(),
    status: result.status,
    targetId: result.targetId.toString(),
  };
}

function parseOptionalSlotId(body: unknown): bigint | null {
  if (!body || typeof body !== "object" || !("slotId" in body)) {
    return null;
  }

  const { slotId } = body as { slotId?: unknown };
  if (slotId === null || slotId === undefined || slotId === "") {
    return null;
  }
  if (typeof slotId !== "string" || !/^\d+$/.test(slotId)) {
    throw new Error("Invalid Autodeposit scheduled slot.");
  }

  return BigInt(slotId);
}

function parseRequiredSlotId(request: Request): bigint {
  const slotId = new URL(request.url).searchParams.get("slotId");
  if (!slotId || !/^\d+$/.test(slotId)) {
    throw new Error("Invalid Autodeposit scheduled slot.");
  }
  return BigInt(slotId);
}

function resolveProgressState(
  progress: EarnAutodepositScheduledSweepProgressRecord
): EarnAutodepositProgressState | null {
  if (progress.completedAt) {
    return "completed";
  }
  if (progress.completionFailureCode) {
    return "failed";
  }
  if (progress.status === "executed") {
    return "pull_confirmed";
  }
  if (
    progress.status === "scheduled" ||
    progress.status === "requested" ||
    progress.status === "selected" ||
    progress.status === "failed" ||
    progress.status === "released" ||
    progress.status === "canceled"
  ) {
    return progress.status;
  }
  return null;
}

export async function GET(request: Request) {
  const walletAddress =
    new URL(request.url).searchParams.get("walletAddress")?.trim() ?? "";
  if (!walletAddress) {
    return jsonError(400, "invalid_request", "walletAddress is required.");
  }
  try {
    decodeWalletAddress(walletAddress);
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(400, "invalid_request", "walletAddress is invalid.");
  }

  let slotId: bigint;
  try {
    slotId = parseRequiredSlotId(request);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error
        ? error.message
        : "Invalid Autodeposit scheduled slot."
    );
  }

  try {
    const user = await findCurrentUser({
      authMethod: "wallet",
      provider: "solana",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const account = user
      ? await findReadyCurrentUserSmartAccount({
          userId: user.id,
          walletAddress,
        })
      : null;
    if (!account) {
      return jsonError(
        404,
        "autodeposit_not_found",
        "No Earn Autodeposit policy is available for this wallet."
      );
    }

    const autodeposit = await findCurrentEarnAutodepositState({
      settings: account.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress,
    });
    if (!autodeposit) {
      return jsonError(
        404,
        "autodeposit_not_found",
        "No Earn Autodeposit policy is available for this wallet."
      );
    }

    const progress = await findEarnAutodepositScheduledSweepProgress(
      autodeposit.target,
      slotId
    );
    const state = progress ? resolveProgressState(progress) : null;
    if (!progress || !state) {
      return jsonError(
        404,
        "scheduled_sweep_not_found",
        "No matching Autodeposit scheduled sweep is available."
      );
    }

    return NextResponse.json(
      {
        eventId: progress.eventId?.toString(),
        eventType: EARN_REALTIME_EVENT_TYPES.autodeposit,
        failureCode: progress.completionFailureCode ?? undefined,
        occurredAt: progress.occurredAt.toISOString(),
        scheduledSlotId: progress.slotId.toString(),
        schemaVersion: EARN_REALTIME_SCHEMA_VERSION,
        scope: "autodeposit",
        state,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("[mobile-earn-autodeposit-sweeps-progress] read failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown request error.",
      errorName: error instanceof Error ? error.name : typeof error,
      walletAddress,
    });
    return jsonError(
      500,
      "progress_read_failed",
      "Failed to read Autodeposit sweep progress."
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_request", "Invalid request body.");
  }

  let slotId: bigint | null = null;
  try {
    slotId = parseOptionalSlotId(body);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error
        ? error.message
        : "Invalid Autodeposit scheduled slot."
    );
  }

  let walletAddress: string;
  try {
    ({ walletAddress } = await authenticateMobileEarnRequest({
      body,
      purpose: "earn-autodeposit-sweep-execute",
      request,
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let settingsPda: string;
  try {
    const user = await getOrCreateCurrentUser({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const existing = await findReadyCurrentUserSmartAccount({
      userId: user.id,
      walletAddress,
    });
    if (!existing) {
      return jsonError(
        409,
        "smart_account_not_ready",
        "No provisioned smart account for this wallet."
      );
    }
    settingsPda = existing.settingsPda;
  } catch (error) {
    console.error("[mobile-earn-autodeposit-sweeps-execute] resolve failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown resolve error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "resolve_failed",
      "Failed to resolve the smart account for this wallet."
    );
  }

  try {
    const autodeposit = await findCurrentEarnAutodepositState({
      settings: settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress,
    });

    if (!autodeposit) {
      return jsonError(
        404,
        "autodeposit_not_found",
        "No Earn Autodeposit policy is available for this wallet."
      );
    }

    if (autodeposit.status !== "active") {
      return jsonError(
        409,
        "autodeposit_not_active",
        "Earn Autodeposit must be active before a scheduled sweep can be executed now."
      );
    }

    // A target whose Earn position was fully withdrawn has no active route
    // policy left — the worker refuses its sweeps ("no active Earn route
    // policy"), so accepting the request would only mint a slot stuck on
    // "Executing…" forever. Refuse up front with the same error the setup
    // prepare gate uses; see earn-position-gate.server.ts. Fail open on
    // lookup errors. Keep in sync with the session route.
    try {
      if (
        !(await hasActiveEarnRoutePolicyPair({
          cluster: resolveLoyalClusterForSolanaEnv(
            resolveLoyalWebSolanaEnvFromEnv(process.env)
          ),
          settingsPda,
          walletAddress,
        }))
      ) {
        return jsonError(
          409,
          EARN_POSITION_REQUIRED_ERROR.code,
          EARN_POSITION_REQUIRED_ERROR.message
        );
      }
    } catch (gateError) {
      console.warn(
        "[mobile-earn-autodeposit-sweeps-execute] earn position gate skipped",
        {
          errorMessage:
            gateError instanceof Error
              ? gateError.message
              : "Unknown gate error.",
          walletAddress,
        }
      );
    }

    const requestResult = await requestImmediateEarnAutodepositScheduledSweep(
      autodeposit,
      {
        slotId,
      }
    );

    if (!requestResult) {
      return jsonError(
        409,
        "no_scheduled_sweeps",
        "There are no pending scheduled Autodeposit sweeps to execute now."
      );
    }

    return NextResponse.json({
      status: "requested",
      sweepRequest: serializeRequestResult(requestResult),
      target: serializeTarget(autodeposit.target),
    });
  } catch (error) {
    console.error("[mobile-earn-autodeposit-sweeps-execute] request failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown request error.",
      errorName: error instanceof Error ? error.name : typeof error,
      settings: settingsPda,
      walletAddress,
    });

    return jsonError(
      500,
      "request_failed",
      error instanceof Error
        ? error.message
        : "Failed to request immediate Autodeposit sweep execution."
    );
  }
}
