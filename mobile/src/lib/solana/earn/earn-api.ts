import { env } from "@/config/env";

import type { WirePreparedOperation } from "./wire";

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

async function throwEarnError(res: Response, fallback: string): Promise<never> {
  const payload = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  throw new Error(payload?.error?.message ?? fallback);
}

export async function prepareEarnDeposit(args: {
  auth: EarnAuthFields;
  amountRaw: string;
}): Promise<EarnDepositPrepareResponse> {
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/deposit/prepare`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...args.auth, amountRaw: args.amountRaw }),
    },
  );
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

export type WirePreparedEarnWithdraw = {
  prepared: WirePreparedOperation;
  withdrawSteps?: WirePreparedEarnWithdrawStep[];
  autodepositClosePrepared?: unknown | null;
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
// `LoadedEarnAutodepositScheduledSweep`: `status: "open"` with
// `remainingAmountRaw > 0` means it's still pending; `eligibleAfter` is the ISO
// time the sweep worker becomes free to run it.
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
};

export type EarnAutodepositStateResponse = {
  autodeposit: EarnAutodepositState | null;
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

export type EarnAutodepositSetupPrepareResponse = {
  preparedSetup: WirePreparedEarnAutodepositSetup;
};

export async function prepareEarnAutodepositSetup(args: {
  auth: EarnAuthFields;
  amountRaw: string;
  nonce: string;
  policySeed?: string;
  walletBalanceFloorRaw: string;
}): Promise<EarnAutodepositSetupPrepareResponse> {
  const { auth, ...rest } = args;
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/setup/prepare`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...auth, ...rest }),
    },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to prepare Autodeposit setup.");
  }
  return (await res.json()) as EarnAutodepositSetupPrepareResponse;
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

export type EarnAutodepositClosePrepareResponse = {
  preparedClose: WirePreparedEarnAutodepositClose;
};

export async function prepareEarnAutodepositClose(args: {
  auth: EarnAuthFields;
  policy: string;
  recurringDelegation: string;
}): Promise<EarnAutodepositClosePrepareResponse> {
  const { auth, ...rest } = args;
  const res = await fetch(
    `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/autodeposit/close/prepare`,
    {
      method: "POST",
      headers: earnHeaders(),
      body: JSON.stringify({ ...auth, ...rest }),
    },
  );
  if (!res.ok) {
    return throwEarnError(res, "Failed to prepare Autodeposit removal.");
  }
  return (await res.json()) as EarnAutodepositClosePrepareResponse;
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
