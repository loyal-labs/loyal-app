import { type SolanaEnv } from "@loyal-labs/solana-rpc";
import {
  Connection,
  type Commitment,
  type GetProgramAccountsFilter,
  PublicKey,
} from "@solana/web3.js";

import {
  DEFAULT_SUBSCRIPTION_DEBOUNCE_MS,
  NATIVE_SOL_DECIMALS,
  NATIVE_SOL_MINT,
} from "../constants";
import type {
  AssetBalance,
  AssetDescriptor,
  AssetProvider,
  AssetSnapshot,
  CreateSolanaWalletDataClientConfig,
} from "../types";

type HeliusAsset = {
  id: string;
  token_info?: {
    symbol?: string;
    balance: number;
    decimals: number;
    price_info?: {
      price_per_token?: number;
      total_price?: number;
    };
  };
  content?: {
    metadata?: {
      name?: string;
      symbol?: string;
    };
    links?: {
      image?: string;
    };
  };
};

type HeliusNativeBalance = {
  lamports: number;
  price_per_sol?: number;
  total_price?: number;
};

type HeliusResponse = {
  jsonrpc: "2.0";
  id: string;
  result: {
    items: HeliusAsset[];
    nativeBalance?: HeliusNativeBalance;
  };
};

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

const JUPITER_TOKEN_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";

type JupiterTokenSearchResult = {
  id: string;
  usdPrice?: number;
};

async function enrichAssetsWithJupiterPrices(
  fetchImpl: typeof fetch,
  assets: AssetBalance[]
): Promise<AssetBalance[]> {
  const unpricedMints = assets
    .filter((a) => a.priceUsd === null && a.asset.mint !== NATIVE_SOL_MINT)
    .map((a) => a.asset.mint);

  if (unpricedMints.length === 0) return assets;

  const uniqueMints = [...new Set(unpricedMints)];

  let prices: Map<string, number>;
  try {
    // Fetch prices in parallel using the token search endpoint (no auth required)
    const results = await Promise.all(
      uniqueMints.map(async (mint) => {
        const url = `${JUPITER_TOKEN_SEARCH_URL}?query=${mint}`;
        const tokens = await fetchJson<JupiterTokenSearchResult[]>(
          fetchImpl,
          url,
          { method: "GET" }
        );
        const match = tokens.find((t) => t.id === mint);
        return { mint, price: match?.usdPrice ?? null };
      })
    );
    prices = new Map<string, number>();
    for (const { mint, price } of results) {
      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        prices.set(mint, price);
      }
    }
  } catch {
    return assets;
  }

  return assets.map((a) => {
    if (a.priceUsd !== null) return a;
    const price = prices.get(a.asset.mint);
    if (!price) return a;
    return {
      ...a,
      priceUsd: price,
      valueUsd: a.balance * price,
    };
  });
}

function getSafeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveAssetDescriptor(asset: HeliusAsset): AssetDescriptor {
  const tokenSymbol = getSafeString(asset.token_info?.symbol);
  const metadataSymbol = getSafeString(asset.content?.metadata?.symbol);
  const symbol =
    tokenSymbol ||
    metadataSymbol ||
    (asset.id === NATIVE_SOL_MINT ? "SOL" : "TOKEN");

  return {
    mint: asset.id,
    symbol,
    name: getSafeString(asset.content?.metadata?.name) || symbol,
    decimals: asset.token_info?.decimals ?? NATIVE_SOL_DECIMALS,
    imageUrl: getSafeString(asset.content?.links?.image) || null,
    isNative: asset.id === NATIVE_SOL_MINT,
  };
}

function mapAssetBalance(asset: HeliusAsset): AssetBalance | null {
  const tokenInfo = asset.token_info;
  if (!tokenInfo) {
    return null;
  }

  return {
    asset: resolveAssetDescriptor(asset),
    balance: tokenInfo.balance / Math.pow(10, tokenInfo.decimals),
    priceUsd: tokenInfo.price_info?.price_per_token ?? null,
    valueUsd: tokenInfo.price_info?.total_price ?? null,
  };
}

