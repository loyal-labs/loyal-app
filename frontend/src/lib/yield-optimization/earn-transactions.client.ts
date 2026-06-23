"use client";

export type EarnTransactionItem = {
  id: string;
  kind:
    | "autodeposit_action"
    | "balance_sweep"
    | "deposit"
    | "withdraw"
    | "rebalance"
    | "reconciliation";
  eventType:
    | "autodeposit_closed"
    | "autodeposit_created"
    | "balance_sweep"
    | "deposit_initialized"
    | "deposit_top_up"
    | "withdrawal_partial"
    | "withdrawal_full"
    | "rebalance_confirmed"
    | "snapshot_reconciled";
  confirmedAt?: string;
  dateGroup: string;
  timestamp: string;
  amount: string;
  rawAmount: string;
  signature: string;
  sortTimestamp?: string;
  confirmedSlot: string;
  source: { label: string; icon: string | null };
  destination: { label: string; icon: string | null };
};

export type EarnTransactionsRouteResponse = {
  transactions: EarnTransactionItem[];
};

export type EarnTransactionsRouteErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

const EARN_TRANSACTIONS_TTL_MS = 5 * 60 * 1000;

type CacheKeyArgs = {
  settingsPda: string;
  solanaEnv: string;
  walletAddress: string;
};

let cache = new Map<
  string,
  { expiresAt: number; value: EarnTransactionsRouteResponse }
>();
let inflight = new Map<string, Promise<EarnTransactionsRouteResponse>>();
let cacheEpoch = 0;

function getEarnTransactionsCacheKey(args: CacheKeyArgs) {
  return `${args.solanaEnv}:${args.settingsPda}:${args.walletAddress}`;
}

export async function fetchEarnTransactions(
  args: CacheKeyArgs
): Promise<EarnTransactionsRouteResponse> {
  const key = getEarnTransactionsCacheKey(args);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }
  const requestCacheEpoch = cacheEpoch;

  const request: Promise<EarnTransactionsRouteResponse> = (async () => {
    const response = await fetch("/api/smart-accounts/earn-transactions", {
      credentials: "include",
    });

    if (!response.ok) {
      const errorPayload = (await response
        .json()
        .catch(() => null)) as EarnTransactionsRouteErrorResponse | null;
      console.warn("[earn-transactions] API error", {
        error: errorPayload?.error ?? null,
        status: response.status,
        statusText: response.statusText,
      });
      const message =
        errorPayload?.error?.message ?? "Failed to load earn transactions.";
      throw new Error(message);
    }

    const value = (await response.json()) as EarnTransactionsRouteResponse;
    if (requestCacheEpoch === cacheEpoch) {
      cache.set(key, {
        expiresAt: Date.now() + EARN_TRANSACTIONS_TTL_MS,
        value,
      });
    }
    return value;
  })().finally(() => {
    if (inflight.get(key) === request) {
      inflight.delete(key);
    }
  });

  inflight.set(key, request);
  return request;
}

export function invalidateEarnTransactionsCache(args?: Partial<CacheKeyArgs>) {
  cacheEpoch += 1;

  if (!args?.settingsPda && !args?.solanaEnv && !args?.walletAddress) {
    cache.clear();
    inflight.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (
      (!args.solanaEnv || key.startsWith(`${args.solanaEnv}:`)) &&
      (!args.settingsPda || key.includes(`:${args.settingsPda}:`)) &&
      (!args.walletAddress || key.endsWith(`:${args.walletAddress}`))
    ) {
      cache.delete(key);
    }
  }

  for (const key of inflight.keys()) {
    if (
      (!args.solanaEnv || key.startsWith(`${args.solanaEnv}:`)) &&
      (!args.settingsPda || key.includes(`:${args.settingsPda}:`)) &&
      (!args.walletAddress || key.endsWith(`:${args.walletAddress}`))
    ) {
      inflight.delete(key);
    }
  }
}

export function resetEarnTransactionsCacheForTests() {
  cache = new Map();
  inflight = new Map();
  cacheEpoch = 0;
}
