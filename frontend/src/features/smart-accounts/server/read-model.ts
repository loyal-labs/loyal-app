import "server-only";

import { pda } from "@loyal-labs/loyal-smart-accounts";
import {
  createSmartAccountVaultsClient,
  type SmartAccountOverview,
  type SmartAccountOverviewBase,
  type SmartAccountPolicyOverview,
  type SmartAccountProposalSnapshot,
  type SmartAccountVaultSnapshot,
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
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";

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
const OVERVIEW_COMPLETED_RESULT_TTL_MS = 2_000;
const OVERVIEW_COMPLETED_RESULT_MAX_ENTRIES = 256;
const overviewLoadPromisesByKey = new Map<string, Promise<unknown>>();
const overviewRateLimitCooldownUntilByKey = new Map<string, number>();
const overviewCompletedResultsByKey = new Map<
  string,
  { expiresAt: number; result: unknown }
>();

export class SmartAccountOverviewRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(args: { retryAfterSeconds: number }) {
    super(
      "Smart-account overview is temporarily rate limited by the RPC provider."
    );
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

function setCompletedOverviewResult(cacheKey: string, result: unknown) {
  const now = Date.now();

  for (const [entryKey, entry] of overviewCompletedResultsByKey) {
    if (entry.expiresAt <= now) {
      overviewCompletedResultsByKey.delete(entryKey);
    }
  }

  while (
    overviewCompletedResultsByKey.size >= OVERVIEW_COMPLETED_RESULT_MAX_ENTRIES
  ) {
    const oldestKey = overviewCompletedResultsByKey.keys().next().value;
    if (!oldestKey) {
      break;
    }
    overviewCompletedResultsByKey.delete(oldestKey);
  }

  overviewCompletedResultsByKey.set(cacheKey, {
    expiresAt: now + OVERVIEW_COMPLETED_RESULT_TTL_MS,
    result,
  });
}

function getConnection(solanaEnv: SolanaEnv) {
  const cachedConnection = connectionCache.get(solanaEnv);
  if (cachedConnection) {
    return cachedConnection;
  }

  const { rpcEndpoint, websocketEndpoint } =
    getServerSolanaEndpoints(solanaEnv);
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
    getServerSolanaEndpoints(solanaEnv);
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
    getServerSolanaEndpoints(solanaEnv);
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

function createSmartAccountVaultsReadClient(solanaEnv: SolanaEnv) {
  const serverEnv = getServerEnv();

  return createSmartAccountVaultsClient({
    connection: getConnection(solanaEnv),
    walletDataClient: getWalletDataClient(solanaEnv),
    programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
  });
}

export function clearSmartAccountReadModelCachesForTest() {
  overviewLoadPromisesByKey.clear();
  overviewRateLimitCooldownUntilByKey.clear();
  overviewCompletedResultsByKey.clear();
}

export async function loadSmartAccountReadModel<T>(args: {
  cacheKey: string;
  load: () => Promise<T>;
  retryMissingSettings?: boolean;
  bypassCache?: boolean;
}): Promise<T> {
  const startedAt = performance.now();
  const cooldownUntil = overviewRateLimitCooldownUntilByKey.get(args.cacheKey);
  const now = Date.now();

  if (cooldownUntil && cooldownUntil > now) {
    console.info("[smart-account-read-model] cooldown-hit", {
      cacheKey: args.cacheKey,
      retryAfterMs: cooldownUntil - now,
    });
    throw createRateLimitError(args.cacheKey, now);
  }

  const existingLoad = args.bypassCache
    ? null
    : overviewLoadPromisesByKey.get(args.cacheKey);
  const cachedResult = args.bypassCache
    ? null
    : overviewCompletedResultsByKey.get(args.cacheKey);
  if (cachedResult) {
    if (cachedResult.expiresAt > now) {
      console.info("[smart-account-read-model] completed-cache-hit", {
        cacheKey: args.cacheKey,
        ttlMs: cachedResult.expiresAt - now,
      });
      return cachedResult.result as T;
    }

    overviewCompletedResultsByKey.delete(args.cacheKey);
  }

  if (existingLoad) {
    console.info("[smart-account-read-model] in-flight-cache-hit", {
      cacheKey: args.cacheKey,
    });
    return existingLoad as Promise<T>;
  }

  const loadPromise = (async () => {
    let lastError: unknown;
    const maxAttempt = args.retryMissingSettings
      ? OVERVIEW_MISSING_SETTINGS_RETRY_DELAYS_MS.length
      : 0;

    for (let attempt = 0; attempt <= maxAttempt; attempt += 1) {
      try {
        const result = await args.load();
        overviewRateLimitCooldownUntilByKey.delete(args.cacheKey);
        setCompletedOverviewResult(args.cacheKey, result);
        return result;
      } catch (error) {
        if (isRpcRateLimitError(error)) {
          overviewRateLimitCooldownUntilByKey.set(
            args.cacheKey,
            Date.now() + OVERVIEW_RATE_LIMIT_COOLDOWN_MS
          );
          console.info("[smart-account-read-model] load.rate-limited", {
            cacheKey: args.cacheKey,
            durationMs: Number((performance.now() - startedAt).toFixed(2)),
          });
          throw createRateLimitError(args.cacheKey);
        }

        if (
          !args.retryMissingSettings ||
          !isMissingSettingsAccountError(error) ||
          attempt === maxAttempt
        ) {
          console.info("[smart-account-read-model] load.failed", {
            cacheKey: args.cacheKey,
            durationMs: Number((performance.now() - startedAt).toFixed(2)),
            attempt,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
          throw error;
        }

        lastError = error;
        console.info("[smart-account-read-model] load.retry-missing-settings", {
          cacheKey: args.cacheKey,
          attempt,
          delayMs: OVERVIEW_MISSING_SETTINGS_RETRY_DELAYS_MS[attempt]!,
        });
        await wait(OVERVIEW_MISSING_SETTINGS_RETRY_DELAYS_MS[attempt]!);
      }
    }

    throw lastError;
  })();

  overviewLoadPromisesByKey.set(args.cacheKey, loadPromise);

  try {
    return await loadPromise;
  } finally {
    if (overviewLoadPromisesByKey.get(args.cacheKey) === loadPromise) {
      overviewLoadPromisesByKey.delete(args.cacheKey);
    }
  }
}

export async function fetchCurrentSmartAccountOverviewBase(args: {
  settingsPda: string;
}): Promise<SmartAccountOverviewBase> {
  const serverEnv = getServerEnv();
  const settingsPda = new PublicKey(args.settingsPda);
  const cacheKey = `${serverEnv.solanaEnv}:${settingsPda.toBase58()}:base`;
  const client = createSmartAccountVaultsReadClient(serverEnv.solanaEnv);

  return loadSmartAccountReadModel({
    cacheKey,
    retryMissingSettings: true,
    load: () => client.fetchOverviewBase({ settingsPda }),
  });
}

export async function fetchCurrentSmartAccountVaultSnapshots(args: {
  settingsPda: string;
  accountUtilization?: number;
  invalidateAddresses?: string[];
}): Promise<SmartAccountVaultSnapshot[]> {
  const serverEnv = getServerEnv();
  const settingsPda = new PublicKey(args.settingsPda);
  const invalidateAddresses = args.invalidateAddresses?.filter(
    (address) => address.length > 0
  );
  const cacheKey = `${serverEnv.solanaEnv}:${settingsPda.toBase58()}:vaults`;
  const walletDataClient = getWalletDataClient(serverEnv.solanaEnv);

  if (invalidateAddresses && invalidateAddresses.length > 0) {
    walletDataClient.invalidateCaches({
      portfolio: invalidateAddresses,
    });
  }

  const client = createSmartAccountVaultsClient({
    connection: getConnection(serverEnv.solanaEnv),
    walletDataClient,
    programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
  });

  return loadSmartAccountReadModel({
    cacheKey,
    bypassCache: Boolean(invalidateAddresses?.length),
    retryMissingSettings: true,
    load: () =>
      client.fetchVaultSnapshots({
        activityLimit: 0,
        accountUtilization: args.accountUtilization,
        settingsPda,
      }),
  });
}

export async function fetchCurrentSmartAccountPolicyOverview(args: {
  settingsPda: string;
}): Promise<SmartAccountPolicyOverview> {
  const serverEnv = getServerEnv();
  const settingsPda = new PublicKey(args.settingsPda);
  const cacheKey = `${serverEnv.solanaEnv}:${settingsPda.toBase58()}:policies`;
  const client = createSmartAccountVaultsReadClient(serverEnv.solanaEnv);

  return loadSmartAccountReadModel({
    cacheKey,
    retryMissingSettings: true,
    load: () => client.fetchPolicyOverview({ settingsPda }),
  });
}

export async function fetchCurrentSmartAccountProposalSnapshots(args: {
  settingsPda: string;
}): Promise<SmartAccountProposalSnapshot[]> {
  const serverEnv = getServerEnv();
  const settingsPda = new PublicKey(args.settingsPda);
  const cacheKey = `${serverEnv.solanaEnv}:${settingsPda.toBase58()}:proposals`;
  const client = createSmartAccountVaultsReadClient(serverEnv.solanaEnv);

  return loadSmartAccountReadModel({
    cacheKey,
    retryMissingSettings: true,
    load: () =>
      client.fetchProposalSnapshots({
        settingsPda,
        rootOnly: true,
      }),
  });
}

export async function fetchCurrentSmartAccountOverview(args: {
  settingsPda: string;
  invalidateAddresses?: string[];
}): Promise<SmartAccountOverview> {
  const serverEnv = getServerEnv();
  const settingsPda = new PublicKey(args.settingsPda);
  const cacheKey = `${serverEnv.solanaEnv}:${settingsPda.toBase58()}:overview`;

  const walletDataClient = getWalletDataClient(serverEnv.solanaEnv);
  if (args.invalidateAddresses && args.invalidateAddresses.length > 0) {
    walletDataClient.invalidateCaches({
      portfolio: args.invalidateAddresses,
    });
  }

  const client = createSmartAccountVaultsClient({
    connection: getConnection(serverEnv.solanaEnv),
    walletDataClient,
    programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
  });

  return loadSmartAccountReadModel({
    cacheKey,
    bypassCache: Boolean(args.invalidateAddresses?.length),
    retryMissingSettings: true,
    load: () =>
      client.fetchOverview({
        activityLimit: 0,
        settingsPda,
      }),
  });
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
  const cacheKey = `${
    serverEnv.solanaEnv
  }:${settingsPda.toBase58()}:vault-activity:${args.accountIndex}`;
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