function mapNativeAssetBalance(
  nativeBalance: HeliusNativeBalance | undefined
): AssetBalance | null {
  if (!nativeBalance) {
    return null;
  }

  return {
    asset: {
      mint: NATIVE_SOL_MINT,
      symbol: "SOL",
      name: "Solana",
      decimals: NATIVE_SOL_DECIMALS,
      imageUrl: null,
      isNative: true,
    },
    balance: nativeBalance.lamports / Math.pow(10, NATIVE_SOL_DECIMALS),
    priceUsd: nativeBalance.price_per_sol ?? null,
    valueUsd: nativeBalance.total_price ?? null,
  };
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<T> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export function createHeliusAssetProvider(args: {
  env: SolanaEnv;
  rpcEndpoint: string;
  websocketEndpoint: string;
  commitment: Commitment;
  fetchImpl: typeof fetch;
  config: Pick<
    CreateSolanaWalletDataClientConfig,
    "createRpcConnection" | "createWebsocketConnection"
  >;
}): AssetProvider {
  let rpcConnection: Connection | null = null;
  let websocketConnection: Connection | null = null;

  const getConnection = () => {
    if (rpcConnection) {
      return rpcConnection;
    }

    rpcConnection = args.config.createRpcConnection
      ? args.config.createRpcConnection(args.rpcEndpoint, args.commitment)
      : new Connection(args.rpcEndpoint, { commitment: args.commitment });

    return rpcConnection;
  };

  const getWebsocketConnection = () => {
    if (websocketConnection) {
      return websocketConnection;
    }

    websocketConnection = args.config.createWebsocketConnection
      ? args.config.createWebsocketConnection(
          args.rpcEndpoint,
          args.websocketEndpoint,
          args.commitment
        )
      : new Connection(args.rpcEndpoint, {
          commitment: args.commitment,
          wsEndpoint: args.websocketEndpoint,
        });

    return websocketConnection;
  };

  return {
    getBalance: async (owner) =>
      getConnection().getBalance(owner, args.commitment),
    getAssetSnapshot: async (owner): Promise<AssetSnapshot> => {
      if (args.env === "localnet") {
        const lamports = await getConnection().getBalance(
          owner,
          args.commitment
        );
        return {
          owner: owner.toBase58(),
          nativeBalanceLamports: lamports,
          assets: [
            {
              asset: {
                mint: NATIVE_SOL_MINT,
                symbol: "SOL",
                name: "Solana",
                decimals: NATIVE_SOL_DECIMALS,
                imageUrl: null,
                isNative: true,
              },
              balance: lamports / Math.pow(10, NATIVE_SOL_DECIMALS),
              priceUsd: null,
              valueUsd: null,
            },
          ],
          fetchedAt: Date.now(),
        };
      }

      const response = await fetchJson<HeliusResponse>(
        args.fetchImpl,
        args.rpcEndpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "wallet-portfolio",
            method: "getAssetsByOwner",
            params: {
              ownerAddress: owner.toBase58(),
              page: 1,
              limit: 1000,
              displayOptions: {
                showFungible: true,
                showNativeBalance: true,
              },
            },
          }),
        }
      );

      const assets: AssetBalance[] = [];
      const nativeAsset = mapNativeAssetBalance(response.result.nativeBalance);
      if (nativeAsset) {
        assets.push(nativeAsset);
      }

      for (const asset of response.result.items) {
        if (asset.id === NATIVE_SOL_MINT) {
          continue;
        }

        const mapped = mapAssetBalance(asset);
        if (mapped) {
          assets.push(mapped);
        }
      }

      const enrichedAssets = await enrichAssetsWithJupiterPrices(
        args.fetchImpl,
        assets
      );

      return {
        owner: owner.toBase58(),
        nativeBalanceLamports: response.result.nativeBalance?.lamports ?? 0,
        assets: enrichedAssets,
        fetchedAt: Date.now(),
      };
    },
    subscribeAssetChanges: async (owner, onChange, options = {}) => {
      const connection = getWebsocketConnection();
      const debounceMs = options.debounceMs ?? DEFAULT_SUBSCRIPTION_DEBOUNCE_MS;
      const includeNative = options.includeNative ?? true;
      const subCommitment = options.commitment ?? "confirmed";

      let closed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const emit = () => {
        if (closed) {
          return;
        }

        if (debounceMs <= 0) {
          onChange();
          return;
        }

        if (timer) {
          clearTimeout(timer);
        }

        timer = setTimeout(() => {
          timer = null;
          if (!closed) {
            onChange();
          }
        }, debounceMs);
      };

      const ownerFilter: GetProgramAccountsFilter = {
        memcmp: {
          offset: 32,
          bytes: owner.toBase58(),
        },
      };

      const tokenSubId = await connection.onProgramAccountChange(
        TOKEN_PROGRAM_ID,
        emit,
        subCommitment,
        [{ dataSize: 165 }, ownerFilter]
      );
      const token2022SubId = await connection.onProgramAccountChange(
        TOKEN_2022_PROGRAM_ID,
        emit,
        subCommitment,
        [ownerFilter]
      );
      const accountSubId = includeNative
        ? await connection.onAccountChange(owner, emit, subCommitment)
        : null;

      return async () => {
        closed = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        await Promise.allSettled([
          connection.removeProgramAccountChangeListener(tokenSubId),
          connection.removeProgramAccountChangeListener(token2022SubId),
          ...(accountSubId !== null
            ? [connection.removeAccountChangeListener(accountSubId)]
            : []),
        ]);
      };
    },
  };
}
