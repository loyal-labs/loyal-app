import {
  computePortfolioTotals,
  flattenPortfolioPositions,
  type PortfolioPosition,
  type PortfolioSnapshot,
} from "@loyal-labs/solana-wallet";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadKaminoUsdcTrackedPosition,
  resolveKaminoCumulativeEarnedLiquidityAmountRaw,
  resolveKaminoPrincipalLiquidityAmountRaw,
  resolveKaminoTotalEarnedLiquidityAmountRaw,
  resolveTrackedKaminoUsdcMint,
} from "@/lib/solana/deposits/kamino-usdc-position";
import { fetchLoyalDeposits } from "@/lib/solana/deposits/loyal-deposits";
import { getPrivateClient } from "@/lib/solana/deposits/private-client";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import type { TokenHolding } from "@/lib/solana/token-holdings";

import { getTelegramWalletDataClient } from "../solana-wallet-data-client";
import { HOLDINGS_REFRESH_DEBOUNCE_MS } from "../wallet-cache";
import { MOCK_TOKEN_HOLDINGS, USE_MOCK_DATA } from "../wallet-mock-data";

const KAMINO_USDC_IMAGE_URL = "/tokens/usd-coin-usdc-logo.png";
const KAMINO_USDC_NAME = "USDC";
const KAMINO_USDC_SYMBOL = "USDC";
const KAMINO_USDC_DECIMALS = 6;
const KAMINO_USDC_PRICE_USD = 1;

function flattenSnapshotTokenHoldings(
  snapshot: PortfolioSnapshot
): TokenHolding[] {
  return flattenPortfolioPositions(snapshot.positions, {
    splitSecuredBalances: true,
  });
}

