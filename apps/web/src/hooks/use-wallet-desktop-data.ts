"use client";

import {
  type PortfolioPosition,
  type PortfolioSnapshot,
  type WalletActivity,
} from "@loyal-labs/solana-wallet";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActivityRow,
  TokenRow,
  TransactionDetail,
} from "@/components/wallet-sidebar/types";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import {
  readClientCache,
  writeClientCache,
} from "@/lib/client-cache/client-cache";
import {
  fetchTokenMarketPriceUsd,
  readCachedTokenMarketPriceUsd,
} from "@/lib/market/token-market.client";
import { fetchTokenMarkets } from "@/lib/market/token-markets.client";
import { getTokenIconUrl } from "@/lib/token-icon";
import {
  getStablecoinMintSetForSolanaEnv,
  isStablecoinMint,
} from "@/lib/wallet/stablecoin-classification";

import { useSolanaWalletDataClient } from "./use-solana-wallet-data-client";

export type BalanceHistoryPoint = {
  timestamp: number;
  valueUsd: number;
};

export type WalletPortfolioChange24h = {
  /** Net 24h change as a percentage of the prior portfolio value (e.g. -1.23). */
  percent: number;
  /** Net 24h USD change (current value minus value 24 hours ago). */
  usdAmount: number;
};

export type WalletDesktopData = {
  walletAddress: string | null;
  isConnected: boolean;
  isLoading: boolean;
  totalUsd: number;
  balanceWhole: string;
  balanceFraction: string;
  balanceSolLabel: string;
  walletLabel: string;
  tokenRows: TokenRow[];
  allTokenRows: TokenRow[];
  cashTokenRows: TokenRow[];
  investmentTokenRows: TokenRow[];
  activityRows: ActivityRow[];
  allActivityRows: ActivityRow[];
  // Raw activities backing the rows — swap entries keep both token legs,
  // which the mapped ActivityRow shape drops.
  walletActivities: WalletActivity[];
  transactionDetails: Record<string, TransactionDetail>;
  positions: PortfolioPosition[];
  balanceHistory: BalanceHistoryPoint[];
  portfolioChange24h: WalletPortfolioChange24h | null;
  loadActivity: () => Promise<void>;
  refresh: (isCurrent?: () => boolean) => Promise<void>;
};

type UseWalletDesktopDataOptions = {
  enabled?: boolean;
};

const EMPTY_POSITIONS: PortfolioPosition[] = [];
const WALLET_ACTIVITY_INITIAL_LIMIT = 10;
const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";

const LOYL_ICON_URL =
  "https://avatars.githubusercontent.com/u/210601628?s=200&v=4";

type TokenMarketPosition = {
  asset: {
    mint: string;
  };
  totalValueUsd?: number | null;
};

export function createTokenMarketMintsSignature(
  positions: TokenMarketPosition[]
): string {
  const mints = positions
    .filter(
      (position) =>
        typeof position.totalValueUsd === "number" && position.totalValueUsd > 0
    )
    .map((position) => position.asset.mint);
  mints.push(LOYL_MINT);
  return Array.from(new Set(mints)).sort().join(",");
}

