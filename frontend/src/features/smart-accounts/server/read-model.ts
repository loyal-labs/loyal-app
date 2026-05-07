import "server-only";

import { pda } from "@loyal-labs/loyal-smart-accounts";
import {
  createSmartAccountVaultsClient,
  type SmartAccountOverview,
} from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import {
  createSolanaWalletDataClient,
  type ActivityPage,
} from "@loyal-labs/solana-wallet";
import { Connection, PublicKey } from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";
import { createFrontendAssetProvider } from "@/lib/solana/frontend-asset-provider";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";

const connectionCache = new Map<SolanaEnv, Connection>();
const walletDataClientCache = new Map<
  SolanaEnv,
  ReturnType<typeof createSolanaWalletDataClient>
>();
const walletDataClientWithActivityCache = new Map<
  SolanaEnv,
  ReturnType<typeof createSolanaWalletDataClient>
>();
const OVERVIEW_MISSING_SETTINGS_RETRY_DELAYS_MS = [250, 750, 1500, 2500];
const OVERVIEW_RATE_LIMIT_COOLDOWN_MS = 15_000;
const overviewLoadPromisesByKey = new Map<
  string,
  Promise<SmartAccountOverview>
>();
const overviewRateLimitCooldownUntilByKey = new Map<string, number>();

export class SmartAccountOverviewRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(args: { retryAfterSeconds: number }) {
    super("Smart-account overview is temporarily rate limited by the RPC provider.");
    this.name = "SmartAccountOverviewRateLimitError";
    this.retryAfterSeconds = args.retryAfterSeconds;
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingSettingsAccountError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Unable to find Settings account at")
  );
}

export function isSmartAccountOverviewRateLimitError(
  error: unknown
): error is SmartAccountOverviewRateLimitError {
  return error instanceof SmartAccountOverviewRateLimitError;
}

function isRpcRateLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("429 Too Many Requests") ||
      error.message.includes("max usage reached"))
  );
}

function createRateLimitError(cacheKey: string, now = Date.now()) {
  const cooldownUntil =
    overviewRateLimitCooldownUntilByKey.get(cacheKey) ??
    now + OVERVIEW_RATE_LIMIT_COOLDOWN_MS;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((cooldownUntil - now) / 1000)
  );

  return new SmartAccountOverviewRateLimitError({ retryAfterSeconds });
}

function getConnection(solanaEnv: SolanaEnv) {
  const cachedConnection = connectionCache.get(solanaEnv);
  if (cachedConnection) {
    return cachedConnection;
  }

  const { rpcEndpoint, websocketEndpoint } =
    getFrontendSolanaEndpoints(solanaEnv);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });

  connectionCache.set(solanaEnv, connection);
  return connection;
}

function getWalletDataClient(solanaEnv: SolanaEnv) {
  const cachedClient = walletDataClientCache.get(solanaEnv);
  if (cachedClient) {
    return cachedClient;
  }

  const { rpcEndpoint, websocketEndpoint } =
    getFrontendSolanaEndpoints(solanaEnv);
  const client = createSolanaWalletDataClient({
    assetProvider: createFrontendAssetProvider({
      commitment: "confirmed",
      fetchImpl: globalThis.fetch,
      rpcEndpoint,
      websocketEndpoint,
    }),
    activityProvider: {
      getActivity: async () => ({ activities: [] }),
      subscribeActivity: async () => async () => undefined,
    },
    env: solanaEnv,
    createRpcConnection: (endpoint, commitment) =>
      new Connection(endpoint, {
        commitment,
        disableRetryOnRateLimit: true,
        fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
      }),
    createWebsocketConnection: (endpoint, websocketEndpoint, commitment) =>
      new Connection(endpoint, {
        commitment,
        disableRetryOnRateLimit: true,
        fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
        wsEndpoint: websocketEndpoint,
      }),
    rpcEndpoint,
    websocketEndpoint,
  });

  walletDataClientCache.set(solanaEnv, client);
  return client;
}

function getWalletDataClientWithActivity(solanaEnv: SolanaEnv) {
  const cachedClient = walletDataClientWithActivityCache.get(solanaEnv);
  if (cachedClient) {
    return cachedClient;
  }

  const { rpcEndpoint, websocketEndpoint } =
    getFrontendSolanaEndpoints(solanaEnv);
  const client = createSolanaWalletDataClient({
    assetProvider: createFrontendAssetProvider({
      commitment: "confirmed",
      fetchImpl: globalThis.fetch,
      rpcEndpoint,
      websocketEndpoint,
    }),
    env: solanaEnv,
    createRpcConnection: (endpoint, commitment) =>
      new Connection(endpoint, {
        commitment,
        disableRetryOnRateLimit: true,
        fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
      }),
    createWebsocketConnection: (endpoint, websocketEndpoint, commitment) =>
      new Connection(endpoint, {
        commitment,
        disableRetryOnRateLimit: true,
        fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
        wsEndpoint: websocketEndpoint,
      }),
    rpcEndpoint,
    websocketEndpoint,
  });

  walletDataClientWithActivityCache.set(solanaEnv, client);
  return client;
}