async function enrichHoldingsWithKaminoUsdcEarnings(
  snapshot: PortfolioSnapshot,
  walletAddress: string,
  holdings: TokenHolding[]
): Promise<{
  snapshot: PortfolioSnapshot;
  holdings: TokenHolding[];
}> {
  const solanaEnv = getSolanaEnv();
  const trackedKaminoMint = resolveTrackedKaminoUsdcMint(solanaEnv);
  if (!trackedKaminoMint) {
    return {
      snapshot,
      holdings,
    };
  }

  const securedHoldingIndex = holdings.findIndex(
    (holding) => holding.isSecured && holding.mint === trackedKaminoMint
  );
  const securedHolding =
    securedHoldingIndex >= 0 ? holdings[securedHoldingIndex] : null;
  const walletPublicKey = new PublicKey(walletAddress);
  const trackedKaminoMintPublicKey = new PublicKey(trackedKaminoMint);

  const [trackedPosition, secureDeposits, privateClient] = await Promise.all([
    loadKaminoUsdcTrackedPosition({
      publicKey: walletAddress,
      solanaEnv,
    }),
    fetchLoyalDeposits(walletPublicKey, [trackedKaminoMintPublicKey]),
    getPrivateClient({ solanaEnv }),
  ]);

  const actualCollateralSharesAmountRaw = BigInt(
    Math.round(secureDeposits.get(trackedKaminoMintPublicKey) ?? 0)
  );
  const cumulativeEarnedLiquidityAmountRaw =
    resolveKaminoCumulativeEarnedLiquidityAmountRaw(trackedPosition);
  if (actualCollateralSharesAmountRaw <= BigInt(0)) {
    if (cumulativeEarnedLiquidityAmountRaw <= BigInt(0)) {
      return {
        snapshot,
        holdings,
      };
    }

    const publicHoldingIndex = holdings.findIndex(
      (holding) => !holding.isSecured && holding.mint === trackedKaminoMint
    );
    if (publicHoldingIndex < 0) {
      return {
        snapshot,
        holdings,
      };
    }

    const publicHolding = holdings[publicHoldingIndex];
    const scale = Math.pow(10, publicHolding.decimals ?? KAMINO_USDC_DECIMALS);
    const totalEarnedBalance =
      Number(cumulativeEarnedLiquidityAmountRaw) / scale;
    const nextHoldings = [...holdings];
    nextHoldings[publicHoldingIndex] = {
      ...publicHolding,
      earnedBalance: totalEarnedBalance,
      earnedValueUsd:
        totalEarnedBalance * (publicHolding.priceUsd ?? KAMINO_USDC_PRICE_USD),
    };

    return {
      snapshot,
      holdings: nextHoldings,
    };
  }

  const liquidityQuote = await privateClient.getKaminoShieldedBalanceQuote({
    tokenMint: trackedKaminoMintPublicKey,
    collateralSharesAmountRaw: actualCollateralSharesAmountRaw,
  });
  if (!liquidityQuote) {
    return {
      snapshot,
      holdings,
    };
  }

  const currentLiquidityAmountRaw = liquidityQuote.redeemableLiquidityAmountRaw;
  const principalLiquidityAmountRaw = resolveKaminoPrincipalLiquidityAmountRaw({
    trackedPosition,
    actualCollateralSharesAmountRaw,
    currentLiquidityAmountRaw,
  });
  const earnedLiquidityAmountRaw =
    principalLiquidityAmountRaw === null
      ? null
      : currentLiquidityAmountRaw > principalLiquidityAmountRaw
        ? currentLiquidityAmountRaw - principalLiquidityAmountRaw
        : BigInt(0);
  const totalEarnedLiquidityAmountRaw = resolveKaminoTotalEarnedLiquidityAmountRaw({
    trackedPosition,
    unrealizedEarnedLiquidityAmountRaw: earnedLiquidityAmountRaw,
  });

  const existingPosition = snapshot.positions.find(
    (position) => position.asset.mint === trackedKaminoMint
  );
  const holdingDecimals =
    securedHolding?.decimals ??
    existingPosition?.asset.decimals ??
    KAMINO_USDC_DECIMALS;
  const scale = Math.pow(10, holdingDecimals);
  const principalBalance =
    principalLiquidityAmountRaw === null
      ? null
      : Number(principalLiquidityAmountRaw) / scale;
  const earnedBalance =
    totalEarnedLiquidityAmountRaw === null
      ? null
      : Number(totalEarnedLiquidityAmountRaw) / scale;
  const earnedValueUsd =
    earnedBalance === null
      ? null
      : earnedBalance * KAMINO_USDC_PRICE_USD;

  const nextHolding: TokenHolding = {
    mint: trackedKaminoMint,
    symbol: KAMINO_USDC_SYMBOL,
    name: KAMINO_USDC_NAME,
    balance: Number(currentLiquidityAmountRaw) / scale,
    decimals: holdingDecimals,
    priceUsd: KAMINO_USDC_PRICE_USD,
    valueUsd: Number(currentLiquidityAmountRaw) / scale,
    imageUrl: KAMINO_USDC_IMAGE_URL,
    isSecured: true,
    principalBalance,
    earnedBalance,
    earnedValueUsd,
  };
  const publicBalance = existingPosition?.publicBalance ?? 0;
  const publicValueUsd = existingPosition?.publicValueUsd ?? 0;
  const priceUsd =
    securedHolding?.priceUsd ??
    existingPosition?.priceUsd ??
    KAMINO_USDC_PRICE_USD;
  const securedValueUsd =
    securedHolding?.priceUsd === null
      ? nextHolding.valueUsd
      : nextHolding.balance * priceUsd;

  const nextPosition: PortfolioPosition = {
    asset: {
      mint: trackedKaminoMint,
      symbol:
        securedHolding?.symbol ??
        existingPosition?.asset.symbol ??
        KAMINO_USDC_SYMBOL,
      name:
        securedHolding?.name ?? existingPosition?.asset.name ?? KAMINO_USDC_NAME,
      decimals: holdingDecimals,
      imageUrl:
        securedHolding?.imageUrl ??
        existingPosition?.asset.imageUrl ??
        KAMINO_USDC_IMAGE_URL,
      isNative: existingPosition?.asset.isNative ?? false,
    },
    publicBalance,
    securedBalance: nextHolding.balance,
    totalBalance: publicBalance + nextHolding.balance,
    priceUsd,
    publicValueUsd,
    securedValueUsd,
    totalValueUsd: publicValueUsd + (securedValueUsd ?? 0),
  };

  const existingPositionIndex = snapshot.positions.findIndex(
    (position) => position.asset.mint === trackedKaminoMint
  );
  const nextPositions =
    existingPositionIndex >= 0
      ? snapshot.positions.map((position, index) =>
          index === existingPositionIndex ? nextPosition : position
        )
        : [...snapshot.positions, nextPosition];

  nextPositions.sort((left, right) => {
    const valueDelta = (right.totalValueUsd ?? -1) - (left.totalValueUsd ?? -1);
    if (valueDelta !== 0) {
      return valueDelta;
    }

    const symbolCompare = left.asset.symbol.localeCompare(right.asset.symbol);
    if (symbolCompare !== 0) {
      return symbolCompare;
    }

    return left.asset.mint.localeCompare(right.asset.mint);
  });

  const nextSnapshot: PortfolioSnapshot = {
    ...snapshot,
    positions: nextPositions,
    totals: computePortfolioTotals(
      nextPositions,
      snapshot.totals.effectiveSolPriceUsd
    ),
  };
  const nextHoldings = flattenSnapshotTokenHoldings(nextSnapshot).map(
    (holding) => {
      if (!holding.isSecured || holding.mint !== trackedKaminoMint) {
        return holding;
      }

      const holdingPriceUsd = holding.priceUsd ?? KAMINO_USDC_PRICE_USD;

      return {
        ...holding,
        imageUrl: holding.imageUrl ?? KAMINO_USDC_IMAGE_URL,
        name: holding.name || KAMINO_USDC_NAME,
        symbol: holding.symbol || KAMINO_USDC_SYMBOL,
        principalBalance,
        earnedBalance,
        earnedValueUsd:
          earnedBalance === null ? null : holdingPriceUsd * earnedBalance,
      };
    }
  );

  return {
    snapshot: nextSnapshot,
    holdings: nextHoldings,
  };
}

