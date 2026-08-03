import { env } from "@/config/env";
import {
  fetchWithTimeout,
  FetchTimeoutError,
} from "@/lib/network/fetch-with-timeout";

import type { WirePreparedOperation } from "./wire";

// A first-ever deposit provisions the smart account inline on the server
// (finalized-creation wait plus reservation-conflict retries), which can
// exceed the platform's default request ceiling — iOS aborts at ~60s. Give
// prepare its own generous deadline; provisioning keeps running server-side,
// so a retry after a timeout lands on the fast path.
const PREPARE_TIMEOUT_MS = 120_000;

// Client for the wallet-signed mobile Earn endpoints on the `frontend` backend
// (env.earnApiBaseUrl, e.g. staging.askloyal.com). These are NOT the `/app`
// chat backend, so they don't go through `src/services/api.ts`.

export type EarnAuthFields = {
  walletAddress: string;
  signature: string;
  issuedAt: string;
};

// Bearer alternative for the DB-only Autodeposit endpoints: a cached mobile
// Earn session token (see earn-session.ts) instead of a per-request
// wallet-signed message — no wallet prompt.
export type EarnSessionAuth = { sessionToken: string };

// Splits either credential kind into request parts: signed auth fields spread
// into the body (the historical contract); a session token rides the
// Authorization header with no body auth fields.
function earnAuthParts(auth: EarnAuthFields | EarnSessionAuth): {
  headers: Record<string, string>;
  bodyFields: Record<string, string>;
} {
  return "sessionToken" in auth
    ? {
        bodyFields: {},
        headers: { Authorization: `Bearer ${auth.sessionToken}` },
      }
    : { bodyFields: { ...auth }, headers: {} };
}

// The serialized prepared deposit. Only the fields mobile needs to sign+send are
// typed; the whole object is echoed back to `confirm` opaquely.
export type WirePreparedEarnDeposit = {
  prepared: WirePreparedOperation;
  policySetupPrepared?: WirePreparedOperation | null;
  policyFinalizePrepared?: WirePreparedOperation | null;
};

export type EarnDepositPrepareResponse = {
  cluster: string;
  programId: string;
  settingsPda: string;
  smartAccountAddress: string;
  // Sponsor fee-payer pubkey when a sponsored prepare was requested and the
  // backend has a sponsor key configured; null/absent means the device must
  // fall back to the self-paid sign-and-send flow.
  sponsorFeePayer?: string | null;
  preparedDeposit: WirePreparedEarnDeposit;
};

export function earnHeaders(flowId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.vercelProtectionBypass) {
    headers["x-vercel-protection-bypass"] = env.vercelProtectionBypass;
  }
  // Joins server-side lifecycle stages (e.g. smart-account provisioning) to
  // the device flow that triggered them (ASK-1804).
  if (flowId) {
    headers["x-loyal-flow-id"] = flowId;
  }
  return headers;
}

// Carries the backend's error `code` so flows can react to specific failures
// (e.g. re-sign a fresh auth message on `stale_mobile_auth`), plus the response
// `status` when one arrived. Telemetry reports `status` as `httpStatus`, which
// is what separates a real backend failure from an error raised with no
// response at all (ASK-1872).
export class EarnApiError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "EarnApiError";
    this.code = code;
    this.status = status;
  }
}

async function throwEarnError(res: Response, fallback: string): Promise<never> {
  const payload = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  throw new EarnApiError(
    payload?.error?.message ?? fallback,
    payload?.error?.code,
    res.status,
  );
}

// Everything the device needs to run the SDK's deposit prepare locally
// (client-side instruction building on the device's own RPC) instead of
// calling `deposit/prepare` — mirrors the autodeposit `/state` prepareContext.
// Serialized by `deposit/prepare-context`.
export type EarnDepositPrepareContext = {
  cluster: string;
  programId: string;
  settingsPda: string;
  smartAccountAddress: string;
  policySigner: string;
  revokeStrayUsdcDelegate: boolean;
  yieldRoutingPolicy: {
    account: string;
    seed: string;
    setupPolicy: { account: string; seed: string } | null;
  } | null;
  target: {
    reserve: string;
    market: string;
    liquidityMint: string;
    supplyApyBps: string | null;
  } | null;
};

