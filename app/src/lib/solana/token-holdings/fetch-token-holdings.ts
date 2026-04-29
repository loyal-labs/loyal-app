import { getSolanaEndpoints } from "@loyal-labs/solana-rpc";
import { PublicKey } from "@solana/web3.js";

import { NATIVE_SOL_DECIMALS, NATIVE_SOL_MINT } from "@/lib/constants";
import { fetchTokenPricesByMints } from "@/lib/jupiter/price";

import { fetchJson } from "../../core/http";
import { getPrivateClient } from "../deposits/private-client";
import { getSolanaEnv } from "../rpc/connection";
import { CACHE_TTL_MS } from "./constants";
import { resolveTokenIcon } from "./resolve-token-info";
import type {
  CachedHoldings,
  HeliusAsset,
  HeliusNativeBalance,
  HeliusResponse,
  TokenHolding,
} from "./types";

type HeliusSingleAssetResponse = {
  jsonrpc: "2.0";
  result: HeliusAsset | null;
  id: string;
};

const holdingsCache = new Map<string, CachedHoldings>();
const inflightRequests = new Map<string, Promise<TokenHolding[]>>();

function isCacheValid(cached: CachedHoldings | undefined): boolean {
  if (!cached) return false;
  return Date.now() - cached.fetchedAt < CACHE_TTL_MS;
}

function getRpcUrl(): string | null {
  const env = getSolanaEnv();
  if (env === "localnet") return null;
  return getSolanaEndpoints(env).rpcEndpoint;
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
  nativeBalance: HeliusNativeBalance | undefined
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
  publicKey: string
): Promise<TokenHolding[]> {
  const response = await fetchJson<HeliusResponse>(rpcUrl, {
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

  const holdings: TokenHolding[] = [];

  const nativeSol = mapNativeBalance(response.result.nativeBalance);
  if (nativeSol) {
    holdings.push(nativeSol);
  }

  for (const asset of response.result.items) {
    // Skip wSOL — native SOL is already included via nativeBalance
    if (asset.id === NATIVE_SOL_MINT) continue;
    const holding = mapAssetToHolding(asset);
    if (holding) {
      holdings.push(holding);
    }
  }

  return holdings;
}

/**
 * Fetch metadata for a single mint via Helius DAS `getAsset`.
 *
 * Used to resolve shielded-only token holdings — i.e. tokens the user has
 * deposited into the Loyal secure vault but no longer holds on the base
 * chain. Since `getAssetsByOwner` omits zero-balance token accounts, a
 * shielded-max deposit would otherwise render without any metadata.
 */
async function fetchAssetByMint(
  rpcUrl: string,
  mint: string
): Promise<HeliusAsset | null> {
  try {
    const response = await fetchJson<HeliusSingleAssetResponse>(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "shielded-asset",
        method: "getAsset",
        params: { id: mint },
      }),
    });
    return response.result ?? null;
  } catch (error) {
    console.warn(
      `[token-holdings] getAsset failed for mint ${mint}`,
      error
    );
    return null;
  }
}

/**
 * Build a zero-balance TokenHolding from mint metadata, intended as the
 * "base row" template used to derive a shielded holding when the user has
 * no base-chain balance for the mint. The caller overwrites `balance` and
 * `valueUsd` with shielded values.
 */
function buildHoldingTemplateFromAsset(asset: HeliusAsset): TokenHolding | null {
  const tokenInfo = asset.token_info;
  if (!tokenInfo) return null;

  const { decimals, price_info } = tokenInfo;
  const symbol = resolveSymbol(asset);
  const name = resolveName(asset, symbol);

  return {
    mint: asset.id,
    symbol,
    name,
    balance: 0,
    decimals,
    priceUsd: price_info?.price_per_token ?? null,
    valueUsd: null,
    imageUrl: resolveImageUrl(asset),
  };
}

/**
 * Last-resort template when metadata can't be resolved. Preserves the mint
 * so the row still renders (icon fallback + truncated mint as symbol).
 */
function buildUnknownHoldingTemplate(
  mint: string,
  decimals: number
): TokenHolding {
  const short =
    mint.length > 10 ? `${mint.slice(0, 4)}...${mint.slice(-4)}` : mint;
  return {
    mint,
    symbol: short,
    name: short,
    balance: 0,
    decimals,
    priceUsd: null,
    valueUsd: null,
    imageUrl: null,
  };
}

