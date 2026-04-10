import { PublicKey } from "@solana/web3.js";

import { NATIVE_SOL_DECIMALS, NATIVE_SOL_MINT } from "../constants";
import { getSolanaEnv } from "../rpc/connection";
import {
  SECURE_DEVNET_RPC_URL,
  SECURE_MAINNET_RPC_URL,
  TESTNET_RPC_URL,
} from "../rpc/constants";
import { CACHE_TTL_MS } from "./constants";
import { fetchSecuredBalances } from "./fetch-secured-balances";
import { resolveTokenIcon } from "./resolve-token-info";
import type {
  CachedHoldings,
  HeliusAsset,
  HeliusNativeBalance,
  HeliusResponse,
  TokenHolding,
} from "./types";

const holdingsCache = new Map<string, CachedHoldings>();
const inflightRequests = new Map<string, Promise<TokenHolding[]>>();

export function clearHoldingsCache(): void {
  holdingsCache.clear();
  inflightRequests.clear();
}
const JUPITER_TOKEN_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";

type JupiterTokenSearchResult = {
  id: string;
  usdPrice?: number;
};

function isPositiveFiniteNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  );
}

function normalizeUsdValue(value: unknown): number | null {
  return isPositiveFiniteNumber(value) ? value : null;
}

function resolveHoldingUsdValue(
  balance: number,
  rawValueUsd: unknown,
  priceUsd: number | null,
): number | null {
  if (isPositiveFiniteNumber(rawValueUsd)) return rawValueUsd;
  if (isPositiveFiniteNumber(priceUsd)) return balance * priceUsd;
  return null;
}

function normalizeHoldingsWithImpliedPrices(
  holdings: TokenHolding[],
): TokenHolding[] {
  const impliedPriceByMint = new Map<string, number>();

  for (const holding of holdings) {
    const normalizedPriceUsd = normalizeUsdValue(holding.priceUsd);
    if (normalizedPriceUsd !== null) {
      impliedPriceByMint.set(holding.mint, normalizedPriceUsd);
      continue;
    }

    const normalizedValueUsd = normalizeUsdValue(holding.valueUsd);
    if (normalizedValueUsd !== null && holding.balance > 0) {
      impliedPriceByMint.set(holding.mint, normalizedValueUsd / holding.balance);
    }
  }

  if (impliedPriceByMint.size === 0) {
    return holdings;
  }

  return holdings.map((holding) => {
    const normalizedPriceUsd =
      normalizeUsdValue(holding.priceUsd) ??
      impliedPriceByMint.get(holding.mint) ??
      null;

    return {
      ...holding,
      priceUsd: normalizedPriceUsd,
      valueUsd: resolveHoldingUsdValue(
        holding.balance,
        holding.valueUsd,
        normalizedPriceUsd,
      ),
    };
  });
}

function isCacheValid(cached: CachedHoldings | undefined): boolean {
  if (!cached) return false;
  return Date.now() - cached.fetchedAt < CACHE_TTL_MS;
}

function getRpcUrl(): string | null {
  const env = getSolanaEnv();
  if (env === "mainnet") return SECURE_MAINNET_RPC_URL;
  if (env === "testnet") return TESTNET_RPC_URL;
  if (env === "devnet") return SECURE_DEVNET_RPC_URL;
  return null;
}

function getSafeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveSymbol(asset: HeliusAsset): string {
  const tokenSymbol = getSafeString(asset.token_info?.symbol);
  if (tokenSymbol.length > 0) return tokenSymbol;
  const metadataSymbol = getSafeString(asset.content?.metadata?.symbol);
  if (metadataSymbol.length > 0) return metadataSymbol;
  if (asset.id === NATIVE_SOL_MINT) return "SOL";
  return "TOKEN";
}

function resolveName(asset: HeliusAsset, symbol: string): string {
  const metadataName = getSafeString(asset.content?.metadata?.name);
  if (metadataName.length > 0) return metadataName;
  return symbol;
}

function resolveImageUrl(asset: HeliusAsset): string | null {
  const imageUrl = getSafeString(asset.content?.links?.image);
  return imageUrl.length > 0 ? imageUrl : null;
}

function mapAssetToHolding(asset: HeliusAsset): TokenHolding | null {
  const tokenInfo = asset.token_info;
  if (!tokenInfo) return null;

  const { balance, decimals, price_info } = tokenInfo;
  const normalizedBalance = balance / Math.pow(10, decimals);
  const priceUsd = normalizeUsdValue(price_info?.price_per_token);
  const symbol = resolveSymbol(asset);
  const name = resolveName(asset, symbol);

  return {
    mint: asset.id,
    symbol,
    name,
    balance: normalizedBalance,
    decimals,
    priceUsd,
    valueUsd: resolveHoldingUsdValue(
      normalizedBalance,
      price_info?.total_price,
      priceUsd,
    ),
    imageUrl: resolveImageUrl(asset),
  };
}

