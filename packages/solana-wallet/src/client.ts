import { getSolanaEndpoints, type SolanaEnv } from "@loyal-labs/solana-rpc";
import { type Commitment, PublicKey } from "@solana/web3.js";

import {
  DEFAULT_ACTIVITY_CACHE_TTL_MS,
  DEFAULT_ACTIVITY_FALLBACK_REFRESH_MS,
  DEFAULT_PORTFOLIO_CACHE_TTL_MS,
  DEFAULT_PORTFOLIO_FALLBACK_REFRESH_MS,
} from "./constants";
import { buildPortfolioSnapshot } from "./domain/portfolio";
import { createHeliusAssetProvider } from "./providers/default-asset-provider";
import { createRpcActivityProvider } from "./providers/default-activity-provider";
import type {
  ActivityPage,
  AddressInput,
  AssetDescriptor,
  AssetProvider,
  AssetSnapshot,
  CreateSolanaWalletDataClientConfig,
  GetActivityOptions,
  GetPortfolioOptions,
  InvalidateCachesOptions,
  PortfolioSnapshot,
  SecureBalanceMap,
  SolanaWalletDataClient,
  SubscribeActivityOptions,
  SubscribePortfolioOptions,
  WalletActivity,
  WalletDataLogger,
} from "./types";

type CachedPortfolio = {
  snapshot: PortfolioSnapshot;
  fetchedAt: number;
};

type CachedActivity = {
  page: ActivityPage;
  fetchedAt: number;
};

const DEFAULT_COMMITMENT: Commitment = "confirmed";
const noopLogger: WalletDataLogger = {};

function createError(message: string, cause?: unknown): Error {
  const error = new Error(message);
  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return error;
}

function parsePublicKey(value: AddressInput): PublicKey {
  try {
    return typeof value === "string" ? new PublicKey(value) : value;
  } catch (error) {
    throw createError("Invalid public key input", error);
  }
}

function isCacheValid(fetchedAt: number, ttlMs: number): boolean {
  return Date.now() - fetchedAt < ttlMs;
}

function getActivityCacheKey(
  owner: string,
  options: GetActivityOptions
): string {
  return JSON.stringify({
    owner,
    limit: options.limit ?? 10,
    before: options.before ?? null,
    onlySystemTransfers: options.onlySystemTransfers ?? false,
  });
}

async function resolveShieldedOnlyAssets(args: {
  assetProvider: AssetProvider;
  assetSnapshot: AssetSnapshot;
  secureBalances: SecureBalanceMap;
  logger: WalletDataLogger;
}): Promise<{
  descriptors: Map<string, AssetDescriptor>;
  prices: Map<string, number | null>;
}> {
  const empty = {
    descriptors: new Map<string, AssetDescriptor>(),
    prices: new Map<string, number | null>(),
  };
  if (args.secureBalances.size === 0 || !args.assetProvider.resolveAssets) {
    return empty;
  }

  const knownMints = new Set(
    args.assetSnapshot.assets.map((asset) => asset.asset.mint)
  );
  const shieldedOnlyMints: string[] = [];
  for (const mint of args.secureBalances.keys()) {
    if (!knownMints.has(mint)) {
      shieldedOnlyMints.push(mint);
    }
  }

  if (shieldedOnlyMints.length === 0) {
    return empty;
  }

  try {
    const entries = await args.assetProvider.resolveAssets(shieldedOnlyMints);
    const descriptors = new Map<string, AssetDescriptor>();
    const prices = new Map<string, number | null>();
    for (const entry of entries) {
      descriptors.set(entry.descriptor.mint, entry.descriptor);
      prices.set(entry.descriptor.mint, entry.priceUsd);
    }
    return { descriptors, prices };
  } catch (error) {
    args.logger.warn?.(
      "Failed to resolve shielded-only asset descriptors",
      error
    );
    return empty;
  }
}