// Resolves the on-device prepare context (auth + provisioning + DB reads only
// — no instruction building server-side). Returns null when the backend
// predates the endpoint so the caller can fall back to the server prepare.
export async function fetchEarnDepositPrepareContext(args: {
  auth: EarnAuthFields;
  amountRaw: string;
  flowId?: string;
}): Promise<EarnDepositPrepareContext | null> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/deposit/prepare-context`,
      {
        method: "POST",
        headers: earnHeaders(args.flowId),
        body: JSON.stringify({
          ...args.auth,
          amountRaw: args.amountRaw,
        }),
        timeoutMs: PREPARE_TIMEOUT_MS,
      },
    );
  } catch (error) {
    if (error instanceof FetchTimeoutError) {
      throw new EarnApiError(
        "Setting up your Earn account is taking longer than usual. It finishes in the background — try again in a minute.",
      );
    }
    throw error;
  }
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    return throwEarnError(res, "Failed to prepare Earn deposit.");
  }
  return (await res.json()) as EarnDepositPrepareContext;
}

export async function prepareEarnDeposit(args: {
  auth: EarnAuthFields;
  amountRaw: string;
  sponsored?: boolean;
  flowId?: string;
}): Promise<EarnDepositPrepareResponse> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/deposit/prepare`,
      {
        method: "POST",
        headers: earnHeaders(args.flowId),
        body: JSON.stringify({
          ...args.auth,
          amountRaw: args.amountRaw,
          ...(args.sponsored ? { sponsored: true } : {}),
        }),
        timeoutMs: PREPARE_TIMEOUT_MS,
      },
    );
  } catch (error) {
    if (error instanceof FetchTimeoutError) {
      throw new EarnApiError(
        "Setting up your Earn account is taking longer than usual. It finishes in the background — try again in a minute.",
      );
    }
    throw error;
  }
  if (!res.ok) {
    return throwEarnError(res, "Failed to prepare Earn deposit.");
  }
  return (await res.json()) as EarnDepositPrepareResponse;
}

// --- Withdraw -------------------------------------------------------------

export type EarnWithdrawMode = "partial" | "full";

// Which Earn source to withdraw from. Omitted/null lets the backend auto-select
// when there's exactly one source (the common single-reserve case).
export type EarnWithdrawSource = {
  type: "reserve" | "idle";
  id: string;
  amountRaw?: string;
  liquidityMint?: string;
  market?: string | null;
  mint?: string;
  reserve?: string;
  tokenAccount?: string;
} | null;

// Serialized prepared withdrawal. Only the fields mobile signs/sends are typed;
// the whole object is echoed back to `confirm` opaquely (the backend rebuilds
// the canonical confirm payload from it).
export type WirePreparedEarnWithdrawStep = {
  prepared: WirePreparedOperation;
};

// The Autodeposit teardown bundled into a full exit. Mobile only reads the
// identifiers and re-prepares the close on-device via the close flow; the rest
// of the wire payload is ignored.
export type WireEarnWithdrawAutodepositClose = {
  policy: { account: string };
  subscription: { recurringDelegation: string };
};

export type WirePreparedEarnWithdraw = {
  prepared: WirePreparedOperation;
  withdrawSteps?: WirePreparedEarnWithdrawStep[];
  autodepositClosePrepared?: WireEarnWithdrawAutodepositClose | null;
};

export type EarnWithdrawPrepareResponse = {
  cluster: string;
  programId: string;
  settingsPda: string;
  smartAccountAddress: string;
  preparedWithdraw: WirePreparedEarnWithdraw;
};

export async function prepareEarnWithdraw(args: {
  auth: EarnAuthFields;
  amountRaw: string;
  mode: EarnWithdrawMode;
  source?: EarnWithdrawSource;
}): Promise<EarnWithdrawPrepareResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/withdraw/prepare`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({
        ...args.auth,
        amountRaw: args.amountRaw,
        mode: args.mode,
        source: args.source ?? null,
      }),
    },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to prepare Earn withdrawal.");
  }
  return (await res.json()) as EarnWithdrawPrepareResponse;
}

// The resolved SDK input for an ON-DEVICE withdraw prepare, serialized by
// `withdraw/prepare-context` (`earn-withdraw-input-resolution.server.ts`) —
// the server keeps source selection/reconcile; the device builds the
// transactions. Hydrated in `withdraw.ts`.
export type EarnWithdrawPrepareContext = {
  cluster: string;
  programId: string;
  settingsPda: string;
  smartAccountAddress: string;
  withdrawInput: {
    amountRaw: string;
    mode: EarnWithdrawMode;
    closePoliciesOnFullWithdrawal: boolean;
    policySigner: string;
    source:
      | {
          type: "reserve";
          id: string;
          amountRaw: string;
          liquidityMint: string;
          market: string;
          reserve: string;
        }
      | {
          type: "idle";
          id: string;
          amountRaw: string;
          mint: string;
          tokenAccount: string;
        }
      | null;
    target: {
      reserve: string;
      market: string;
      liquidityMint: string;
      supplyApyBps: string | null;
    } | null;
    fullWithdrawalTargets:
      | {
          amountRaw: string | null;
          liquidityMint: string;
          market: string;
          reserve: string;
          reserveCollateralMint: string | null;
          reserveLiquiditySupply: string | null;
          supplyApyBps: string | null;
          vaultCollateralAta: string | null;
        }[]
      | null;
    yieldRoutingPolicy: {
      account: string;
      seed: string;
      setupPolicy: { account: string; seed: string } | null;
    };
    autodepositClose: {
      policy: string;
      recurringDelegation: string;
    } | null;
  };
};

// Resolves the on-device withdraw prepare context (auth + source selection
// only — no instruction building server-side). Returns null when the backend
// predates the endpoint so the caller can fall back to the server prepare.
export async function fetchEarnWithdrawPrepareContext(args: {
  auth: EarnAuthFields;
  amountRaw: string;
  mode: EarnWithdrawMode;
  source?: EarnWithdrawSource;
  flowId?: string;
}): Promise<EarnWithdrawPrepareContext | null> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/withdraw/prepare-context`,
    {
      method: "POST",
      headers: earnHeaders(args.flowId),
      body: JSON.stringify({
        ...args.auth,
        amountRaw: args.amountRaw,
        mode: args.mode,
        source: args.source ?? null,
      }),
    },
  );
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    return throwEarnError(res, "Failed to prepare Earn withdrawal.");
  }
  return (await res.json()) as EarnWithdrawPrepareContext;
}