async function resolveTokenHoldingsSnapshot(
  snapshot: PortfolioSnapshot,
  walletAddress: string
): Promise<{
  snapshot: PortfolioSnapshot;
  holdings: TokenHolding[];
}> {
  const rawHoldings = flattenSnapshotTokenHoldings(snapshot);

  try {
    return await enrichHoldingsWithKaminoUsdcEarnings(
      snapshot,
      walletAddress,
      rawHoldings
    );
  } catch (error) {
    console.error(
      "Failed to enrich token holdings with Kamino earnings; falling back to raw portfolio",
      error
    );

    return {
      snapshot,
      holdings: rawHoldings,
    };
  }
}

export function useTokenHoldings(walletAddress: string | null): {
  portfolioSnapshot: PortfolioSnapshot | null;
  tokenHoldings: TokenHolding[];
  isHoldingsLoading: boolean;
  refreshTokenHoldings: (forceRefresh?: boolean) => Promise<void>;
} {
  const [portfolioSnapshot, setPortfolioSnapshot] =
    useState<PortfolioSnapshot | null>(null);
  const [tokenHoldings, setTokenHoldings] = useState<TokenHolding[]>(() =>
    USE_MOCK_DATA ? MOCK_TOKEN_HOLDINGS : []
  );
  const [isHoldingsLoading, setIsHoldingsLoading] = useState(() =>
    USE_MOCK_DATA ? false : true
  );

  const hasLoadedHoldingsRef = useRef(USE_MOCK_DATA);
  const walletAddressRef = useRef<string | null>(walletAddress);
  const holdingsFetchIdRef = useRef(0);

  useEffect(() => {
    walletAddressRef.current = walletAddress;
  }, [walletAddress]);

  const refreshTokenHoldings = useCallback(async (forceRefresh = false) => {
    const addr = walletAddressRef.current;
    if (!addr) return;

    const fetchId = ++holdingsFetchIdRef.current;

    if (!hasLoadedHoldingsRef.current) {
      setIsHoldingsLoading(true);
    }

    try {
      const snapshot = await getTelegramWalletDataClient().getPortfolio(addr, {
        forceRefresh,
      });
      if (walletAddressRef.current !== addr) return;
      if (holdingsFetchIdRef.current !== fetchId) return;

      const enriched = await resolveTokenHoldingsSnapshot(snapshot, addr);
      if (walletAddressRef.current !== addr) return;
      if (holdingsFetchIdRef.current !== fetchId) return;

      setPortfolioSnapshot(enriched.snapshot);
      setTokenHoldings(enriched.holdings);
      hasLoadedHoldingsRef.current = true;
    } catch (error) {
      console.error("Failed to fetch token holdings:", error);
    } finally {
      if (walletAddressRef.current !== addr) return;
      if (holdingsFetchIdRef.current !== fetchId) return;
      if (!hasLoadedHoldingsRef.current) {
        // If we never loaded successfully, keep showing skeleton.
        setIsHoldingsLoading(true);
      } else {
        setIsHoldingsLoading(false);
      }
    }
  }, []);

  // Fetch token holdings
  useEffect(() => {
    if (USE_MOCK_DATA) return;
    if (!walletAddress) return;

    hasLoadedHoldingsRef.current = false;
    setIsHoldingsLoading(true);
    setPortfolioSnapshot(null);
    setTokenHoldings([]);

    void refreshTokenHoldings(false);
  }, [refreshTokenHoldings, walletAddress]);

  // Keep holdings in sync with wallet asset websocket updates.
  useEffect(() => {
    if (USE_MOCK_DATA) return;
    if (!walletAddress) return;

    let isCancelled = false;
    let unsubscribe: (() => Promise<void>) | null = null;

    void (async () => {
      try {
        unsubscribe =
          await getTelegramWalletDataClient().subscribePortfolio(
            walletAddress,
            (snapshot) => {
              if (isCancelled) return;
              holdingsFetchIdRef.current += 1;
              const nextFetchId = holdingsFetchIdRef.current;
              void resolveTokenHoldingsSnapshot(snapshot, walletAddress)
                .then((enriched) => {
                  if (isCancelled) return;
                  if (holdingsFetchIdRef.current !== nextFetchId) return;
                  setPortfolioSnapshot(enriched.snapshot);
                  setTokenHoldings(enriched.holdings);
                  hasLoadedHoldingsRef.current = true;
                  setIsHoldingsLoading(false);
                })
                .catch((error) => {
                  console.error(
                    "Failed to enrich token holdings with Kamino earnings",
                    error
                  );
                });
            },
            {
              debounceMs: HOLDINGS_REFRESH_DEBOUNCE_MS,
              commitment: "confirmed",
              emitInitial: false,
              onError: (error) => {
                console.error(
                  "Failed to refresh token holdings from websocket",
                  error
                );
              },
            }
          );
      } catch (error) {
        console.error("Failed to subscribe to token holdings", error);
      }
    })();

    return () => {
      isCancelled = true;
      if (unsubscribe) {
        void unsubscribe();
      }
    };
  }, [walletAddress]);

  return {
    portfolioSnapshot,
    tokenHoldings,
    isHoldingsLoading,
    refreshTokenHoldings,
  };
}