export async function fetchCurrentSmartAccountOverview(args: {
  settingsPda: string;
  invalidateAddresses?: string[];
}): Promise<SmartAccountOverview> {
  const serverEnv = getServerEnv();
  const settingsPda = new PublicKey(args.settingsPda);
  const cacheKey = `${serverEnv.solanaEnv}:${settingsPda.toBase58()}`;
  const cooldownUntil = overviewRateLimitCooldownUntilByKey.get(cacheKey);
  const now = Date.now();

  if (cooldownUntil && cooldownUntil > now) {
    throw createRateLimitError(cacheKey, now);
  }

  const walletDataClient = getWalletDataClient(serverEnv.solanaEnv);
  if (args.invalidateAddresses && args.invalidateAddresses.length > 0) {
    walletDataClient.invalidateCaches({
      portfolio: args.invalidateAddresses,
    });
  }

  const existingLoad =
    args.invalidateAddresses && args.invalidateAddresses.length > 0
      ? null
      : overviewLoadPromisesByKey.get(cacheKey);
  if (existingLoad) {
    return existingLoad;
  }

  const client = createSmartAccountVaultsClient({
    connection: getConnection(serverEnv.solanaEnv),
    walletDataClient,
    programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
  });

  const loadPromise = (async () => {
    let lastError: unknown;

    for (
      let attempt = 0;
      attempt <= OVERVIEW_MISSING_SETTINGS_RETRY_DELAYS_MS.length;
      attempt += 1
    ) {
      try {
        const overview = await client.fetchOverview({
          activityLimit: 0,
          settingsPda,
        });
        overviewRateLimitCooldownUntilByKey.delete(cacheKey);
        return overview;
      } catch (error) {
        if (isRpcRateLimitError(error)) {
          overviewRateLimitCooldownUntilByKey.set(
            cacheKey,
            Date.now() + OVERVIEW_RATE_LIMIT_COOLDOWN_MS
          );
          throw createRateLimitError(cacheKey);
        }

        if (
          !isMissingSettingsAccountError(error) ||
          attempt === OVERVIEW_MISSING_SETTINGS_RETRY_DELAYS_MS.length
        ) {
          throw error;
        }

        lastError = error;
        await wait(OVERVIEW_MISSING_SETTINGS_RETRY_DELAYS_MS[attempt]!);
      }
    }

    throw lastError;
  })();

  overviewLoadPromisesByKey.set(cacheKey, loadPromise);

  try {
    return await loadPromise;
  } finally {
    if (overviewLoadPromisesByKey.get(cacheKey) === loadPromise) {
      overviewLoadPromisesByKey.delete(cacheKey);
    }
  }
}

export async function fetchCurrentSmartAccountVaultActivity(args: {
  accountIndex: number;
  activityLimit?: number;
  settingsPda: string;
  forceRefresh?: boolean;
}): Promise<ActivityPage> {
  const serverEnv = getServerEnv();
  const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
  const settingsPda = new PublicKey(args.settingsPda);
  const cacheKey = `${serverEnv.solanaEnv}:${settingsPda.toBase58()}:vault-activity:${args.accountIndex}`;
  const cooldownUntil = overviewRateLimitCooldownUntilByKey.get(cacheKey);
  const now = Date.now();
  if (cooldownUntil && cooldownUntil > now) {
    throw createRateLimitError(cacheKey, now);
  }

  try {
    const vaultAddress = pda.getSmartAccountPda({
      accountIndex: args.accountIndex,
      programId,
      settingsPda,
    })[0];
    const activity = await getWalletDataClientWithActivity(
      serverEnv.solanaEnv
    ).getActivity(vaultAddress, {
      limit: args.activityLimit ?? 10,
      forceRefresh: args.forceRefresh ?? false,
    });
    overviewRateLimitCooldownUntilByKey.delete(cacheKey);
    return activity;
  } catch (error) {
    if (isRpcRateLimitError(error)) {
      overviewRateLimitCooldownUntilByKey.set(
        cacheKey,
        Date.now() + OVERVIEW_RATE_LIMIT_COOLDOWN_MS
      );
      throw createRateLimitError(cacheKey);
    }

    throw error;
  }
}