// Fresh post-withdraw inputs for the device-side cleanup prepare. The backend
// verifies that no Kamino holding remains at or after `minContextSlot` and
// returns the exact stable vault-USDC balance; it does not build a transaction.
export type EarnWithdrawCleanupPrepareContext = {
  cluster: string;
  programId: string;
  settingsPda: string;
  cleanupInput: {
    closeVaultCollateralAtas: string[];
    idleAmountRaw: string;
    policySigner: string;
    yieldRoutingPolicy: {
      account: string;
      seed: string;
      setupPolicy: { account: string; seed: string } | null;
    };
  };
};

export async function fetchEarnWithdrawCleanupPrepareContext(args: {
  auth: EarnAuthFields;
  minContextSlot: string;
  flowId?: string;
}): Promise<EarnWithdrawCleanupPrepareContext> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/withdraw/cleanup/prepare-context`,
    {
      method: "POST",
      headers: earnHeaders(args.flowId),
      body: JSON.stringify({
        ...args.auth,
        minContextSlot: args.minContextSlot,
      }),
    },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to prepare Earn account cleanup.");
  }
  return (await res.json()) as EarnWithdrawCleanupPrepareContext;
}

export type EarnWithdrawCleanupConfirmArgs = {
  auth: EarnAuthFields;
  cleanupSignature: string;
  confirmedSlot: string;
};

export async function confirmEarnWithdrawCleanup(
  args: EarnWithdrawCleanupConfirmArgs,
): Promise<void> {
  const { auth, ...rest } = args;
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/withdraw/cleanup/confirm`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...auth, ...rest }),
    },
  );
  if (!res.ok) {
    await throwEarnError(res, "Failed to confirm Earn account cleanup.");
  }
}

export type EarnWithdrawConfirmArgs = {
  auth: EarnAuthFields;
  preparedWithdraw: WirePreparedEarnWithdraw;
  // Index into `withdrawSteps` for a multi-step withdrawal; omitted for single.
  stepIndex?: number;
  withdrawalSignature: string;
  confirmedSlot: string;
  autodepositCloseSignature?: string;
  autodepositCloseConfirmedSlot?: string;
};

export async function confirmEarnWithdraw(
  args: EarnWithdrawConfirmArgs,
): Promise<void> {
  const { auth, ...rest } = args;
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/withdraw/confirm`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...auth, ...rest }),
    },
  );
  if (!res.ok) {
    await throwEarnError(res, "Failed to confirm Earn withdrawal.");
  }
}

// A withdrawable Earn source (a Kamino reserve position or idle vault USDC),
// with both display fields and the identifiers `withdraw/prepare` needs.
export type EarnWithdrawSourceInfo = {
  type: "reserve" | "idle";
  id: string;
  label: string;
  amountRaw: string;
  liquidityMint: string;
  market: string | null;
  reserve: string | null;
  tokenAccount: string | null;
};

export type EarnWithdrawSourcesResponse = {
  sources: EarnWithdrawSourceInfo[];
  settingsPda: string | null;
  smartAccountAddress: string | null;
};

// Read-only list of withdrawal sources for the wallet (no signature).
export async function fetchEarnWithdrawSources(
  walletAddress: string,
): Promise<EarnWithdrawSourcesResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/withdraw/sources?walletAddress=${encodeURIComponent(
      walletAddress,
    )}`,
    { method: "GET", headers: earnHeaders() },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to load Earn withdrawal sources.");
  }
  return (await res.json()) as EarnWithdrawSourcesResponse;
}

