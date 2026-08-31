import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import type {
  PortfolioPosition,
  PortfolioSnapshot,
  SolanaWalletDataClient,
  WalletActivity,
} from "@loyal-labs/solana-wallet";
import type { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getTokenIconUrl } from "../lib/token-icon";
import type { ActivityRow, TokenRow, TransactionDetail } from "../types/wallet";

export type BalanceHistoryPoint = {
  timestamp: number;
  valueUsd: number;
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
  addLocalActivity: (row: ActivityRow, detail: TransactionDetail) => void;
};

const EMPTY_POSITIONS: PortfolioPosition[] = [];
const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";
const JUPITER_TOKEN_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";
const LOYL_ICON_URL =
  "https://avatars.githubusercontent.com/u/210601628?s=200&v=4";

// In-memory local activity store (no localStorage dependency)
const localActivityStore = new Map<
  string,
  { rows: ActivityRow[]; details: Record<string, TransactionDetail> }
>();

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
  if (balance === 0) return "0";
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
  if (!mint) return undefined;
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
  const amount = `${isReceived ? "+" : "-"}${display.amount} ${display.symbol}`;

  const row: ActivityRow = {
    id: activity.signature,
    type: isReceived ? "received" : "sent",
    counterparty: display.counterparty,
    amount,
    timestamp: timestamp.time,
    date: timestamp.date,
    icon: display.icon,
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

function mapPositionToTokenRow(position: PortfolioPosition): TokenRow {
  return {
    id: position.asset.mint,
    symbol: position.asset.symbol,
    name: position.asset.name,
    price: formatUsd(position.priceUsd),
    amount: formatTokenBalance(position.publicBalance),
    value: formatUsd(position.publicValueUsd),
    icon: resolveTokenIcon(position),
  };
}

const ENV_LABELS: Record<string, string> = {
  mainnet: "Mainnet",
  devnet: "Devnet",
  localnet: "Localnet",
};

export function useWalletData(params: {
  publicKey: PublicKey | null;
  connected: boolean;
  client: SolanaWalletDataClient;
  solanaEnv: SolanaEnv;
}): WalletDesktopData {
  const { publicKey, connected, client, solanaEnv } = params;
  const walletAddress = publicKey?.toBase58() ?? null;
  const [portfolioSnapshot, setPortfolioSnapshot] =
    useState<PortfolioSnapshot | null>(null);
  const [activities, setActivities] = useState<WalletActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [localRows, setLocalRows] = useState<ActivityRow[]>([]);
  const [localDetails, setLocalDetails] = useState<
    Record<string, TransactionDetail>
  >({});

  // Load local activity from in-memory store when wallet connects
  useEffect(() => {
    if (!walletAddress) {
      setLocalRows([]);
      setLocalDetails({});
      return;
    }
    const stored = localActivityStore.get(walletAddress);
    if (stored) {
      setLocalRows(stored.rows ?? []);
      setLocalDetails(stored.details ?? {});
    }
  }, [walletAddress]);

  const addLocalActivity = useCallback(
    (row: ActivityRow, detail: TransactionDetail) => {
      setLocalDetails((prevDetails) => {
        const nextDetails = { ...prevDetails, [row.id]: detail };
        setLocalRows((prevRows) => {
          const next = [row, ...prevRows];
          if (walletAddress) {
            localActivityStore.set(walletAddress, {
              rows: next,
              details: nextDetails,
            });
          }
          return next;
        });
        return nextDetails;
      });
    },
    [walletAddress]
  );

  useEffect(() => {
    if (!(connected && publicKey)) {
      setPortfolioSnapshot(null);
      setActivities([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void Promise.all([
      client.getPortfolio(publicKey),
      client.getActivity(publicKey, { limit: 25 }),
    ])
      .then(([nextPortfolio, history]) => {
        if (cancelled) return;
        setPortfolioSnapshot(nextPortfolio);
        setActivities(history.activities);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error("Failed to load wallet desktop data", error);
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, connected, publicKey]);

  useEffect(() => {
    if (!(connected && publicKey)) return;

    let closed = false;
    let unsubscribePortfolio: (() => Promise<void>) | null = null;
    let unsubscribeActivity: (() => Promise<void>) | null = null;

    void client
      .subscribePortfolio(
        publicKey,
        (snapshot) => {
          if (!closed) setPortfolioSnapshot(snapshot);
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
        publicKey,
        (activity) => {
          if (closed) return;
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
      if (unsubscribePortfolio) void unsubscribePortfolio();
      if (unsubscribeActivity) void unsubscribeActivity();
    };
  }, [client, connected, publicKey]);

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

  const allTokenRows = useMemo(() => {
    const rows: TokenRow[] = [];
    for (const position of positions) {
      if (position.publicBalance > 0) {
        rows.push(mapPositionToTokenRow(position));
      }
    }

    // Only LOYAL is pinned regardless of balance (3rd position / index 2);
    // every other token appears solely when it has a non-zero balance, so real
    // holdings fill the top instead of zero SOL/USDC placeholders.
    const targetIndex = Math.min(2, rows.length);
    const existingLoylIndex = rows.findIndex((r) => r.id === LOYL_MINT);
    if (existingLoylIndex >= 0) {
      if (existingLoylIndex !== targetIndex) {
        const [loylRow] = rows.splice(existingLoylIndex, 1);
        rows.splice(Math.min(2, rows.length), 0, loylRow);
      }
    } else {
      const loylPosition = positions.find((p) => p.asset.mint === LOYL_MINT);
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
      rows.splice(targetIndex, 0, loylRow);
    }

    return rows;
  }, [positions, loylPriceUsd]);

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

  const mergedActivityData = useMemo(() => {
    const onChainIds = new Set(activityData.rows.map((r) => r.id));
    const uniqueLocalRows = localRows.filter((r) => !onChainIds.has(r.id));
    const rows = [...uniqueLocalRows, ...activityData.rows].sort(
      (a, b) => (b.rawTimestamp ?? 0) - (a.rawTimestamp ?? 0)
    );
    const details = { ...activityData.details, ...localDetails };
    return { rows, details };
  }, [activityData, localRows, localDetails]);

  const balanceHistoryRef = useRef<BalanceHistoryPoint[]>([]);
  const balanceHistoryKeyRef = useRef<string | null>(null);

  const balanceHistory = useMemo((): BalanceHistoryPoint[] => {
    if (activities.length === 0 || totals.totalUsd <= 0) return [];

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
    ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)} · ${
        ENV_LABELS[solanaEnv] ?? "Mainnet"
      }`
    : "No account";

  return {
    walletAddress,
    isConnected: Boolean(connected && walletAddress),
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
    addLocalActivity,
  };
}