export function createSolanaWalletDataClient(
  config: CreateSolanaWalletDataClientConfig
): SolanaWalletDataClient {
  const env: SolanaEnv = config.env;
  const endpoints = getSolanaEndpoints(env);
  const rpcEndpoint = config.rpcEndpoint ?? endpoints.rpcEndpoint;
  const websocketEndpoint =
    config.websocketEndpoint ?? endpoints.websocketEndpoint;
  const commitment = config.commitment ?? DEFAULT_COMMITMENT;
  const logger = config.logger ?? noopLogger;
  const fetchImpl = config.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw createError("A fetch implementation is required");
  }

  const assetProvider =
    config.assetProvider ??
    createHeliusAssetProvider({
      env,
      rpcEndpoint,
      websocketEndpoint,
      commitment,
      fetchImpl,
      config,
    });

  const activityProvider =
    config.activityProvider ??
    createRpcActivityProvider({
      rpcEndpoint,
      websocketEndpoint,
      commitment,
      logger,
      config,
    });

  const portfolioCache = new Map<string, CachedPortfolio>();
  const inflightPortfolioRequests = new Map<
    string,
    Promise<PortfolioSnapshot>
  >();
  const portfolioRequestGenerations = new Map<string, number>();
  const activityCache = new Map<string, CachedActivity>();
  const inflightActivityRequests = new Map<string, Promise<ActivityPage>>();

  const getBalance = async (publicKey: AddressInput): Promise<number> => {
    return assetProvider.getBalance(parsePublicKey(publicKey));
  };

  const getPortfolio = async (
    publicKey: AddressInput,
    options: GetPortfolioOptions = {}
  ): Promise<PortfolioSnapshot> => {
    const owner = parsePublicKey(publicKey);
    const ownerKey = owner.toBase58();
    const cached = portfolioCache.get(ownerKey);
    const forceRefresh = options.forceRefresh ?? false;

    if (
      !forceRefresh &&
      cached &&
      isCacheValid(cached.fetchedAt, DEFAULT_PORTFOLIO_CACHE_TTL_MS)
    ) {
      if (options.fallbackSolPriceUsd == null) {
        return cached.snapshot;
      }

      return {
        ...cached.snapshot,
        totals: buildPortfolioSnapshot({
          assetSnapshot: {
            owner: cached.snapshot.owner,
            nativeBalanceLamports: cached.snapshot.nativeBalanceLamports,
            assets: cached.snapshot.positions.map((position) => ({
              asset: position.asset,
              balance: position.publicBalance,
              priceUsd: position.priceUsd,
              valueUsd: position.publicValueUsd,
            })),
            fetchedAt: cached.snapshot.fetchedAt,
          },
          secureBalances: new Map(
            cached.snapshot.positions
              .filter((position) => position.securedBalance > 0)
              .map((position) => [
                position.asset.mint,
                BigInt(
                  Math.round(
                    position.securedBalance *
                      Math.pow(10, position.asset.decimals)
                  )
                ),
              ])
          ),
          fallbackSolPriceUsd: options.fallbackSolPriceUsd,
        }).totals,
      };
    }

    const inflight = inflightPortfolioRequests.get(ownerKey);
    if (inflight && !forceRefresh) {
      return inflight;
    }

    const requestGeneration =
      (portfolioRequestGenerations.get(ownerKey) ?? 0) + 1;
    portfolioRequestGenerations.set(ownerKey, requestGeneration);
    const loader = (async () => {
      const assetSnapshot = await assetProvider.getAssetSnapshot(owner);
      const secureBalances: SecureBalanceMap = config.secureBalanceProvider
        ? await config
            .secureBalanceProvider({
              owner,
              env,
              tokenMints: assetSnapshot.assets.map(
                (assetBalance) => new PublicKey(assetBalance.asset.mint)
              ),
              assetBalances: assetSnapshot.assets,
            })
            .catch((error) => {
              logger.warn?.("Failed to fetch secure balances", error);
              return new Map<string, bigint>();
            })
        : new Map<string, bigint>();

      const shieldedOnly = await resolveShieldedOnlyAssets({
        assetProvider,
        assetSnapshot,
        secureBalances,
        logger,
      });

      const snapshot = buildPortfolioSnapshot({
        assetSnapshot,
        secureBalances,
        shieldedOnlyDescriptors: shieldedOnly.descriptors,
        shieldedOnlyPrices: shieldedOnly.prices,
        fallbackSolPriceUsd: options.fallbackSolPriceUsd,
      });

      if (portfolioRequestGenerations.get(ownerKey) === requestGeneration) {
        portfolioCache.set(ownerKey, {
          snapshot,
          fetchedAt: Date.now(),
        });
      }

      return snapshot;
    })();

    inflightPortfolioRequests.set(ownerKey, loader);

    try {
      return await loader;
    } finally {
      if (inflightPortfolioRequests.get(ownerKey) === loader) {
        inflightPortfolioRequests.delete(ownerKey);
      }
    }
  };

  const subscribePortfolio = async (
    publicKey: AddressInput,
    onPortfolio: (snapshot: PortfolioSnapshot) => void,
    options: SubscribePortfolioOptions = {}
  ): Promise<() => Promise<void>> => {
    const owner = parsePublicKey(publicKey);
    const ownerKey = owner.toBase58();
    const emitInitial = options.emitInitial ?? true;
    const fallbackRefreshMs =
      options.fallbackRefreshMs ?? DEFAULT_PORTFOLIO_FALLBACK_REFRESH_MS;

    let closed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let isRefreshing = false;
    let needsRefresh = false;
    let pendingForceRefresh = false;

    const runRefresh = async () => {
      if (closed || isRefreshing || !needsRefresh) {
        return;
      }

      const forceRefresh = pendingForceRefresh;
      needsRefresh = false;
      pendingForceRefresh = false;
      isRefreshing = true;

      try {
        const portfolioPromise = getPortfolio(owner, {
          forceRefresh,
          fallbackSolPriceUsd: options.fallbackSolPriceUsd,
        });
        const requestGeneration =
          portfolioRequestGenerations.get(ownerKey) ?? 0;
        const snapshot = await portfolioPromise;
        if (
          !closed &&
          portfolioRequestGenerations.get(ownerKey) === requestGeneration
        ) {
          onPortfolio(snapshot);
        }
      } catch (error) {
        options.onError?.(error);
      } finally {
        isRefreshing = false;
        if (!closed && needsRefresh) {
          void runRefresh();
        }
      }
    };

    const requestRefresh = (forceRefresh: boolean) => {
      if (closed) {
        return;
      }

      needsRefresh = true;
      pendingForceRefresh = pendingForceRefresh || forceRefresh;

      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }

      const debounceMs = options.debounceMs ?? 0;
      if (debounceMs <= 0) {
        void runRefresh();
        return;
      }

      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void runRefresh();
      }, debounceMs);
    };

    let unsubscribe: () => Promise<void> = async () => {};
    try {
      unsubscribe = await assetProvider.subscribeAssetChanges(
        owner,
        () => requestRefresh(true),
        {
          commitment: options.commitment,
          debounceMs: 0,
          includeNative: true,
        }
      );
    } catch (error) {
      options.onError?.(error);
    }

    const fallbackInterval =
      fallbackRefreshMs > 0
        ? setInterval(() => {
            requestRefresh(true);
          }, fallbackRefreshMs)
        : null;

    if (emitInitial) {
      requestRefresh(false);
    }

    return async () => {
      closed = true;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
      await unsubscribe();
    };
  };

  const getActivity = async (
    publicKey: AddressInput,
    options: GetActivityOptions = {}
  ): Promise<ActivityPage> => {
    const owner = parsePublicKey(publicKey);
    const cacheKey = getActivityCacheKey(owner.toBase58(), options);
    const cached = activityCache.get(cacheKey);
    const forceRefresh = options.forceRefresh ?? false;

    if (
      !forceRefresh &&
      !options.before &&
      cached &&
      isCacheValid(cached.fetchedAt, DEFAULT_ACTIVITY_CACHE_TTL_MS)
    ) {
      return cached.page;
    }

    const inflight = inflightActivityRequests.get(cacheKey);
    if (inflight && !forceRefresh) {
      return inflight;
    }

    const loader = activityProvider.getActivity(owner, options).then((page) => {
      if (!options.before) {
        activityCache.set(cacheKey, {
          page,
          fetchedAt: Date.now(),
        });
      }
      return page;
    });

    inflightActivityRequests.set(cacheKey, loader);

    try {
      return await loader;
    } finally {
      if (inflightActivityRequests.get(cacheKey) === loader) {
        inflightActivityRequests.delete(cacheKey);
      }
    }
  };

  const subscribeActivity = async (
    publicKey: AddressInput,
    onActivity: (activity: WalletActivity) => void,
    options: SubscribeActivityOptions = {}
  ): Promise<() => Promise<void>> => {
    const owner = parsePublicKey(publicKey);
    const emitInitial = options.emitInitial ?? false;
    const historyLimit = options.historyLimit ?? 25;
    const fallbackRefreshMs =
      options.fallbackRefreshMs ?? DEFAULT_ACTIVITY_FALLBACK_REFRESH_MS;
    const seenSignatures = new Set<string>();
    let closed = false;

    const emitIfNew = (activity: WalletActivity) => {
      if (seenSignatures.has(activity.signature)) {
        return;
      }

      seenSignatures.add(activity.signature);
      if (seenSignatures.size > 200) {
        const [first] = seenSignatures;
        seenSignatures.delete(first);
      }

      onActivity(activity);
    };

    const refreshLatest = async () => {
      try {
        const latest = await getActivity(owner, {
          limit: historyLimit,
          onlySystemTransfers: options.onlySystemTransfers,
        });

        for (const activity of [...latest.activities].reverse()) {
          if (!closed) {
            emitIfNew(activity);
          }
        }
      } catch (error) {
        options.onError?.(error);
      }
    };

    if (emitInitial) {
      await refreshLatest();
    }

    let unsubscribe: () => Promise<void> = async () => {};
    try {
      unsubscribe = await activityProvider.subscribeActivity(
        owner,
        (activity) => {
          if (!closed) {
            emitIfNew(activity);
          }
        },
        options
      );
    } catch (error) {
      options.onError?.(error);
    }

    const fallbackInterval =
      fallbackRefreshMs > 0
        ? setInterval(() => {
            if (!closed) {
              void refreshLatest();
            }
          }, fallbackRefreshMs)
        : null;

    return async () => {
      closed = true;
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
      await unsubscribe();
    };
  };

  const invalidateCaches = (options: InvalidateCachesOptions = {}): void => {
    if (options.portfolio) {
      for (const address of options.portfolio) {
        const ownerKey = parsePublicKey(address).toBase58();
        portfolioCache.delete(ownerKey);
        portfolioRequestGenerations.set(
          ownerKey,
          (portfolioRequestGenerations.get(ownerKey) ?? 0) + 1
        );
      }
    }

    if (options.activity) {
      const ownerKeys = new Set(
        options.activity.map((address) => parsePublicKey(address).toBase58())
      );
      for (const cacheKey of activityCache.keys()) {
        try {
          const parsed = JSON.parse(cacheKey) as { owner?: string };
          if (parsed.owner && ownerKeys.has(parsed.owner)) {
            activityCache.delete(cacheKey);
          }
        } catch {
          // Ignore unparseable keys; they aren't owned by this code path.
        }
      }
    }
  };

  return {
    env,
    rpcEndpoint,
    websocketEndpoint,
    getBalance,
    getPortfolio,
    subscribePortfolio,
    getActivity,
    subscribeActivity,
    invalidateCaches,
  };
}