// Maps a source list entry to the `withdraw/prepare` source identifier shape.
export function toWithdrawPrepareSource(
  info: EarnWithdrawSourceInfo,
): EarnWithdrawSource {
  return {
    type: info.type,
    id: info.id,
    amountRaw: info.amountRaw,
    liquidityMint: info.liquidityMint,
    market: info.market,
    reserve: info.reserve ?? undefined,
    tokenAccount: info.tokenAccount ?? undefined,
    mint: info.type === "idle" ? info.liquidityMint : undefined,
  };
}

// --- Autodeposit ----------------------------------------------------------

export type EarnAutodepositSetupStage =
  | "initialize_subscription_authority"
  | "approve_token_delegate"
  | "create_policy"
  | "create_recurring_delegation";

// Only the fields the mobile orchestrator reads are typed; the whole object is
// echoed back to `setup/confirm` opaquely (the backend rebuilds the canonical
// confirm payload from it).
export type WirePreparedEarnAutodepositSetup = {
  prepared: WirePreparedOperation;
  stage: EarnAutodepositSetupStage;
  policy: { seed: string | null };
  persistence: { policySeed: string | null };
};

export type WirePreparedEarnAutodepositClose = {
  prepared: WirePreparedOperation;
};

// A pending Autodeposit "bootstrap" sweep — the surplus the backend scheduled to
// move into Earn ~1h after setup (or after a threshold edit). Mirrors the web
// `LoadedEarnAutodepositScheduledSweep`. `remainingAmountRaw > 0` means it's
// still pending; `eligibleAfter` is the ISO time the sweep worker becomes free
// to run it. `status` is the aggregated slot status
// (scheduled/requested/selected/failed/released) — the backend only returns live
// pending slots, so it's used for button state, not visibility.
export type EarnAutodepositScheduledSweep = {
  classification: string;
  confidence: string;
  eligibleAfter: string;
  // ISO time the "Execute now" acceleration becomes available (the recurring
  // delegation window opening) — drives the web's "Available in Xs" button
  // countdown. Absent/null on older backends or when already available.
  executeNowAvailableAt?: string | null;
  id: string;
  originalAmountRaw: string;
  reason: string;
  remainingAmountRaw: string;
  status: string;
};

export type EarnAutodepositState = {
  active: boolean;
  status: string;
  policyAccount: string;
  recurringDelegation: string | null;
  walletBalanceFloorRaw: string | null;
  lifecycleStatus: string;
  vaultIndex: number;
  scheduledSweeps?: EarnAutodepositScheduledSweep[];
  // Resume metadata for the device-side prepare (absent on older backends):
  // a half-finished setup must reuse the recorded seed/nonce/window so the SDK
  // returns the missing stage for the SAME policy/delegation pair.
  policySeed?: string;
  recurringDelegationNonce?: string | null;
  periodLengthSeconds?: string | null;
  startTimestamp?: string | null;
  recurringDelegationExpiryTimestamp?: string | null;
};

// Deployment parameters the device needs to run the SDK's autodeposit prepare
// locally. Absent/null on backends that predate device-side prepare or when
// the deployment isn't configured for it.
export type EarnAutodepositPrepareContext = {
  cluster: string;
  policySigner: string;
  programId: string;
};

export type EarnAutodepositStateResponse = {
  autodeposit: EarnAutodepositState | null;
  prepareContext?: EarnAutodepositPrepareContext | null;
  settingsPda: string | null;
  smartAccountAddress: string | null;
};

// Read-only autodeposit state, keyed by wallet address (no signature).
export async function fetchEarnAutodepositState(
  walletAddress: string,
): Promise<EarnAutodepositStateResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/state?walletAddress=${encodeURIComponent(
      walletAddress,
    )}`,
    { method: "GET", headers: earnHeaders() },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to load Autodeposit state.");
  }
  return (await res.json()) as EarnAutodepositStateResponse;
}

export async function confirmEarnAutodepositSetup(args: {
  auth: EarnAuthFields;
  preparedSetup: WirePreparedEarnAutodepositSetup;
  setupSignature: string;
  confirmedSlot: string;
  walletBalanceFloorRaw: string;
}): Promise<void> {
  const { auth, ...rest } = args;
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/setup/confirm`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...auth, ...rest }),
    },
  );
  if (!res.ok) {
    await throwEarnError(res, "Failed to confirm Autodeposit setup.");
  }
}

