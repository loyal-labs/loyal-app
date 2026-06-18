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

export type EarnAutodepositState = {
  active: boolean;
  status: string;
  policyAccount: string;
  recurringDelegation: string | null;
  walletBalanceFloorRaw: string | null;
  lifecycleStatus: string;
  vaultIndex: number;
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
