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
  enrichSnapshotWithKaminoUsdcEarnings,
  type KaminoEarnings,
} from "@/lib/kamino/enrich-portfolio";
import { getCachedKaminoLendingApyBps } from "@/lib/kamino/kamino-read-client";
import { resolveTrackedKaminoUsdcMint } from "@/lib/kamino/kamino-usdc-position";
import { getTokenIconUrl } from "@/lib/token-icon";

import { useSolanaWalletDataClient } from "./use-solana-wallet-data-client";

export type BalanceHistoryPoint = {
  timestamp: number;
  valueUsd: number;
};

export type WalletEarningsSummary = {
  totalEarnedUsd: number;
  totalPrincipalUsd: number;
  changePercent: number;
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
  activityRows: ActivityRow[];
  allActivityRows: ActivityRow[];
  transactionDetails: Record<string, TransactionDetail>;
  positions: PortfolioPosition[];
  balanceHistory: BalanceHistoryPoint[];
  earningsSummary: WalletEarningsSummary | null;
  portfolioChange24h: WalletPortfolioChange24h | null;
  loadActivity: () => Promise<void>;
  refresh: () => Promise<void>;
  addLocalActivity: (row: ActivityRow, detail: TransactionDetail) => void;
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
        typeof position.totalValueUsd === "number" &&
        position.totalValueUsd > 0
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
    case "token_transfer":
    case "secure":
    case "unshield": {
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
          (activity.type === "secure"
            ? "Secure"
            : activity.type === "unshield"
            ? "Unshield"
            : activity.direction === "in"
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
          counterparty: activity.action,
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
        counterparty: activity.action,
      };
    }
    case "sol_transfer":
    default:
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
    case "token_transfer":
    case "secure":
    case "unshield": {
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
    default:
      if (typeof solPriceUsd === "number") {
        return sign * (activity.amountLamports / 1_000_000_000) * solPriceUsd;
      }
      return 0;
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
  const isShieldType =
    activity.type === "secure" || activity.type === "unshield";
  const amount = isShieldType
    ? `${display.amount} ${display.symbol}`
    : `${isReceived ? "+" : "-"}${display.amount} ${display.symbol}`;

  const rowType: ActivityRow["type"] =
    activity.type === "secure"
      ? "shielded"
      : activity.type === "unshield"
      ? "unshielded"
      : isReceived
      ? "received"
      : "sent";

  const row: ActivityRow = {
    id: activity.signature,
    type: rowType,
    counterparty: display.counterparty,
    amount,
    timestamp: timestamp.time,
    date: timestamp.date,
    icon:
      activity.type === "secure"
        ? "/hero-new/Shield.png"
        : activity.type === "unshield"
        ? "/hero-new/Unshield.svg"
        : display.icon,
    rawTimestamp: activity.timestamp ?? undefined,
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

function formatSignedUsd(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  return `${sign}${abs.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Values below 1 cent are treated as dust and hidden from the token list to
// avoid duplicate-looking rows after a Max-unshield leaves a few residual
// lamports in the vault. When USD value is unknown we err on the side of
// showing the row.
const DUST_VALUE_USD_THRESHOLD = 0.01;
function isDustValueUsd(valueUsd: number | null | undefined): boolean {
  return typeof valueUsd === "number" && valueUsd < DUST_VALUE_USD_THRESHOLD;
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
    securedAmountDisplay: formatTokenBalance(position.securedBalance),
    securedValueDisplay: formatUsd(position.securedValueUsd),
  };
}

function mapPositionToSecuredTokenRow(
  position: PortfolioPosition,
  earnings: KaminoEarnings | undefined,
  fallbackApyBps?: number | null
): TokenRow {
  const row: TokenRow = {
    id: `${position.asset.mint}-secured`,
    symbol: position.asset.symbol,
    name: position.asset.name,
    price: formatUsd(position.priceUsd),
    amount: formatTokenBalance(position.securedBalance),
    value: formatUsd(position.securedValueUsd),
    icon: resolveTokenIcon(position),
    isSecured: true,
    totalAmountDisplay: formatTokenBalance(position.totalBalance),
    totalValueDisplay: formatUsd(position.totalValueUsd),
    publicAmountDisplay: formatTokenBalance(position.publicBalance),
    publicValueDisplay: formatUsd(position.publicValueUsd),
    securedAmountDisplay: formatTokenBalance(position.securedBalance),
    securedValueDisplay: formatUsd(position.securedValueUsd),
  };

  const apyBps = earnings?.apyBps ?? fallbackApyBps ?? null;
  if (apyBps !== null) {
    row.apyBps = apyBps;
  }

  if (!earnings) {
    return row;
  }

  if (
    typeof earnings.earnedValueUsd === "number" &&
    typeof earnings.principalValueUsd === "number"
  ) {
    row.earnedValueDisplay = formatSignedUsd(earnings.earnedValueUsd);
    row.principalValueDisplay = formatUsd(earnings.principalValueUsd);
  }

  return row;
}

const EMPTY_EARNINGS_BY_MINT: ReadonlyMap<string, KaminoEarnings> = new Map();

export function useWalletDesktopData(): WalletDesktopData {
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
  const [earningsByMint, setEarningsByMint] = useState<
    ReadonlyMap<string, KaminoEarnings>
  >(EMPTY_EARNINGS_BY_MINT);
  const [earningsSummary, setEarningsSummary] =
    useState<WalletEarningsSummary | null>(null);
  const [apyByMint, setApyByMint] = useState<Record<string, number | null>>({});
  const [activities, setActivities] = useState<WalletActivity[]>([]);
  const [hasRequestedActivity, setHasRequestedActivity] = useState(false);
  const activityLoadPromiseRef = useRef<Promise<void> | null>(null);
  const ownerAddressRef = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [localRows, setLocalRows] = useState<ActivityRow[]>([]);
  const [localDetails, setLocalDetails] = useState<
    Record<string, TransactionDetail>
  >({});

  const applyEnrichment = useCallback(
    async (snapshot: PortfolioSnapshot, address: string) => {
      try {
        const enriched = await enrichSnapshotWithKaminoUsdcEarnings({
          snapshot,
          walletAddress: address,
          solanaEnv: publicEnv.solanaEnv,
        });
        return enriched;
      } catch (error) {
        console.warn("[wallet-data] Kamino enrichment failed", error);
        return {
          snapshot,
          earningsTotals: null,
          earningsByMint: EMPTY_EARNINGS_BY_MINT as Map<string, KaminoEarnings>,
        };
      }
    },
    [publicEnv.solanaEnv]
  );

  // Load local activity from localStorage when wallet connects
  useEffect(() => {
    if (!walletAddress) {
      setLocalRows([]);
      setLocalDetails({});
      return;
    }
    try {
      const stored = localStorage.getItem(
        `loyal:local-activity:${walletAddress}`
      );
      if (stored) {
        const parsed = JSON.parse(stored) as {
          rows: ActivityRow[];
          details: Record<string, TransactionDetail>;
        };
        setLocalRows(parsed.rows ?? []);
        setLocalDetails(parsed.details ?? {});
      }
    } catch {
      // ignore parse errors
    }
  }, [walletAddress]);

  const addLocalActivity = useCallback(
    (row: ActivityRow, detail: TransactionDetail) => {
      setLocalRows((prev) => {
        const next = [row, ...prev];
        if (walletAddress) {
          try {
            const nextDetails = { ...localDetails, [row.id]: detail };
            localStorage.setItem(
              `loyal:local-activity:${walletAddress}`,
              JSON.stringify({ rows: next, details: nextDetails })
            );
          } catch {
            // ignore quota errors
          }
        }
        return next;
      });
      setLocalDetails((prev) => ({ ...prev, [row.id]: detail }));
    },
    [walletAddress, localDetails]
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

  const refresh = useCallback(async () => {
    if (!ownerPublicKey) {
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
        .then(async (nextPortfolio) => {
          const enriched = await applyEnrichment(nextPortfolio, address);
          if (ownerAddressRef.current !== address) {
            return;
          }
          setPortfolioSnapshot(enriched.snapshot);
          setEarningsByMint(enriched.earningsByMint);
          setEarningsSummary(
            enriched.earningsTotals
              ? {
                  totalEarnedUsd: enriched.earningsTotals.totalEarnedUsd,
                  totalPrincipalUsd: enriched.earningsTotals.totalPrincipalUsd,
                  changePercent:
                    enriched.earningsTotals.totalPrincipalUsd > 0
                      ? (enriched.earningsTotals.totalEarnedUsd /
                          enriched.earningsTotals.totalPrincipalUsd) *
                        100
                      : 0,
                }
              : null
          );
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
            if (ownerAddressRef.current === address) {
              setActivities(history.activities);
            }
          })
          .catch((error) => {
            console.error("Failed to refresh wallet activity", error);
          })
      );
    }

    await Promise.all(tasks);
  }, [applyEnrichment, client, hasRequestedActivity, ownerPublicKey]);

  useEffect(() => {
    ownerAddressRef.current = ownerPublicKey?.toBase58() ?? null;
    setActivities([]);
    setHasRequestedActivity(false);
    activityLoadPromiseRef.current = null;
  }, [ownerPublicKey]);

  useEffect(() => {
    console.log("[wallet-data] effect fired", {
      connected: wallet.connected,
      publicKey: ownerPublicKey?.toBase58() ?? null,
    });

    if (!ownerPublicKey) {
      setPortfolioSnapshot(null);
      setEarningsByMint(EMPTY_EARNINGS_BY_MINT);
      setEarningsSummary(null);
      setActivities([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const publicKey = ownerPublicKey;
    const address = publicKey.toBase58();
    console.log("[wallet-data] fetching portfolio for", address);

    void client
      .getPortfolio(publicKey)
      .then(async (nextPortfolio) => {
        if (cancelled) {
          return;
        }

        const enriched = await applyEnrichment(nextPortfolio, address);
        if (cancelled) {
          return;
        }

        setPortfolioSnapshot(enriched.snapshot);
        setEarningsByMint(enriched.earningsByMint);
        setEarningsSummary(
          enriched.earningsTotals
            ? {
                totalEarnedUsd: enriched.earningsTotals.totalEarnedUsd,
                totalPrincipalUsd: enriched.earningsTotals.totalPrincipalUsd,
                changePercent:
                  enriched.earningsTotals.totalPrincipalUsd > 0
                    ? (enriched.earningsTotals.totalEarnedUsd /
                        enriched.earningsTotals.totalPrincipalUsd) *
                      100
                    : 0,
              }
            : null
        );
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
  }, [client, wallet.connected, ownerPublicKey, applyEnrichment]);

  useEffect(() => {
    if (!ownerPublicKey) {
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
          void applyEnrichment(snapshot, subscriptionAddress).then(
            (enriched) => {
              if (closed) return;
              setPortfolioSnapshot(enriched.snapshot);
              setEarningsByMint(enriched.earningsByMint);
              setEarningsSummary(
                enriched.earningsTotals
                  ? {
                      totalEarnedUsd: enriched.earningsTotals.totalEarnedUsd,
                      totalPrincipalUsd:
                        enriched.earningsTotals.totalPrincipalUsd,
                      changePercent:
                        enriched.earningsTotals.totalPrincipalUsd > 0
                          ? (enriched.earningsTotals.totalEarnedUsd /
                              enriched.earningsTotals.totalPrincipalUsd) *
                            100
                          : 0,
                    }
                  : null
              );
            }
          );
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
                  (left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0)
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
  }, [client, ownerPublicKey, applyEnrichment, hasRequestedActivity]);

  // Fetch LOYAL token price for the always-visible placeholder row.
  const [loylPriceUsd, setLoylPriceUsd] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tokens/${LOYL_MINT}/market`)
      .then((res) => res.json())
      .then(
        (market: {
          market?: {
            priceUsd?: number | null;
          };
        }) => {
          if (cancelled) return;
          const price = market.market?.priceUsd;
          if (
            typeof price === "number" &&
            Number.isFinite(price) &&
            price > 0
          ) {
            setLoylPriceUsd(price);
          }
        }
      )
      .catch(() => {});
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
  const kaminoUsdcMint = resolveTrackedKaminoUsdcMint(publicEnv.solanaEnv);

  const valuedMintsSignature = useMemo(() => {
    return createTokenMarketMintsSignature(positions);
  }, [positions]);

  const [priceChange24hByMint, setPriceChange24hByMint] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());

  useEffect(() => {
    if (!valuedMintsSignature) {
      setPriceChange24hByMint(new Map());
      return;
    }

    let cancelled = false;
    const url = new URL("/api/tokens/markets", window.location.origin);
    url.searchParams.set("mints", valuedMintsSignature);

    void fetch(url.toString())
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Markets request failed: ${response.status}`);
        }
        return response.json() as Promise<{
          markets: { mint: string; priceChange24hPercent: number | null }[];
        }>;
      })
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

  useEffect(() => {
    if (!kaminoUsdcMint) {
      setApyByMint({});
      return;
    }

    const hasShieldedKaminoUsdc = positions.some(
      (position) =>
        position.asset.mint === kaminoUsdcMint && position.securedBalance > 0
    );
    if (!hasShieldedKaminoUsdc) {
      setApyByMint({});
      return;
    }

    let cancelled = false;
    void getCachedKaminoLendingApyBps({
      solanaEnv: publicEnv.solanaEnv,
      mint: kaminoUsdcMint,
    }).then((apyBps) => {
      if (cancelled) return;
      setApyByMint(apyBps !== null ? { [kaminoUsdcMint]: apyBps } : {});
    });

    return () => {
      cancelled = true;
    };
  }, [kaminoUsdcMint, positions, publicEnv.solanaEnv]);

  const allTokenRows = useMemo(() => {
    const rows: TokenRow[] = [];
    const attachPriceChange = (row: TokenRow, mint: string) => {
      const pct = priceChange24hByMint.get(mint);
      if (typeof pct === "number") {
        row.priceChange24h = pct;
      }
      return row;
    };
    for (const position of positions) {
      const earnings = earningsByMint.get(position.asset.mint);
      if (position.publicBalance > 0) {
        rows.push(
          attachPriceChange(mapPositionToTokenRow(position), position.asset.mint)
        );
      }
      // Add secured row right after the public one. Skip dust amounts that
      // can linger in the vault after a Max-unshield (a few lamports of
      // rounding or residual rent-reserve), since they render as a confusing
      // near-empty duplicate row.
      if (
        position.securedBalance > 0 &&
        !isDustValueUsd(position.securedValueUsd)
      ) {
        rows.push(
          attachPriceChange(
            mapPositionToSecuredTokenRow(
              position,
              earnings,
              apyByMint[position.asset.mint]
            ),
            position.asset.mint
          )
        );
      }
    }

    // Ensure LOYL appears at 3rd position (index 2) always — but never
    // splice between a public/shielded pair of the same mint.
    const findPairSafeInsertion = (desiredIndex: number): number => {
      let index = Math.min(Math.max(desiredIndex, 0), rows.length);
      while (
        index > 0 &&
        index < rows.length &&
        rows[index - 1].isSecured !== true &&
        rows[index].isSecured === true &&
        rows[index].id?.replace(/-secured$/, "") === rows[index - 1].id
      ) {
        index += 1;
      }
      return index;
    };
    const existingLoylIndex = rows.findIndex((r) => r.id === LOYL_MINT);
    if (existingLoylIndex >= 0) {
      // Already in rows (has balance) — move to a pair-safe placement near 2
      const targetIndex = findPairSafeInsertion(2);
      if (existingLoylIndex !== targetIndex) {
        const [loylRow] = rows.splice(existingLoylIndex, 1);
        rows.splice(findPairSafeInsertion(2), 0, loylRow);
      }
    } else {
      const loylPosition = positions.find((p) => p.asset.mint === LOYL_MINT);
      // If LOYAL is held only as shielded, the secured row already
      // represents it — don't add an empty public placeholder row. Treat a
      // dust-only shielded position as if it didn't exist (matches the
      // dust filter applied when building secured rows above).
      const loylHasOnlyShielded =
        loylPosition !== undefined &&
        loylPosition.publicBalance === 0 &&
        loylPosition.securedBalance > 0 &&
        !isDustValueUsd(loylPosition.securedValueUsd);
      if (!loylHasOnlyShielded) {
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
        rows.splice(findPairSafeInsertion(2), 0, loylRow);
      }
    }

    return rows;
  }, [
    positions,
    loylPriceUsd,
    earningsByMint,
    apyByMint,
    priceChange24hByMint,
  ]);

  const activityData = useMemo(() => {
    const details: Record<string, TransactionDetail> = {};
    const SHIELD_PLUMBING_ACTIONS = new Set([
      "initialize_deposit",
      "create_permission",
      "delegate",
      "undelegate",
      "initialize_username_deposit",
      "create_username_permission",
      "delegate_username_deposit",
      "undelegate_username_deposit",
    ]);
    const rows = activities
      .filter(
        (a) =>
          !(
            a.type === "program_action" && SHIELD_PLUMBING_ACTIONS.has(a.action)
          )
      )
      .map((activity) => {
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

  // Merge local (private send) rows with on-chain activity, deduping by id
  // and sorting by rawTimestamp descending so newest activity appears first
  const mergedActivityData = useMemo(() => {
    const onChainIds = new Set(activityData.rows.map((r) => r.id));
    const uniqueLocalRows = localRows.filter((r) => !onChainIds.has(r.id));
    const rows = [...uniqueLocalRows, ...activityData.rows].sort(
      (a, b) => (b.rawTimestamp ?? 0) - (a.rawTimestamp ?? 0)
    );
    const details = { ...activityData.details, ...localDetails };
    return { rows, details };
  }, [activityData, localRows, localDetails]);

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

  const formattedBalance = formatUsd(totals.totalUsd);
  const balanceParts = formattedBalance.split(".");
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
    balanceWhole: balanceParts[0] ?? "$0",
    balanceFraction: balanceParts[1] ? `.${balanceParts[1]}` : "",
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
    activityRows: mergedActivityData.rows.slice(0, 5),
    allActivityRows: mergedActivityData.rows,
    transactionDetails: mergedActivityData.details,
    positions,
    balanceHistory,
    earningsSummary,
    portfolioChange24h,
    loadActivity,
    refresh,
    addLocalActivity,
  };
}