export async function updateEarnAutodepositFloor(args: {
  auth: EarnAuthFields | EarnSessionAuth;
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: number;
  walletBalanceFloorRaw: string;
}): Promise<void> {
  const { auth, ...rest } = args;
  const { headers, bodyFields } = earnAuthParts(auth);
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/floor/confirm`,
    {
      method: "POST",
      headers: { ...earnHeaders(), ...headers },
      body: JSON.stringify({ ...bodyFields, ...rest }),
    },
  );
  if (!res.ok) {
    await throwEarnError(res, "Failed to update Autodeposit threshold.");
  }
}

export async function toggleEarnAutodeposit(args: {
  auth: EarnAuthFields | EarnSessionAuth;
  flowId?: string;
  active: boolean;
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: number;
}): Promise<void> {
  const { auth, flowId, ...rest } = args;
  const { headers, bodyFields } = earnAuthParts(auth);
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/toggle/confirm`,
    {
      method: "POST",
      headers: { ...earnHeaders(flowId), ...headers },
      body: JSON.stringify({ ...bodyFields, ...rest }),
    },
  );
  if (!res.ok) {
    await throwEarnError(res, "Failed to update Autodeposit on/off state.");
  }
}

export async function confirmEarnAutodepositClose(args: {
  auth: EarnAuthFields;
  preparedClose: WirePreparedEarnAutodepositClose;
  closeSignature: string;
  confirmedSlot: string;
}): Promise<void> {
  const { auth, ...rest } = args;
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/close/confirm`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...auth, ...rest }),
    },
  );
  if (!res.ok) {
    await throwEarnError(res, "Failed to confirm Autodeposit removal.");
  }
}

export type EarnAutodepositSweepExecuteResponse = {
  status: string;
  sweepRequest: {
    acceleratedAmountRaw: string;
    acceleratedLotCount: number;
    eligibleAfter: string;
    slotId: string;
    targetId: string;
  };
  target: {
    active: boolean;
    balanceSweepPolicyId: string | null;
    id: string;
    lifecycleStatus: string;
    policyAccount: string;
    recurringDelegation: string | null;
    walletBalanceFloorRaw: string | null;
  };
};

// Ask the sweep worker to run the pending scheduled Autodeposit sweep now
// instead of waiting out its ~1h window. The target is resolved from the
// wallet's active policy (no body params beyond the signed auth). Mirrors the
// web `yield-optimization/autodeposit/sweeps/execute` route.
export async function requestEarnAutodepositSweepExecute(args: {
  auth: EarnAuthFields | EarnSessionAuth;
}): Promise<EarnAutodepositSweepExecuteResponse> {
  const { headers, bodyFields } = earnAuthParts(args.auth);
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/sweeps/execute`,
    {
      method: "POST",
      headers: { ...earnHeaders(), ...headers },
      body: JSON.stringify(bodyFields),
    },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to execute Autodeposit sweep now.");
  }
  return (await res.json()) as EarnAutodepositSweepExecuteResponse;
}

// Granular slot states as the worker moves a sweep through its pipeline —
// mirrors the web `EARN_AUTODEPOSIT_PROGRESS_STATES` (earn-realtime types).
export type EarnAutodepositSweepProgressState =
  | "scheduled"
  | "requested"
  | "selected"
  | "pull_confirmed"
  | "completed"
  | "failed"
  | "canceled"
  | "released";

const EARN_SWEEP_PROGRESS_STATES = new Set<string>([
  "scheduled",
  "requested",
  "selected",
  "pull_confirmed",
  "completed",
  "failed",
  "canceled",
  "released",
]);

export type EarnAutodepositSweepProgress = {
  scheduledSlotId: string;
  state: EarnAutodepositSweepProgressState;
  failureCode?: string;
  occurredAt?: string;
};

// Read-only progress of one scheduled sweep, keyed by wallet address (no
// signature) — the polled twin of the contract the web receives over SSE.
// Returns null on ANY failure, including 404 from a backend that predates the
// endpoint, so callers can quietly fall back to the coarse state polling.
export async function fetchEarnAutodepositSweepProgress(
  walletAddress: string,
  slotId: string,
): Promise<EarnAutodepositSweepProgress | null> {
  try {
    const res = await fetch(
      `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/sweeps/execute?walletAddress=${encodeURIComponent(
        walletAddress,
      )}&slotId=${encodeURIComponent(slotId)}`,
      { method: "GET", headers: earnHeaders() },
    );
    if (!res.ok) {
      return null;
    }
    const value = (await res.json()) as Record<string, unknown> | null;
    if (
      !value ||
      value.scheduledSlotId !== slotId ||
      typeof value.state !== "string" ||
      !EARN_SWEEP_PROGRESS_STATES.has(value.state)
    ) {
      return null;
    }
    return {
      scheduledSlotId: slotId,
      state: value.state as EarnAutodepositSweepProgressState,
      failureCode:
        typeof value.failureCode === "string" ? value.failureCode : undefined,
      occurredAt:
        typeof value.occurredAt === "string" ? value.occurredAt : undefined,
    };
  } catch {
    return null;
  }
}