function resolveTokenIcon(position: PortfolioPosition): string {
  if (position.asset.imageUrl) {
    return position.asset.imageUrl;
  }
  if (position.asset.mint === LOYL_MINT) {
    return LOYL_ICON_URL;
  }
  return getTokenIconUrl(position.asset.symbol);
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "$0.00";
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function splitUsdBalance(value: number | null | undefined): {
  balanceFraction: string;
  balanceWhole: string;
} {
  const [whole, fraction] = formatUsd(value).split(".");

  return {
    balanceWhole: whole ?? "$0",
    balanceFraction: fraction ? `.${fraction}` : ".00",
  };
}

function formatTokenBalance(balance: number): string {
  return balance.toLocaleString("en-US", {
    minimumFractionDigits: balance >= 1 ? 0 : 2,
    maximumFractionDigits: balance >= 1 ? 4 : 6,
  });
}

function formatSolAmount(lamports: number): string {
  return (lamports / 1_000_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function formatTimestamp(timestamp: number | null): {
  date: string;
  time: string;
} {
  const date = timestamp ? new Date(timestamp) : new Date();
  return {
    date: date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    }),
    time: date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
  };
}

function resolvePositionByMint(
  positions: PortfolioPosition[],
  mint: string | undefined
): PortfolioPosition | undefined {
  if (!mint) {
    return undefined;
  }

  return positions.find((position) => position.asset.mint === mint);
}

function getActivityDisplay(
  activity: WalletActivity,
  positions: PortfolioPosition[],
  solPriceUsd: number | null
): {
  symbol: string;
  icon: string;
  amount: string;
  usdValue: number | null;
  counterparty: string;
} {
  switch (activity.type) {
    case "swap": {
      const fromPosition = resolvePositionByMint(
        positions,
        activity.fromToken.mint
      );
      return {
        symbol: fromPosition?.asset.symbol ?? "SOL",
        icon: fromPosition
          ? resolveTokenIcon(fromPosition)
          : getTokenIconUrl("SOL"),
        amount:
          activity.fromToken.amount ?? formatSolAmount(activity.amountLamports),
        usdValue:
          typeof fromPosition?.priceUsd === "number"
            ? parseFloat(activity.fromToken.amount) * fromPosition.priceUsd
            : null,
        counterparty: "Swap",
      };
    }
    case "token_transfer": {
      const position = resolvePositionByMint(positions, activity.token.mint);
      return {
        symbol: position?.asset.symbol ?? "TOKEN",
        icon: position
          ? resolveTokenIcon(position)
          : "/hero-new/Wallet-Cover.png",
        amount: activity.token.amount,
        usdValue:
          typeof position?.priceUsd === "number"
            ? parseFloat(activity.token.amount) * position.priceUsd
            : null,
        counterparty:
          activity.counterparty ??
          (activity.direction === "in"
            ? "Unknown sender"
            : "Unknown recipient"),
      };
    }
    case "program_action": {
      if (activity.token) {
        const position = resolvePositionByMint(positions, activity.token.mint);
        return {
          symbol: position?.asset.symbol ?? "TOKEN",
          icon: position
            ? resolveTokenIcon(position)
            : "/hero-new/Wallet-Cover.png",
          amount: activity.token.amount,
          usdValue:
            typeof position?.priceUsd === "number"
              ? parseFloat(activity.token.amount) * position.priceUsd
              : null,
          counterparty: activity.counterparty ?? activity.action,
        };
      }

      return {
        symbol: "SOL",
        icon: getTokenIconUrl("SOL"),
        amount: formatSolAmount(activity.amountLamports),
        usdValue:
          typeof solPriceUsd === "number"
            ? (activity.amountLamports / 1_000_000_000) * solPriceUsd
            : null,
        counterparty: activity.counterparty ?? activity.action,
      };
    }
    case "sol_transfer":
    default: {
      return {
        symbol: "SOL",
        icon: getTokenIconUrl("SOL"),
        amount: formatSolAmount(activity.amountLamports),
        usdValue:
          typeof solPriceUsd === "number"
            ? (activity.amountLamports / 1_000_000_000) * solPriceUsd
            : null,
        counterparty:
          activity.counterparty ??
          (activity.direction === "in"
            ? "Unknown sender"
            : "Unknown recipient"),
      };
    }
  }
}

function getActivityUsdDelta(
  activity: WalletActivity,
  positions: PortfolioPosition[],
  solPriceUsd: number | null
): number {
  const sign = activity.direction === "in" ? 1 : -1;

  switch (activity.type) {
    case "swap": {
      const fromPos = resolvePositionByMint(positions, activity.fromToken.mint);
      const toPos = resolvePositionByMint(positions, activity.toToken.mint);
      const fromUsd =
        typeof fromPos?.priceUsd === "number"
          ? parseFloat(activity.fromToken.amount) * fromPos.priceUsd
          : 0;
      const toUsd =
        typeof toPos?.priceUsd === "number"
          ? parseFloat(activity.toToken.amount) * toPos.priceUsd
          : 0;
      return toUsd - fromUsd;
    }
    case "token_transfer": {
      const pos = resolvePositionByMint(positions, activity.token.mint);
      if (typeof pos?.priceUsd === "number") {
        return sign * parseFloat(activity.token.amount) * pos.priceUsd;
      }
      return 0;
    }
    case "program_action": {
      if (activity.token) {
        const pos = resolvePositionByMint(positions, activity.token.mint);
        if (typeof pos?.priceUsd === "number") {
          return sign * parseFloat(activity.token.amount) * pos.priceUsd;
        }
        return 0;
      }
      if (typeof solPriceUsd === "number") {
        return sign * (activity.amountLamports / 1_000_000_000) * solPriceUsd;
      }
      return 0;
    }
    case "sol_transfer":
    default: {
      if (typeof solPriceUsd === "number") {
        return sign * (activity.amountLamports / 1_000_000_000) * solPriceUsd;
      }
      return 0;
    }
  }
}

function mapActivityToRowAndDetail(
  activity: WalletActivity,
  positions: PortfolioPosition[],
  solPriceUsd: number | null
): { row: ActivityRow; detail: TransactionDetail } {
  const display = getActivityDisplay(activity, positions, solPriceUsd);
  const isReceived = activity.direction === "in";
  const timestamp = formatTimestamp(activity.timestamp);
  const amount = `${isReceived ? "+" : "-"}${display.amount} ${display.symbol}`;

  const rowType: ActivityRow["type"] = isReceived ? "received" : "sent";

  // Earn (Kamino) operations read as the operation itself, not a generic
  // send: "Earn Deposit" instead of "Sent to Unknown". Fee-only legs
  // (autodeposit machinery) carry no token change — the row's SOL amount is
  // just the network fee — and read as "Earn Vault Operation".
  const earnActivity =
    activity.type === "program_action" &&
    (activity.action === "earn_deposit" || activity.action === "earn_withdraw")
      ? activity
      : null;

  const row: ActivityRow = {
    id: activity.signature,
    type: rowType,
    counterparty: display.counterparty,
    amount,
    timestamp: timestamp.time,
    date: timestamp.date,
    icon: display.icon,
    rawTimestamp: activity.timestamp ?? undefined,
    ...(earnActivity
      ? earnActivity.token
        ? {
            titleOverride:
              earnActivity.action === "earn_deposit"
                ? "Earn Deposit"
                : "Earn Withdrawal",
          }
        : {
            // Fee-only SOL legs (autodeposit machinery) aren't a user
            // deposit/withdrawal — label them as generic vault operations.
            subtitle: "Network fee",
            titleOverride: "Earn Vault Operation",
          }
      : {}),
  };

  return {
    row,
    detail: {
      activity: row,
      usdValue: formatUsd(display.usdValue),
      status: activity.status === "failed" ? "Failed" : "Completed",
      networkFee: `${formatSolAmount(activity.feeLamports)} SOL`,
      networkFeeUsd: formatUsd(
        typeof solPriceUsd === "number"
          ? (activity.feeLamports / 1_000_000_000) * solPriceUsd
          : null
      ),
    },
  };
}

function mapPositionToTokenRow(position: PortfolioPosition): TokenRow {
  return {
    id: position.asset.mint,
    symbol: position.asset.symbol,
    name: position.asset.name,
    price: formatUsd(position.priceUsd),
    amount: formatTokenBalance(position.publicBalance),
    value: formatUsd(position.publicValueUsd),
    icon: resolveTokenIcon(position),
    totalAmountDisplay: formatTokenBalance(position.totalBalance),
    totalValueDisplay: formatUsd(position.totalValueUsd),
    publicAmountDisplay: formatTokenBalance(position.publicBalance),
    publicValueDisplay: formatUsd(position.publicValueUsd),
  };
}

const WALLET_DESKTOP_CACHE_VERSION = 2;

export type WalletDesktopCachePayload = {
  portfolioSnapshot: PortfolioSnapshot;
};

function getWalletDesktopCacheKey(args: {
  solanaEnv: string;
  walletAddress: string;
}): string {
  return [
    "loyal",
    "wallet-desktop",
    WALLET_DESKTOP_CACHE_VERSION,
    args.solanaEnv,
    args.walletAddress,
  ].join(":");
}

function writeWalletDesktopCache(args: {
  solanaEnv: string;
  walletAddress: string;
  portfolioSnapshot: PortfolioSnapshot;
}) {
  writeClientCache<WalletDesktopCachePayload>({
    key: getWalletDesktopCacheKey(args),
    version: WALLET_DESKTOP_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    data: {
      portfolioSnapshot: args.portfolioSnapshot,
    },
  });
}

function readWalletDesktopCache(args: {
  solanaEnv: string;
  walletAddress: string;
}): WalletDesktopCachePayload | null {
  return readClientCache<WalletDesktopCachePayload>({
    key: getWalletDesktopCacheKey(args),
    version: WALLET_DESKTOP_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    validate: (data): data is WalletDesktopCachePayload =>
      typeof data === "object" && data !== null && "portfolioSnapshot" in data,
  });
}

export function useWalletDesktopData(
  options: UseWalletDesktopDataOptions = {}
): WalletDesktopData {
  const enabled = options.enabled !== false;
  const client = useSolanaWalletDataClient();
  const publicEnv = usePublicEnv();
  const { user } = useAuthSession();
  const wallet = useWallet();
  const sessionWalletAddress = user?.walletAddress ?? null;
  const walletAddress =
    sessionWalletAddress ?? wallet.publicKey?.toBase58() ?? null;
  const ownerPublicKey = useMemo(() => {
    if (wallet.publicKey && wallet.publicKey.toBase58() === walletAddress) {
      return wallet.publicKey;
    }

    if (!walletAddress) {
      return null;
    }

    try {
      return new PublicKey(walletAddress);
    } catch {
      return null;
    }
  }, [wallet.publicKey, walletAddress]);
  const [portfolioSnapshot, setPortfolioSnapshot] =
    useState<PortfolioSnapshot | null>(null);
  const [activities, setActivities] = useState<WalletActivity[]>([]);
  const [hasRequestedActivity, setHasRequestedActivity] = useState(false);
  const activityLoadPromiseRef = useRef<Promise<void> | null>(null);
  const ownerAddressRef = useRef<string | null>(null);
  ownerAddressRef.current = ownerPublicKey?.toBase58() ?? null;
  const [isLoading, setIsLoading] = useState(false);

  const applyPortfolioState = useCallback(
    (args: {
      portfolioSnapshot: PortfolioSnapshot;
      walletAddress: string;
      persist?: boolean;
    }) => {
      setPortfolioSnapshot(args.portfolioSnapshot);

      if (args.persist !== false) {
        writeWalletDesktopCache({
          solanaEnv: publicEnv.solanaEnv,
          walletAddress: args.walletAddress,
          portfolioSnapshot: args.portfolioSnapshot,
        });
      }
    },
    [publicEnv.solanaEnv]
  );

  const loadActivity = useCallback(async () => {
    if (!ownerPublicKey) {
      return;
    }

    setHasRequestedActivity(true);

    if (activityLoadPromiseRef.current) {
      return activityLoadPromiseRef.current;
    }

    const publicKey = ownerPublicKey;
    const address = publicKey.toBase58();
    const loadPromise = client
      .getActivity(publicKey, { limit: WALLET_ACTIVITY_INITIAL_LIMIT })
      .then((history) => {
        if (ownerAddressRef.current === address) {
          setActivities(history.activities);
        }
      })
      .finally(() => {
        if (activityLoadPromiseRef.current === loadPromise) {
          activityLoadPromiseRef.current = null;
        }
      });

    activityLoadPromiseRef.current = loadPromise;
    return loadPromise;
  }, [client, ownerPublicKey]);

  const refresh = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!enabled || !ownerPublicKey || !isCurrent()) {
        return;
      }

      const publicKey = ownerPublicKey;
      const address = publicKey.toBase58();

      client.invalidateCaches({
        portfolio: [publicKey],
        activity: [publicKey],
      });

      const tasks: Promise<unknown>[] = [];

      tasks.push(
        client
          .getPortfolio(publicKey, { forceRefresh: true })
          .then((nextPortfolio) => {
            if (ownerAddressRef.current !== address || !isCurrent()) {
              return;
            }
            applyPortfolioState({
              portfolioSnapshot: nextPortfolio,
              walletAddress: address,
            });
          })
          .catch((error) => {
            console.error("Failed to refresh wallet portfolio", error);
          })
      );

      if (hasRequestedActivity) {
        tasks.push(
          client
            .getActivity(publicKey, {
              limit: WALLET_ACTIVITY_INITIAL_LIMIT,
              forceRefresh: true,
            })
            .then((history) => {
              if (ownerAddressRef.current === address && isCurrent()) {
                setActivities(history.activities);
              }
            })
            .catch((error) => {
              console.error("Failed to refresh wallet activity", error);
            })
        );
      }

      await Promise.all(tasks);
    },
    [applyPortfolioState, client, enabled, hasRequestedActivity, ownerPublicKey]
  );

  useEffect(() => {
    ownerAddressRef.current = ownerPublicKey?.toBase58() ?? null;
    setActivities([]);
    setHasRequestedActivity(false);
    activityLoadPromiseRef.current = null;
  }, [ownerPublicKey]);

  useEffect(() => {
    if (!ownerPublicKey) {
      setPortfolioSnapshot(null);
      setActivities([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const publicKey = ownerPublicKey;
    const address = publicKey.toBase58();
    const cached = readWalletDesktopCache({
      solanaEnv: publicEnv.solanaEnv,
      walletAddress: address,
    });

    if (cached) {
      applyPortfolioState({
        portfolioSnapshot: cached.portfolioSnapshot,
        walletAddress: address,
        persist: false,
      });
    } else {
      setPortfolioSnapshot(null);
    }

    if (!enabled) {
      setIsLoading(false);
      return;
    }

    setIsLoading(!cached);

    void client
      .getPortfolio(publicKey)
      .then((nextPortfolio) => {
        if (cancelled) {
          return;
        }

        applyPortfolioState({
          portfolioSnapshot: nextPortfolio,
          walletAddress: address,
        });
        setIsLoading(false);
      })
      .catch((error) => {
        console.error("Failed to load wallet desktop data", error);
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, ownerPublicKey, applyPortfolioState, enabled, publicEnv.solanaEnv]);

  useEffect(() => {
    if (!enabled || !ownerPublicKey) {
      return;
    }

    let closed = false;
    let unsubscribePortfolio: (() => Promise<void>) | null = null;
    let unsubscribeActivity: (() => Promise<void>) | null = null;

    const subscriptionPublicKey = ownerPublicKey;
    const subscriptionAddress = subscriptionPublicKey.toBase58();

    void client
      .subscribePortfolio(
        subscriptionPublicKey,
        (snapshot) => {
          if (closed) return;
          applyPortfolioState({
            portfolioSnapshot: snapshot,
            walletAddress: subscriptionAddress,
          });
        },
        { emitInitial: false, fallbackRefreshMs: 0 }
      )
      .then((unsubscribe) => {
        unsubscribePortfolio = unsubscribe;
      })
      .catch((error) => {
        console.error("Failed to subscribe to wallet portfolio", error);
      });

    if (hasRequestedActivity) {
      void client
        .subscribeActivity(
          subscriptionPublicKey,
          (activity) => {
            if (closed) {
              return;
            }

            setActivities((currentActivities) => {
              const matchIndex = currentActivities.findIndex(
                (currentActivity) =>
                  currentActivity.signature === activity.signature
              );

              if (matchIndex >= 0) {
                const nextActivities = [...currentActivities];
                nextActivities[matchIndex] = {
                  ...currentActivities[matchIndex],
                  ...activity,
                };
                return nextActivities.sort(
                  (left, right) =>
                    (right.timestamp ?? 0) - (left.timestamp ?? 0)
                );
              }

              return [activity, ...currentActivities].sort(
                (left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0)
              );
            });
          },
          {
            emitInitial: false,
            fallbackRefreshMs: 0,
            historyLimit: WALLET_ACTIVITY_INITIAL_LIMIT,
          }
        )
        .then((unsubscribe) => {
          unsubscribeActivity = unsubscribe;
        })
        .catch((error) => {
          console.error("Failed to subscribe to wallet activity", error);
        });
    }

    return () => {
      closed = true;
      if (unsubscribePortfolio) {
        void unsubscribePortfolio();
      }
      if (unsubscribeActivity) {
        void unsubscribeActivity();
      }
    };
  }, [client, ownerPublicKey, applyPortfolioState, enabled, hasRequestedActivity]);

  // Fetch LOYAL token price for the always-visible placeholder row.
  const [loylPriceUsd, setLoylPriceUsd] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;

    // Paint the last known price instantly, then revalidate via the shared
    // client (deduped with other LOYL price consumers; no-op when fresh).
    const cached = readCachedTokenMarketPriceUsd(LOYL_MINT);
    if (cached !== null) {
      setLoylPriceUsd(cached);
    }

    void fetchTokenMarketPriceUsd(LOYL_MINT).then((price) => {
      if (!cancelled && price !== null) {
        setLoylPriceUsd(price);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const positions = portfolioSnapshot?.positions ?? EMPTY_POSITIONS;
  const totals = portfolioSnapshot?.totals ?? {
    totalUsd: 0,
    totalSol: null,
    effectiveSolPriceUsd: null,
  };

  const valuedMintsSignature = useMemo(() => {
    return createTokenMarketMintsSignature(positions);
  }, [positions]);

  const [priceChange24hByMint, setPriceChange24hByMint] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const stablecoinMints = useMemo(
    () => getStablecoinMintSetForSolanaEnv(publicEnv.solanaEnv),
    [publicEnv.solanaEnv]
  );

  useEffect(() => {
    if (!valuedMintsSignature) {
      setPriceChange24hByMint(new Map());
      return;
    }

    let cancelled = false;
    void fetchTokenMarkets(valuedMintsSignature)
      .then(({ markets }) => {
        if (cancelled) return;
        const next = new Map<string, number>();
        for (const market of markets) {
          if (
            typeof market.priceChange24hPercent === "number" &&
            Number.isFinite(market.priceChange24hPercent)
          ) {
            next.set(market.mint, market.priceChange24hPercent);
          }
        }
        setPriceChange24hByMint(next);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[wallet-data] failed to fetch token markets", error);
      });

    return () => {
      cancelled = true;
    };
  }, [valuedMintsSignature]);

  const portfolioChange24h = useMemo<WalletPortfolioChange24h | null>(() => {
    if (priceChange24hByMint.size === 0) {
      return null;
    }

    let totalChangeUsd = 0;
    let totalPrevUsd = 0;
    for (const position of positions) {
      const valueUsd = position.totalValueUsd;
      if (typeof valueUsd !== "number" || valueUsd <= 0) {
        continue;
      }
      const pct = priceChange24hByMint.get(position.asset.mint);
      if (typeof pct !== "number") {
        // Treat unknown 24h change as flat — token still counts toward base.
        totalPrevUsd += valueUsd;
        continue;
      }
      const denom = 100 + pct;
      if (denom === 0) {
        continue;
      }
      const prev = (valueUsd * 100) / denom;
      totalChangeUsd += valueUsd - prev;
      totalPrevUsd += prev;
    }

    if (totalPrevUsd <= 0) {
      return null;
    }

    return {
      percent: (totalChangeUsd / totalPrevUsd) * 100,
      usdAmount: totalChangeUsd,
    };
  }, [positions, priceChange24hByMint]);

  const allTokenRows = useMemo(() => {
    const rows: TokenRow[] = [];
    const attachPriceChange = (row: TokenRow, mint: string) => {
      if (isStablecoinMint(mint, stablecoinMints)) {
        return row;
      }
      const pct = priceChange24hByMint.get(mint);
      if (typeof pct === "number") {
        row.priceChange24h = pct;
      }
      return row;
    };
    for (const position of positions) {
      if (position.publicBalance > 0) {
        rows.push(
          attachPriceChange(
            mapPositionToTokenRow(position),
            position.asset.mint
          )
        );
      }
    }

    // Ensure LOYL appears at 3rd position (index 2) always.
    const targetLoylIndex = Math.min(2, rows.length);
    const existingLoylIndex = rows.findIndex((r) => r.id === LOYL_MINT);
    if (existingLoylIndex >= 0) {
      // Already in rows (has balance) — move to index 2
      if (existingLoylIndex !== targetLoylIndex) {
        const [loylRow] = rows.splice(existingLoylIndex, 1);
        rows.splice(Math.min(2, rows.length), 0, loylRow);
      }
    } else {
      const loylPosition = positions.find((p) => p.asset.mint === LOYL_MINT);
      // Not in rows — create placeholder with Jupiter price
      const loylRow: TokenRow = loylPosition
        ? mapPositionToTokenRow(loylPosition)
        : {
            id: LOYL_MINT,
            symbol: "LOYAL",
            name: "Loyal",
            price: formatUsd(loylPriceUsd),
            amount: "0",
            value: "$0.00",
            icon: LOYL_ICON_URL,
          };
      attachPriceChange(loylRow, LOYL_MINT);
      rows.splice(targetLoylIndex, 0, loylRow);
    }

    return rows;
  }, [positions, loylPriceUsd, priceChange24hByMint, stablecoinMints]);

  const cashTokenRows = useMemo(
    () =>
      allTokenRows.filter((row) => isStablecoinMint(row.id, stablecoinMints)),
    [allTokenRows, stablecoinMints]
  );

  const investmentTokenRows = useMemo(
    () =>
      allTokenRows.filter((row) => !isStablecoinMint(row.id, stablecoinMints)),
    [allTokenRows, stablecoinMints]
  );

  const activityData = useMemo(() => {
    const details: Record<string, TransactionDetail> = {};
    const rows = activities.map((activity) => {
      const mapped = mapActivityToRowAndDetail(
        activity,
        positions,
        totals.effectiveSolPriceUsd
      );
      details[mapped.row.id] = mapped.detail;
      return mapped.row;
    });

    return { rows, details };
  }, [activities, positions, totals.effectiveSolPriceUsd]);

  // Lock balance history to the initial fetch so WebSocket subscription
  // updates don't cause jarring redraws of the sparkline.
  const balanceHistoryRef = useRef<BalanceHistoryPoint[]>([]);
  const balanceHistoryKeyRef = useRef<string | null>(null);

  const balanceHistory = useMemo((): BalanceHistoryPoint[] => {
    if (activities.length === 0 || totals.totalUsd <= 0) return [];

    // Only recompute when the wallet changes, not on subscription updates
    const key = walletAddress ?? "";
    if (
      balanceHistoryKeyRef.current === key &&
      balanceHistoryRef.current.length > 1
    ) {
      return balanceHistoryRef.current;
    }

    const now = Date.now();
    const sorted = [...activities]
      .filter((a) => a.timestamp !== null)
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    if (sorted.length === 0)
      return [{ timestamp: now, valueUsd: totals.totalUsd }];

    const points: BalanceHistoryPoint[] = [
      { timestamp: now, valueUsd: totals.totalUsd },
    ];
    let runningUsd = totals.totalUsd;

    for (const activity of sorted) {
      const delta = getActivityUsdDelta(
        activity,
        positions,
        totals.effectiveSolPriceUsd
      );
      runningUsd -= delta;
      points.push({
        timestamp: activity.timestamp as number,
        valueUsd: Math.max(0, runningUsd),
      });
    }

    const result = points.reverse();
    balanceHistoryRef.current = result;
    balanceHistoryKeyRef.current = key;
    return result;
  }, [
    activities,
    positions,
    totals.totalUsd,
    totals.effectiveSolPriceUsd,
    walletAddress,
  ]);

  const balance = splitUsdBalance(totals.totalUsd);
  const walletLabel = walletAddress
    ? `${
        { mainnet: "Mainnet", devnet: "Devnet", localnet: "Localnet" }[
          process.env.NEXT_PUBLIC_SOLANA_ENV ?? "mainnet"
        ] ?? "Mainnet"
      } · ${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
    : "No account";

  return {
    walletAddress,
    isConnected: Boolean(
      wallet.connected &&
        wallet.publicKey &&
        wallet.publicKey.toBase58() === walletAddress
    ),
    isLoading,
    totalUsd: totals.totalUsd,
    balanceWhole: balance.balanceWhole,
    balanceFraction: balance.balanceFraction,
    balanceSolLabel:
      totals.totalSol === null
        ? "0 SOL"
        : `${totals.totalSol.toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 5,
          })} SOL`,
    walletLabel,
    tokenRows: allTokenRows.slice(0, 3),
    allTokenRows,
    cashTokenRows,
    investmentTokenRows,
    activityRows: activityData.rows.slice(0, 5),
    allActivityRows: activityData.rows,
    walletActivities: activities,
    transactionDetails: activityData.details,
    positions,
    balanceHistory,
    portfolioChange24h,
    loadActivity,
    refresh,
  };
}
