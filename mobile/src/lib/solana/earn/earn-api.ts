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