// Current on-chain Earn position read-model (balance + live APY). All amounts
// are USDC base units (6 decimals) as strings; APY is in basis points.
export type EarnPosition = {
  currentAmountRaw: string;
  currentSupplyApyBps: string | null;
  principalAmountRaw: string;
  status: string;
};

export type EarnStateResponse = {
  position: EarnPosition | null;
  settingsPda: string | null;
  smartAccountAddress: string | null;
};

// Read-only balance lookup keyed by wallet address — no signature, so it never
// triggers a Seed Vault prompt on passive Earn-tab views (the server resolves
// the wallet's smart account itself and only returns public on-chain data).
export async function fetchEarnState(
  walletAddress: string,
): Promise<EarnStateResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/state?walletAddress=${encodeURIComponent(
      walletAddress,
    )}`,
    { method: "GET", headers: earnHeaders() },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to load Earn state.");
  }
  return (await res.json()) as EarnStateResponse;
}

// Live on-chain Earn holdings snapshot — the same read the web does for its
// headline balance (the vault's Kamino obligations + idle USDC, summed live via
// RPC). Used to override `fetchEarnState`'s `currentAmountRaw`, which reads a DB
// read-model that lags the chain and omits non-idle venue holdings (so the
// native balance showed stale/low values). All amounts are USDC base units
// (6 decimals) as strings. Wallet-keyed, read-only, no signature — like `state`.
export type EarnHoldingItem = {
  kind: "kamino" | "idle";
  label: string;
  amountRaw: string;
  liquidityMint: string;
  market: string | null;
  marketName: string | null;
  reserve: string | null;
};

export type EarnHoldingsResponse = {
  currentTotalAmountRaw: string;
  holdings: EarnHoldingItem[];
  observedAt: string | null;
  observedSlot: string | null;
  settingsPda: string | null;
  smartAccountAddress: string | null;
};

export async function fetchEarnHoldings(
  walletAddress: string,
): Promise<EarnHoldingsResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/holdings?walletAddress=${encodeURIComponent(
      walletAddress,
    )}`,
    { method: "GET", headers: earnHeaders() },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to load Earn holdings.");
  }
  return (await res.json()) as EarnHoldingsResponse;
}

// Per-user Earn earnings for the Earnings chart (read-only, keyed by wallet
// address — no signature, like `state`). `bars` are per-day earned amounts; the
// chart plots them per-day (each bar = that day's earnings). The live odometer
// anchors to the client fetch time.
export type EarnEarningsBar = {
  apyBps: number | null;
  avgPrincipalUsd: number;
  earnedUsd: number;
  endAt: string;
  isCurrent: boolean;
  label: string;
  principalAmountRaw: string;
  principalUsd: number;
  startAt: string;
};

export type EarnEarningsResponse = {
  bars: EarnEarningsBar[];
  currentApyBps: number | null;
  lastDepositAt: string | null;
  lifetimeEarnedUsd: number;
  principalAmountRaw: string;
  principalUsd: number;
  rangeEarnedUsd: number;
  sinceLastDepositEarnedUsd: number;
  todayEarnedUsd: number;
};

// The backend returns every range in one payload (7D/30D/1Y/ALL); the mobile
// chart plots the 30-day daily range. Older backends returned that one range
// flat, so accept both shapes — the OTA and the backend deploy independently.
export type EarnEarningsRangeSetResponse = {
  ranges: Record<"7D" | "30D" | "1Y" | "ALL", EarnEarningsResponse>;
};