function mapNativeBalance(
  nativeBalance: HeliusNativeBalance | undefined,
): TokenHolding | null {
  if (!nativeBalance) return null;

  const { lamports, price_per_sol, total_price } = nativeBalance;
  const normalizedBalance = lamports / Math.pow(10, NATIVE_SOL_DECIMALS);
  const priceUsd = normalizeUsdValue(price_per_sol);

  return {
    mint: NATIVE_SOL_MINT,
    symbol: "SOL",
    name: "Solana",
    balance: normalizedBalance,
    decimals: NATIVE_SOL_DECIMALS,
    priceUsd,
    valueUsd: resolveHoldingUsdValue(normalizedBalance, total_price, priceUsd),
    imageUrl: resolveTokenIcon({ mint: NATIVE_SOL_MINT, imageUrl: null }),
  };
}

export async function enrichHoldingsWithJupiterPrices(
  holdings: TokenHolding[],
  fetchImpl: typeof fetch = fetch,
): Promise<TokenHolding[]> {
  if (holdings.length === 0) return holdings;

  const normalizedHoldings = holdings.map((holding) => {
    const normalizedPriceUsd = normalizeUsdValue(holding.priceUsd);
    return {
      ...holding,
      priceUsd: normalizedPriceUsd,
      valueUsd: resolveHoldingUsdValue(
        holding.balance,
        holding.valueUsd,
        normalizedPriceUsd,
      ),
    };
  });

  const unpricedMints = [
    ...new Set(
      normalizedHoldings
        .filter((holding) => holding.priceUsd === null)
        .map((holding) => holding.mint),
    ),
  ];

  if (unpricedMints.length === 0) return normalizedHoldings;

  const lookups = await Promise.all(
    unpricedMints.map(async (mint) => {
      try {
        const response = await fetchImpl(
          `${JUPITER_TOKEN_SEARCH_URL}?query=${encodeURIComponent(mint)}`,
          { method: "GET" },
        );
        if (!response.ok) return null;
        const tokens =
          (await response.json()) as JupiterTokenSearchResult[];
        const match = tokens.find((token) => token.id === mint);
        const usdPrice = normalizeUsdValue(match?.usdPrice);
        return usdPrice ? { mint, usdPrice } : null;
      } catch {
        return null;
      }
    }),
  );

  const jupiterPrices = new Map<string, number>();
  for (const lookup of lookups) {
    if (lookup) jupiterPrices.set(lookup.mint, lookup.usdPrice);
  }

  if (jupiterPrices.size === 0) return normalizedHoldings;

  return normalizedHoldings.map((holding) => {
    if (holding.priceUsd !== null) return holding;
    const usdPrice = jupiterPrices.get(holding.mint);
    if (!usdPrice) return holding;
    return {
      ...holding,
      priceUsd: usdPrice,
      valueUsd: holding.balance * usdPrice,
    };
  });
}

async function fetchHoldingsFromHelius(
  rpcUrl: string,
  publicKey: string,
): Promise<TokenHolding[]> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "token-holdings",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: publicKey,
        page: 1,
        limit: 1000,
        displayOptions: {
          showFungible: true,
          showNativeBalance: true,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Helius RPC error: ${response.status}`);
  }

  const data = (await response.json()) as HeliusResponse;
  const holdings: TokenHolding[] = [];

  const nativeSol = mapNativeBalance(data.result.nativeBalance);
  if (nativeSol) {
    holdings.push(nativeSol);
  }

  for (const asset of data.result.items) {
    if (asset.id === NATIVE_SOL_MINT) continue;
    const holding = mapAssetToHolding(asset);
    if (holding) {
      holdings.push(holding);
    }
  }

  return holdings;
}

export async function fetchTokenHoldings(
  publicKey: string,
  forceRefresh = false,
): Promise<TokenHolding[]> {
  try {
    new PublicKey(publicKey);
  } catch {
    throw new Error("Invalid public key");
  }

  const cached = holdingsCache.get(publicKey);
  if (!forceRefresh && isCacheValid(cached)) {
    return cached!.holdings;
  }

  const inflight = inflightRequests.get(publicKey);
  if (inflight && !forceRefresh) {
    return inflight;
  }

  const rpcUrl = getRpcUrl();
  if (!rpcUrl) {
    holdingsCache.set(publicKey, { holdings: [], fetchedAt: Date.now() });
    return [];
  }

  const loader = fetchHoldingsFromHelius(rpcUrl, publicKey).then(
    async (holdings) => {
      let allHoldings = holdings;
      try {
        const securedHoldings = await fetchSecuredBalances(
          publicKey,
          holdings,
        );
        allHoldings = [...holdings, ...securedHoldings];
      } catch (error) {
        console.warn("Failed to fetch secured balances, using public only", error);
      }

      let enrichedHoldings = allHoldings;
      try {
        enrichedHoldings = await enrichHoldingsWithJupiterPrices(allHoldings);
      } catch (error) {
        console.warn("Failed to enrich holdings with Jupiter prices", error);
      }
      const normalizedHoldings = normalizeHoldingsWithImpliedPrices(
        enrichedHoldings,
      );

      holdingsCache.set(publicKey, {
        holdings: normalizedHoldings,
        fetchedAt: Date.now(),
      });
      return normalizedHoldings;
    },
  );

  inflightRequests.set(publicKey, loader);

  try {
    return await loader;
  } finally {
    if (inflightRequests.get(publicKey) === loader) {
      inflightRequests.delete(publicKey);
    }
  }
}