async function enrichHoldingsWithJupiterPrices(
  holdings: TokenHolding[],
): Promise<TokenHolding[]> {
  const unpricedMints = holdings
    .filter((h) => h.priceUsd === null && h.mint !== NATIVE_SOL_MINT)
    .map((h) => h.mint);

  if (unpricedMints.length === 0) return holdings;

  const uniqueMints = [...new Set(unpricedMints)];

  let prices: Map<string, number>;
  try {
    prices = await fetchTokenPricesByMints(uniqueMints);
  } catch {
    return holdings;
  }

  return holdings.map((h) => {
    if (h.priceUsd !== null) return h;
    const price = prices.get(h.mint);
    if (!price) return h;
    return {
      ...h,
      priceUsd: price,
      valueUsd: h.balance * price,
    };
  });
}

/**
 * Fetch holdings from Helius (base-chain balances) and from the Loyal secure
 * vault (shielded deposits via MagicBlock PER), then merge them into a single
 * TokenHolding list.
 *
 * Shielded deposits are enumerated directly from the Loyal program (both the
 * base and ephemeral chains) rather than derived from Helius, so a mint only
 * held inside the secure vault — e.g. after shielding the user's full USDC
 * balance — still renders a row.
 */
async function fetchCombinedHoldings(
  rpcUrl: string,
  publicKey: string
): Promise<TokenHolding[]> {
  const userPubkey = new PublicKey(publicKey);

  const [holdingsFromHelius, privateClient] = await Promise.all([
    fetchHoldingsFromHelius(rpcUrl, publicKey),
    getPrivateClient(),
  ]);

  let userDeposits: Awaited<
    ReturnType<typeof privateClient.getAllDepositsByUser>
  > = [];
  try {
    userDeposits = await privateClient.getAllDepositsByUser(userPubkey);
  } catch (error) {
    console.warn(
      "[token-holdings] getAllDepositsByUser failed; shielded rows will be hidden",
      error
    );
  }

  const nonZeroDeposits = userDeposits.filter((d) => d.amount > BigInt(0));

  // Resolve metadata for any shielded mint we can't match against a
  // base-chain row. Each unresolved mint costs one DAS getAsset request; in
  // practice a user has only a handful of shielded tokens.
  const heliusByMint = new Map<string, TokenHolding>();
  for (const holding of holdingsFromHelius) {
    heliusByMint.set(holding.mint, holding);
  }

  const unresolvedMints = nonZeroDeposits
    .map((d) => d.tokenMint.toBase58())
    .filter((mint) => !heliusByMint.has(mint));
  const uniqueUnresolvedMints = [...new Set(unresolvedMints)];

  const resolvedAssets = await Promise.all(
    uniqueUnresolvedMints.map(async (mint) => {
      const asset = await fetchAssetByMint(rpcUrl, mint);
      return [mint, asset] as const;
    })
  );
  const assetByMint = new Map(resolvedAssets);

  const securedHoldings: TokenHolding[] = [];
  for (const deposit of nonZeroDeposits) {
    const mintStr = deposit.tokenMint.toBase58();
    const rawAmount = Number(deposit.amount);

    let template = heliusByMint.get(mintStr) ?? null;
    if (!template) {
      const asset = assetByMint.get(mintStr) ?? null;
      if (asset) {
        template = buildHoldingTemplateFromAsset(asset);
      }
    }

    if (!template) {
      // Fall back to a placeholder — we still want the row visible so the
      // user can see their shielded balance and unshield it. Decimals default
      // to 0 so the raw on-chain amount is displayed verbatim; that is ugly
      // but correct and only hit when every metadata source failed.
      template = buildUnknownHoldingTemplate(mintStr, 0);
    }

    const securedBalance = rawAmount / Math.pow(10, template.decimals);
    securedHoldings.push({
      ...template,
      balance: securedBalance,
      valueUsd:
        template.priceUsd !== null ? securedBalance * template.priceUsd : null,
      isSecured: true,
    });
  }

  const allHoldings = [...holdingsFromHelius, ...securedHoldings];
  return enrichHoldingsWithJupiterPrices(allHoldings);
}

export async function fetchTokenHoldings(
  publicKey: string,
  forceRefresh = false
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
  if (inflight) {
    if (!forceRefresh) {
      return inflight;
    }

    // If a force refresh arrives while another request is in flight, wait for
    // it to settle and then issue a fresh request.
    try {
      await inflight;
    } catch {
      // Ignore previous request failure; a fresh forced request is next.
    }

    const nextInflight = inflightRequests.get(publicKey);
    if (nextInflight) {
      return nextInflight;
    }
  }

  const rpcUrl = getRpcUrl();
  if (!rpcUrl) {
    holdingsCache.set(publicKey, { holdings: [], fetchedAt: Date.now() });
    return [];
  }

  const loader = fetchCombinedHoldings(rpcUrl, publicKey).then((holdings) => {
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