// The server buckets bars by calendar day in this zone. Omitting it buckets in
// UTC, which puts the wrong earnings in "today" for anyone far from it — and
// disagrees with web, which sends the browser's zone.
function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export async function fetchEarnEarnings(
  walletAddress: string,
): Promise<EarnEarningsResponse> {
  const timezone = deviceTimezone();
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/earnings?walletAddress=${encodeURIComponent(
      walletAddress,
    )}${timezone ? `&timezone=${encodeURIComponent(timezone)}` : ""}`,
    { method: "GET", headers: earnHeaders() },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to load Earn earnings.");
  }
  const payload = (await res.json()) as
    | EarnEarningsRangeSetResponse
    | EarnEarningsResponse;
  return "ranges" in payload ? payload.ranges["30D"] : payload;
}

// --- Earn transactions (activity) ----------------------------------------

export type EarnTransactionKind =
  | "autodeposit_action"
  | "balance_sweep"
  | "deposit"
  | "withdraw"
  | "rebalance"
  | "reconciliation";

export type EarnTransactionEventType =
  | "autodeposit_closed"
  | "autodeposit_created"
  | "balance_sweep"
  | "deposit_initialized"
  | "deposit_top_up"
  | "withdrawal_partial"
  | "withdrawal_full"
  | "rebalance_confirmed"
  | "snapshot_reconciled";

export type EarnTransactionAccount = { label: string; icon: string | null };

// One Earn vault transaction (deposit/withdraw/rebalance/autodeposit). Mirrors
// the web `earn-transactions` response: `amount` is pre-formatted with its sign,
// `dateGroup`/`timestamp` are display strings, raw values echoed for detail.
export type EarnTransactionItem = {
  id: string;
  kind: EarnTransactionKind;
  eventType: EarnTransactionEventType;
  confirmedAt?: string;
  dateGroup: string;
  timestamp: string;
  amount: string;
  rawAmount: string;
  signature: string;
  sortTimestamp?: string;
  confirmedSlot: string;
  source: EarnTransactionAccount;
  destination: EarnTransactionAccount;
};

export type EarnTransactionsResponse = {
  transactions: EarnTransactionItem[];
};

// Read-only Earn transaction history, keyed by wallet address (no signature,
// like `state`/`earnings`). Wallet-keyed twin of the web session
// `earn-transactions` route.
export async function fetchEarnTransactions(
  walletAddress: string,
): Promise<EarnTransactionsResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/transactions?walletAddress=${encodeURIComponent(
      walletAddress,
    )}`,
    { method: "GET", headers: earnHeaders() },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to load Earn transactions.");
  }
  return (await res.json()) as EarnTransactionsResponse;
}

// Global (per-cluster, not per-user) Earn APY forecast + history — unauthenticated.
// Mirrors the web `/earn-forecast/summary` response consumed by the APY/Forecast
// charts. APYs are in basis points.
export type EarnApySample = { apyBps: number; observedAt: string };

export type EarnApySeries = {
  key: "loyal" | "mainUsdcReserve";
  samples: EarnApySample[];
};

export type EarnForecastSummary = {
  forecast: {
    apyBps: number;
    rangeHighBps: number;
    rangeLowBps: number;
    window: { startedAt: string; endedAt: string };
  };
  history: {
    samples: EarnApySample[];
    series?: EarnApySeries[];
    window?: { startedAt: string; endedAt: string };
  };
};

export async function fetchEarnForecastSummary(): Promise<EarnForecastSummary> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/earn-forecast/summary`,
    { method: "GET", headers: earnHeaders() },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to load Earn forecast.");
  }
  return (await res.json()) as EarnForecastSummary;
}

export type EarnDepositConfirmArgs = {
  auth: EarnAuthFields;
  // Echoed back verbatim from the prepare response; the backend rebuilds the
  // canonical confirm payload from it.
  preparedDeposit: WirePreparedEarnDeposit;
  depositSignature: string;
  confirmedSlot: string;
  policySignature?: string;
  policyConfirmedSlot?: string;
  setupPolicySignature?: string;
  setupPolicyConfirmedSlot?: string;
};

export async function confirmEarnDeposit(
  args: EarnDepositConfirmArgs,
): Promise<void> {
  const { auth, ...rest } = args;
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/deposit/confirm`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...auth, ...rest }),
    },
  );
  if (!res.ok) {
    await throwEarnError(res, "Failed to confirm Earn deposit.");
  }
}

// --- Sponsored deposit -----------------------------------------------------

export type EarnSponsoredConfirmation = {
  signature: string;
  confirmedSlot: string;
};

export type EarnSponsoredDepositConfirmations = {
  deposit: EarnSponsoredConfirmation;
  policy: EarnSponsoredConfirmation;
  setupPolicy: EarnSponsoredConfirmation | null;
};

export type EarnSponsoredDepositConfirmArgs = {
  auth: EarnAuthFields;
  // Echoed back verbatim from the prepare response (like `confirmEarnDeposit`).
  preparedDeposit: WirePreparedEarnDeposit;
  // Base64 user-signed transactions compiled with the sponsor as fee payer.
  // The server sponsor-signs, sends and confirms them, so unlike
  // `confirmEarnDeposit` this call IS the on-chain execution — treat failures
  // as flow failures, not best-effort recording misses.
  depositTransaction: string;
  policyTransaction?: string;
  setupPolicyTransaction?: string;
};

