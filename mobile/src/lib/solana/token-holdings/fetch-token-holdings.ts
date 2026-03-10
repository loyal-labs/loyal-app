import { PublicKey } from "@solana/web3.js";

import { NATIVE_SOL_DECIMALS, NATIVE_SOL_MINT } from "../constants";
import { getSolanaEnv } from "../rpc/connection";
import {
  SECURE_DEVNET_RPC_URL,
  SECURE_MAINNET_RPC_URL,
  TESTNET_RPC_URL,
} from "../rpc/constants";
import { CACHE_TTL_MS } from "./constants";
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
  const symbol = resolveSymbol(asset);
  const name = resolveName(asset, symbol);

  return {
    mint: asset.id,
    symbol,
    name,
    balance: balance / Math.pow(10, decimals),
    decimals,
    priceUsd: price_info?.price_per_token ?? null,
    valueUsd: price_info?.total_price ?? null,
    imageUrl: resolveImageUrl(asset),
  };
}

function mapNativeBalance(
  nativeBalance: HeliusNativeBalance | undefined,
): TokenHolding | null {
  if (!nativeBalance) return null;

  const { lamports, price_per_sol, total_price } = nativeBalance;

  return {
    mint: NATIVE_SOL_MINT,
    symbol: "SOL",
    name: "Solana",
    balance: lamports / Math.pow(10, NATIVE_SOL_DECIMALS),
    decimals: NATIVE_SOL_DECIMALS,
    priceUsd: price_per_sol ?? null,
    valueUsd: total_price ?? null,
    imageUrl: resolveTokenIcon({ mint: NATIVE_SOL_MINT, imageUrl: null }),
  };
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

  const loader = fetchHoldingsFromHelius(rpcUrl, publicKey).then((holdings) => {
    holdingsCache.set(publicKey, { holdings, fetchedAt: Date.now() });
    return holdings;
  });

  inflightRequests.set(publicKey, loader);

  try {
    return await loader;
  } finally {
    if (inflightRequests.get(publicKey) === loader) {
      inflightRequests.delete(publicKey);
    }
  }
}
