"use client";

import {
  type PortfolioPosition,
  type PortfolioSnapshot,
  type WalletActivity,
} from "@loyal-labs/solana-wallet";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActivityRow,
  TokenRow,
  TransactionDetail,
} from "@/components/wallet-sidebar/types";
import { usePublicEnv } from "@/contexts/public-env-context";
import {
  enrichSnapshotWithKaminoUsdcEarnings,
  type KaminoEarnings,
} from "@/lib/kamino/enrich-portfolio";
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

export type WalletDesktopData = {
  walletAddress: string | null;
  isConnected: boolean;
  isLoading: boolean;
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
  addLocalActivity: (row: ActivityRow, detail: TransactionDetail) => void;
};

const EMPTY_POSITIONS: PortfolioPosition[] = [];
const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";
const JUPITER_TOKEN_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";

const LOYL_ICON_URL = "https://avatars.githubusercontent.com/u/210601628?s=200&v=4";

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

function formatTimestamp(timestamp: number | null): { date: string; time: string } {
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
      const fromPosition = resolvePositionByMint(positions, activity.fromToken.mint);
      return {
        symbol: fromPosition?.asset.symbol ?? "SOL",
        icon: fromPosition ? resolveTokenIcon(fromPosition) : getTokenIconUrl("SOL"),
        amount: activity.fromToken.amount ?? formatSolAmount(activity.amountLamports),
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
        icon: position ? resolveTokenIcon(position) : "/hero-new/Wallet-Cover.png",
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
          (activity.direction === "in" ? "Unknown sender" : "Unknown recipient"),
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
  const isShieldType = activity.type === "secure" || activity.type === "unshield";
  const amount = isShieldType
    ? `${display.amount} ${display.symbol}`
    : `${isReceived ? "+" : "-"}${display.amount} ${display.symbol}`;

  const rowType: ActivityRow["type"] =
    activity.type === "secure" ? "shielded"
    : activity.type === "unshield" ? "unshielded"
    : isReceived ? "received" : "sent";

  const row: ActivityRow = {
    id: activity.signature,
    type: rowType,
    counterparty: display.counterparty,
    amount,
    timestamp: timestamp.time,
    date: timestamp.date,
    icon: activity.type === "secure" ? "/hero-new/Shield.png"
      : activity.type === "unshield" ? "/hero-new/Unshield.svg"
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

function mapPositionToTokenRow(position: PortfolioPosition): TokenRow {
  return {
    id: position.asset.mint,
    symbol: position.asset.symbol,
    price: formatUsd(position.priceUsd),
    amount: formatTokenBalance(position.totalBalance),
    value: formatUsd(position.totalValueUsd),
    icon: resolveTokenIcon(position),
  };
}

function mapPositionToSecuredTokenRow(
  position: PortfolioPosition,
  earnings: KaminoEarnings | undefined
): TokenRow {
  const row: TokenRow = {
    id: `${position.asset.mint}-secured`,
    symbol: position.asset.symbol,
    price: formatUsd(position.priceUsd),
    amount: formatTokenBalance(position.securedBalance),
    value: formatUsd(position.securedValueUsd),
    icon: resolveTokenIcon(position),
    isSecured: true,
  };

  if (!earnings) {
    return row;
  }

  row.apyBps = earnings.apyBps ?? null;

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
  const wallet = useWallet();
  const walletAddress = wallet.publicKey?.toBase58() ?? null;
  const [portfolioSnapshot, setPortfolioSnapshot] =
    useState<PortfolioSnapshot | null>(null);
  const [earningsByMint, setEarningsByMint] =
    useState<ReadonlyMap<string, KaminoEarnings>>(EMPTY_EARNINGS_BY_MINT);
  const [earningsSummary, setEarningsSummary] =
    useState<WalletEarningsSummary | null>(null);
  const [activities, setActivities] = useState<WalletActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [localRows, setLocalRows] = useState<ActivityRow[]>([]);
  const [localDetails, setLocalDetails] = useState<Record<string, TransactionDetail>>({});

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
      const stored = localStorage.getItem(`loyal:local-activity:${walletAddress}`);
      if (stored) {
        const parsed = JSON.parse(stored) as { rows: ActivityRow[]; details: Record<string, TransactionDetail> };
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
              JSON.stringify({ rows: next, details: nextDetails }),
            );
          } catch {
            // ignore quota errors
          }
        }
        return next;
      });
      setLocalDetails((prev) => ({ ...prev, [row.id]: detail }));
    },
    [walletAddress, localDetails],
  );

  useEffect(() => {
    console.log("[wallet-data] effect fired", {
      connected: wallet.connected,
      publicKey: wallet.publicKey?.toBase58() ?? null,
    });

    if (!(wallet.connected && wallet.publicKey)) {
      setPortfolioSnapshot(null);
      setEarningsByMint(EMPTY_EARNINGS_BY_MINT);
      setEarningsSummary(null);
      setActivities([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const publicKey = wallet.publicKey;
    const address = publicKey.toBase58();
    console.log("[wallet-data] fetching portfolio for", address);

    void Promise.all([
      client.getPortfolio(publicKey),
      client.getActivity(publicKey, { limit: 25 }),
    ])
      .then(async ([nextPortfolio, history]) => {
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
        setActivities(history.activities);
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
  }, [client, wallet.connected, wallet.publicKey, applyEnrichment]);

  useEffect(() => {
    if (!(wallet.connected && wallet.publicKey)) {
      return;
    }

    let closed = false;
    let unsubscribePortfolio: (() => Promise<void>) | null = null;
    let unsubscribeActivity: (() => Promise<void>) | null = null;

    const subscriptionAddress = wallet.publicKey.toBase58();

    void client
      .subscribePortfolio(
        wallet.publicKey,
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
        { emitInitial: false }
      )
      .then((unsubscribe) => {
        unsubscribePortfolio = unsubscribe;
      })
      .catch((error) => {
        console.error("Failed to subscribe to wallet portfolio", error);
      });

    void client
      .subscribeActivity(
        wallet.publicKey,
        (activity) => {
          if (closed) {
            return;
          }

          setActivities((currentActivities) => {
            const matchIndex = currentActivities.findIndex(
              (currentActivity) => currentActivity.signature === activity.signature
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
        { emitInitial: false }
      )
      .then((unsubscribe) => {
        unsubscribeActivity = unsubscribe;
      })
      .catch((error) => {
        console.error("Failed to subscribe to wallet activity", error);
      });

    return () => {
      closed = true;
      if (unsubscribePortfolio) {
        void unsubscribePortfolio();
      }
      if (unsubscribeActivity) {
        void unsubscribeActivity();
      }
    };
  }, [client, wallet.connected, wallet.publicKey, applyEnrichment]);

  // Fetch LOYAL token price from Jupiter for the always-visible placeholder row
  const [loylPriceUsd, setLoylPriceUsd] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${JUPITER_TOKEN_SEARCH_URL}?query=${LOYL_MINT}`)
      .then((res) => res.json())
      .then((tokens: { id: string; usdPrice?: number }[]) => {
        if (cancelled) return;
        const match = tokens.find((t) => t.id === LOYL_MINT);
        const price = match?.usdPrice;
        if (typeof price === "number" && Number.isFinite(price) && price > 0) {
          setLoylPriceUsd(price);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const positions = portfolioSnapshot?.positions ?? EMPTY_POSITIONS;
  const totals = portfolioSnapshot?.totals ?? {
    totalUsd: 0,
    totalSol: null,
    effectiveSolPriceUsd: null,
  };

  const allTokenRows = useMemo(() => {
    const rows: TokenRow[] = [];
    for (const position of positions) {
      if (position.totalBalance > 0) {
        rows.push(mapPositionToTokenRow(position));
      }
      // Add secured row right after the public one
      if (position.securedBalance > 0) {
        rows.push(
          mapPositionToSecuredTokenRow(
            position,
            earningsByMint.get(position.asset.mint)
          )
        );
      }
    }

    // Ensure LOYL appears at 3rd position (index 2) always
    const existingLoylIndex = rows.findIndex((r) => r.id === LOYL_MINT);
    if (existingLoylIndex >= 0) {
      // Already in rows (has balance) — move to index 2 if not there
      if (existingLoylIndex !== 2) {
        const [loylRow] = rows.splice(existingLoylIndex, 1);
        rows.splice(Math.min(2, rows.length), 0, loylRow);
      }
    } else {
      // Not in rows — create placeholder with Jupiter price
      const loylPosition = positions.find((p) => p.asset.mint === LOYL_MINT);
      const loylRow: TokenRow = loylPosition
        ? mapPositionToTokenRow(loylPosition)
        : {
            id: LOYL_MINT,
            symbol: "LOYAL",
            price: formatUsd(loylPriceUsd),
            amount: "0",
            value: "$0.00",
            icon: LOYL_ICON_URL,
          };
      rows.splice(Math.min(2, rows.length), 0, loylRow);
    }

    return rows;
  }, [positions, loylPriceUsd, earningsByMint]);

  const activityData = useMemo(() => {
    const details: Record<string, TransactionDetail> = {};
    const SHIELD_PLUMBING_ACTIONS = new Set([
      "initialize_deposit", "create_permission", "delegate", "undelegate",
      "initialize_username_deposit", "create_username_permission",
      "delegate_username_deposit", "undelegate_username_deposit",
    ]);
    const rows = activities
      .filter((a) => !(a.type === "program_action" && SHIELD_PLUMBING_ACTIONS.has(a.action)))
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
    if (balanceHistoryKeyRef.current === key && balanceHistoryRef.current.length > 1) {
      return balanceHistoryRef.current;
    }

    const now = Date.now();
    const sorted = [...activities]
      .filter((a) => a.timestamp !== null)
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    if (sorted.length === 0) return [{ timestamp: now, valueUsd: totals.totalUsd }];

    const points: BalanceHistoryPoint[] = [{ timestamp: now, valueUsd: totals.totalUsd }];
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
  }, [activities, positions, totals.totalUsd, totals.effectiveSolPriceUsd, walletAddress]);

  const formattedBalance = formatUsd(totals.totalUsd);
  const balanceParts = formattedBalance.split(".");
  const walletLabel = walletAddress
    ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)} · ${
        { mainnet: "Mainnet", devnet: "Devnet", localnet: "Localnet" }[
          process.env.NEXT_PUBLIC_SOLANA_ENV ?? "mainnet"
        ] ?? "Mainnet"
      }`
    : "No account";

  return {
    walletAddress,
    isConnected: Boolean(wallet.connected && walletAddress),
    isLoading,
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
    addLocalActivity,
  };
}
