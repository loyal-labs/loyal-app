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

function earnHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.vercelProtectionBypass) {
    headers["x-vercel-protection-bypass"] = env.vercelProtectionBypass;
  }
  return headers;
}

// Carries the backend's error `code` so flows can react to specific failures
// (e.g. re-sign a fresh auth message on `stale_mobile_auth`).
export class EarnApiError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "EarnApiError";
    this.code = code;
  }
}

async function throwEarnError(res: Response, fallback: string): Promise<never> {
  const payload = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  throw new EarnApiError(
    payload?.error?.message ?? fallback,
    payload?.error?.code,
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
}): Promise<EarnDepositPrepareContext | null> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/deposit/prepare-context`,
      {
        method: "POST",
        headers: earnHeaders(),
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
}): Promise<EarnDepositPrepareResponse> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/deposit/prepare`,
      {
        method: "POST",
        headers: earnHeaders(),
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
}): Promise<EarnWithdrawPrepareContext | null> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/withdraw/prepare-context`,
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
}): Promise<EarnWithdrawCleanupPrepareContext> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/withdraw/cleanup/prepare-context`,
    {
      method: "POST",
      headers: earnHeaders(),
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
  auth: EarnAuthFields;
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: number;
  walletBalanceFloorRaw: string;
}): Promise<void> {
  const { auth, ...rest } = args;
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/floor/confirm`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...auth, ...rest }),
    },
  );
  if (!res.ok) {
    await throwEarnError(res, "Failed to update Autodeposit threshold.");
  }
}

export async function toggleEarnAutodeposit(args: {
  auth: EarnAuthFields;
  active: boolean;
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: number;
}): Promise<void> {
  const { auth, ...rest } = args;
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/toggle/confirm`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...auth, ...rest }),
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
  auth: EarnAuthFields;
}): Promise<EarnAutodepositSweepExecuteResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/sweeps/execute`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...args.auth }),
    },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to execute Autodeposit sweep now.");
  }
  return (await res.json()) as EarnAutodepositSweepExecuteResponse;
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
// address — no signature, like `state`). Mirrors the web's single-range
// `/yield-optimization/earnings` response; the mobile route always returns the
// 30-day daily range. `bars` are per-day earned amounts; the chart plots them
// per-day (each bar = that day's earnings). The single-range response has no
// `generatedAt`, so the live odometer anchors to the client fetch time.
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

export async function fetchEarnEarnings(
  walletAddress: string,
): Promise<EarnEarningsResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/earnings?walletAddress=${encodeURIComponent(
      walletAddress,
    )}`,
    { method: "GET", headers: earnHeaders() },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to load Earn earnings.");
  }
  return (await res.json()) as EarnEarningsResponse;
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
  if (!res.ok) {
    throw new EarnApiError(
      payload?.error?.message ?? "Failed to execute sponsored Earn deposit.",
      payload?.error?.code,
    );
  }
  throw new EarnApiError(
    "Sponsored Earn deposit response is missing confirmations.",
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