export async function confirmEarnDepositSponsored(
  args: EarnSponsoredDepositConfirmArgs,
): Promise<EarnSponsoredDepositConfirmations> {
  const { auth, ...rest } = args;
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/deposit/confirm/sponsored`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...auth, ...rest }),
    },
  );
  const payload = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
    sponsoredConfirmations?: EarnSponsoredDepositConfirmations;
  } | null;
  // An error response that still carries confirmations means the transactions
  // landed on-chain but the read-model record failed — same as the regular
  // flow's best-effort confirm, the reconciler backfills, so don't fail a
  // deposit that already happened.
  if (payload?.sponsoredConfirmations) {
    if (!res.ok) {
      console.warn(
        "[earn-api] sponsored deposit landed but record failed; reconciler will backfill",
        payload.error,
      );
    }
    return payload.sponsoredConfirmations;
  }
  // Both throws carry `res.status`: the backend did answer, and telemetry
  // reads a missing status as "no response was ever received".
  if (!res.ok) {
    throw new EarnApiError(
      payload?.error?.message ?? "Failed to execute sponsored Earn deposit.",
      payload?.error?.code,
      res.status,
    );
  }
  throw new EarnApiError(
    "Sponsored Earn deposit response is missing confirmations.",
    undefined,
    res.status,
  );
}

// Solana Week quest progress (read-only, keyed by wallet — same `frontend`
// backend and no-signature pattern as `fetchEarnState`). Powers the in-app
// quest test page; Solana stays authoritative for the actual badge/claim state.
export type SolanaWeekQuestKind = "earn_deposit" | "first_autodeposit_sweep";

export type SolanaWeekQuestStatus =
  | "reported"
  | "pending"
  | "failed"
  | "not_started";

export type SolanaWeekQuestProgressItem = {
  kind: SolanaWeekQuestKind;
  status: SolanaWeekQuestStatus;
  solanaStatus: string | null;
  reportedAt: string | null;
  attempts: number;
};

export type SolanaWeekQuestProgressResponse = {
  walletAddress: string;
  quests: SolanaWeekQuestProgressItem[];
};

export async function fetchSolanaWeekQuestProgress(
  walletAddress: string,
): Promise<SolanaWeekQuestProgressResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/solana-week/progress?walletAddress=${encodeURIComponent(
      walletAddress,
    )}`,
    { method: "GET", headers: earnHeaders() },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to load quest progress.");
  }
  return (await res.json()) as SolanaWeekQuestProgressResponse;
}

// --- Rent refunds -----------------------------------------------------------
//
// Scan for closed Earn accounts still holding refundable rent: dead vault
// policies, revoked/expired recurring delegations, and the vault itself
// (stranded setup SOL + token-account rents). Wallet-keyed and read-only —
// no signature (like `state`), so the auto-scan never prompts
// Seed Vault. Only `prepare` (which returns a signable transaction) is
// wallet-signed.

export type EarnRefundScanItem = {
  account: string;
  blockedReason: string | null;
  canRefund: boolean;
  lamports: number | null;
};

export type EarnRefundScanVault = EarnRefundScanItem & {
  totalRefundableLamports: number;
};

export type EarnRefundScanResponse = {
  scan: {
    policies: EarnRefundScanItem[];
    recurringDelegations: EarnRefundScanItem[];
    vault: EarnRefundScanVault | null;
  } | null;
};

export async function fetchEarnRefundScan(
  walletAddress: string,
): Promise<EarnRefundScanResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/policy-refunds/scan?walletAddress=${encodeURIComponent(
      walletAddress,
    )}`,
    { method: "GET", headers: earnHeaders() },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to scan for refunds.");
  }
  return (await res.json()) as EarnRefundScanResponse;
}

export type EarnRefundPrepareRequest =
  | { kind: "policy"; policyAccount: string }
  | { kind: "recurring_delegation"; recurringDelegation: string }
  | { kind: "vault" };

type WirePreparedEarnRefund = {
  estimatedRefundLamports: number | null;
  prepared: WirePreparedOperation;
};

export type EarnRefundPrepareResponse = {
  preparedRefund?: WirePreparedEarnRefund;
  preparedRecurringDelegationRefund?: WirePreparedEarnRefund;
  preparedVaultRefund?: WirePreparedEarnRefund;
};

export async function prepareEarnRefund(args: {
  auth: EarnAuthFields;
  request: EarnRefundPrepareRequest;
}): Promise<EarnRefundPrepareResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/policy-refunds/prepare`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...args.auth, ...args.request }),
    },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to prepare the refund.");
  }
  return (await res.json()) as EarnRefundPrepareResponse;
}
