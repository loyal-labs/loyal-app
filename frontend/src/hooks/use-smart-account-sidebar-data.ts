"use client";

import {
  createSmartAccountVaultsClient,
  sendPreparedWithWallet,
  type SmartAccountOverview,
  type SmartAccountProposalSnapshot,
} from "@loyal-labs/smart-account-vaults";
import {
  NATIVE_SOL_MINT,
  type PortfolioPosition,
  type WalletActivity,
} from "@loyal-labs/solana-wallet";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type {
  SendOptions,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ActivityRow,
  TokenRow,
  TransactionDetail,
} from "@/components/wallet-sidebar/types";
import { useAuthSession } from "@/contexts/auth-session-context";
import { getTokenIconUrl } from "@/lib/token-icon";

type SmartAccountRouteResponse = {
  overview: SmartAccountOverview;
};

export type SmartAccountApprovalItem = {
  id: string;
  title: string;
  destinationLabel: string;
  amount: string;
  symbol: string;
  sourceAccountIndex: number | null;
  sourceLabel: string;
  status: SmartAccountProposalSnapshot["status"];
  proposal: SmartAccountProposalSnapshot;
};

export type SmartAccountVaultEntry = {
  accountIndex: number;
  label: string;
  address: string;
  balanceWhole: string;
  balanceFraction: string;
};

export type SmartAccountVaultView = {
  entry: SmartAccountVaultEntry;
  tokenRows: TokenRow[];
  activityRows: ActivityRow[];
  transactionDetails: Record<string, TransactionDetail>;
};

export type SmartAccountSidebarData = {
  overview: SmartAccountOverview | null;
  isLoading: boolean;
  error: string | null;
  vaultEntries: SmartAccountVaultEntry[];
  selectedVaultIndex: number;
  setSelectedVaultIndex: (index: number) => void;
  selectedVault: SmartAccountVaultView | null;
  approvals: SmartAccountApprovalItem[];
  refresh: () => Promise<void>;
  approveProposal: (proposal: SmartAccountProposalSnapshot) => Promise<void>;
  rejectProposal: (proposal: SmartAccountProposalSnapshot) => Promise<void>;
  executeProposal: (proposal: SmartAccountProposalSnapshot) => Promise<void>;
  isActionPending: boolean;
  pendingProposalId: string | null;
};

const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";
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

function splitUsd(value: number | null | undefined) {
  const formatted = formatUsd(value);
  const [whole, fraction] = formatted.split(".");

  return {
    whole: whole ?? "$0",
    fraction: fraction ? `.${fraction}` : ".00",
  };
}

function formatTokenBalance(balance: number): string {
  return balance.toLocaleString("en-US", {
    minimumFractionDigits: balance >= 1 ? 0 : 2,
    maximumFractionDigits: balance >= 1 ? 4 : 6,
  });
}

function formatSolAmount(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function lamportsToUsd(
  lamports: number,
  solPriceUsd: number
): number {
  return (lamports / LAMPORTS_PER_SOL) * solPriceUsd;
}

function tokenAmountToUsd(
  amount: string,
  priceUsd: number | null | undefined
): number | null {
  const parsedAmount = Number.parseFloat(amount);

  if (
    typeof priceUsd !== "number" ||
    !Number.isFinite(priceUsd) ||
    !Number.isFinite(parsedAmount)
  ) {
    return null;
  }

  return parsedAmount * priceUsd;
}

function resolvePositionByMint(
  positions: PortfolioPosition[],
  mint: string
): PortfolioPosition | undefined {
  return positions.find((position) => position.asset.mint === mint);
}

function resolveTokenSymbol(
  position: PortfolioPosition | undefined,
  mint: string
): string {
  if (position?.asset.symbol) {
    return position.asset.symbol;
  }

  if (mint === NATIVE_SOL_MINT) {
    return "SOL";
  }

  return mint === LOYL_MINT ? "LOYAL" : "TOKEN";
}

function formatTimestamp(timestamp: number | null) {
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

function shortAddress(address: string | null): string {
  if (!address) {
    return "Unknown";
  }

  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function mapVaultActivity(
  activity: WalletActivity,
  positions: PortfolioPosition[],
  solPriceUsd: number,
): {
  row: ActivityRow;
  detail: TransactionDetail;
} {
  const timestamp = formatTimestamp(activity.timestamp);
  const isIncoming = activity.direction === "in";
  const type: ActivityRow["type"] =
    activity.type === "secure"
      ? "shielded"
      : activity.type === "unshield"
        ? "unshielded"
        : isIncoming
          ? "received"
          : "sent";
  let baseAmount: string;
  let icon: string;
  let usdValue = "$0.00";

  switch (activity.type) {
    case "token_transfer":
    case "secure":
    case "unshield": {
      const position = resolvePositionByMint(positions, activity.token.mint);
      const symbol = resolveTokenSymbol(position, activity.token.mint);
      baseAmount = `${activity.token.amount} ${symbol}`;
      icon = position
        ? resolveTokenIcon(position)
        : "/hero-new/Wallet-Cover.png";
      usdValue = formatUsd(
        tokenAmountToUsd(activity.token.amount, position?.priceUsd)
      );
      break;
    }
    case "swap": {
      const position = resolvePositionByMint(positions, activity.fromToken.mint);
      const isFromSol = activity.fromToken.mint === NATIVE_SOL_MINT;
      const symbol = position?.asset.symbol ?? (isFromSol ? "SOL" : "TOKEN");
      const priceUsd = position?.priceUsd ?? (isFromSol ? solPriceUsd : null);
      baseAmount = `${activity.fromToken.amount} ${symbol}`;
      icon = position ? resolveTokenIcon(position) : getTokenIconUrl(symbol);
      usdValue = formatUsd(
        tokenAmountToUsd(activity.fromToken.amount, priceUsd)
      );
      break;
    }
    case "sol_transfer":
      baseAmount = `${formatSolAmount(activity.amountLamports)} SOL`;
      icon = getTokenIconUrl("SOL");
      usdValue = formatUsd(
        lamportsToUsd(activity.amountLamports, solPriceUsd)
      );
      break;
    case "program_action":
      if (activity.token) {
        const position = resolvePositionByMint(positions, activity.token.mint);
        const symbol = resolveTokenSymbol(position, activity.token.mint);
        baseAmount = `${activity.token.amount} ${symbol}`;
        icon = position
          ? resolveTokenIcon(position)
          : "/hero-new/Wallet-Cover.png";
        usdValue = formatUsd(
          tokenAmountToUsd(activity.token.amount, position?.priceUsd)
        );
        break;
      }

      baseAmount = `${formatSolAmount(activity.amountLamports)} SOL`;
      icon = getTokenIconUrl("SOL");
      usdValue = formatUsd(
        lamportsToUsd(activity.amountLamports, solPriceUsd)
      );
      break;
  }

  const amount =
    activity.type === "secure" || activity.type === "unshield"
      ? baseAmount
      : `${isIncoming ? "+" : "-"}${baseAmount}`;
  const counterparty =
    activity.type === "program_action"
      ? activity.action
      : activity.counterparty ?? shortAddress(null);

  return {
    row: {
      id: activity.signature,
      type,
      counterparty,
      amount,
      timestamp: timestamp.time,
      date: timestamp.date,
      icon,
      rawTimestamp: activity.timestamp ?? undefined,
    },
    detail: {
      activity: {
        id: activity.signature,
        type,
        counterparty,
        amount,
        timestamp: timestamp.time,
        date: timestamp.date,
        icon,
        rawTimestamp: activity.timestamp ?? undefined,
      },
      usdValue,
      status: activity.status === "failed" ? "Failed" : "Completed",
      networkFee: `${formatSolAmount(activity.feeLamports)} SOL`,
      networkFeeUsd: formatUsd(
        lamportsToUsd(activity.feeLamports, solPriceUsd)
      ),
    },
  };
}

function mapVaultToTokenRows(positions: PortfolioPosition[]): TokenRow[] {
  return positions
    .filter((position) => position.totalBalance > 0)
    .map((position) => ({
      id: position.asset.mint,
      symbol: position.asset.symbol,
      price: formatUsd(position.priceUsd),
      amount: formatTokenBalance(position.totalBalance),
      value: formatUsd(position.totalValueUsd),
      icon: resolveTokenIcon(position),
    }));
}

function mapProposalToApprovalItem(
  proposal: SmartAccountProposalSnapshot
): SmartAccountApprovalItem {
  const amount = proposal.summary.amountUi ?? "Pending";
  const symbol =
    proposal.summary.symbol ??
    (proposal.summary.kind === "sol_transfer" ? "SOL" : "TOKEN");
  const sourceAccountIndex = proposal.accountIndex;

  return {
    id: proposal.proposalAddress,
    title: proposal.summary.title,
    destinationLabel: shortAddress(proposal.summary.destination),
    amount,
    symbol,
    sourceAccountIndex,
    sourceLabel:
      sourceAccountIndex === null ? "Unknown vault" : `Vault ${sourceAccountIndex}`,
    status: proposal.status,
    proposal,
  };
}

function createWalletAdapterBridge(wallet: ReturnType<typeof useWallet>) {
  if (!wallet.publicKey || !wallet.sendTransaction) {
    return null;
  }

  return {
    publicKey: wallet.publicKey,
    signTransaction: async <
      T extends Transaction | VersionedTransaction,
    >(
      transaction: T
    ): Promise<T> => {
      if (!wallet.signTransaction) {
        throw new Error("Connected wallet does not support signTransaction.");
      }

      return wallet.signTransaction(transaction);
    },
    sendTransaction: (
      transaction: Transaction | VersionedTransaction,
      nextConnection: ReturnType<typeof useConnection>["connection"],
      options?: SendOptions
    ) => wallet.sendTransaction!(transaction, nextConnection, options),
  };
}

export function useSmartAccountSidebarData(): SmartAccountSidebarData {
  const { user } = useAuthSession();
  const { connection } = useConnection();
  const wallet = useWallet();
  const [overview, setOverview] = useState<SmartAccountOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVaultIndex, setSelectedVaultIndex] = useState(0);
  const [isActionPending, setIsActionPending] = useState(false);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.settingsPda) {
      setOverview(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/smart-accounts/overview", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load smart-account overview.");
      }

      const payload = (await response.json()) as SmartAccountRouteResponse;
      setOverview(payload.overview);
    } catch (nextError) {
      setOverview(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to load smart-account overview."
      );
    } finally {
      setIsLoading(false);
    }
  }, [user?.settingsPda]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setSelectedVaultIndex(0);
  }, [overview?.settingsPda]);

  const vaultEntries = useMemo<SmartAccountVaultEntry[]>(() => {
    return (overview?.vaults ?? []).map((vault) => {
      const balance = splitUsd(vault.portfolio.totals.totalUsd);

      return {
        accountIndex: vault.accountIndex,
        label: `Vault ${vault.accountIndex}`,
        address: vault.address,
        balanceWhole: balance.whole,
        balanceFraction: balance.fraction,
      };
    });
  }, [overview?.vaults]);

  const selectedVault = useMemo<SmartAccountVaultView | null>(() => {
    const vault =
      overview?.vaults.find((entry) => entry.accountIndex === selectedVaultIndex) ??
      overview?.vaults[0] ??
      null;

    if (!vault) {
      return null;
    }

    const fallbackBalance = splitUsd(vault.portfolio.totals.totalUsd);
    const entry =
      vaultEntries.find((candidate) => candidate.accountIndex === vault.accountIndex) ??
      {
        accountIndex: vault.accountIndex,
        label: `Vault ${vault.accountIndex}`,
        address: vault.address,
        balanceWhole: fallbackBalance.whole,
        balanceFraction: fallbackBalance.fraction,
      };
    const solPriceUsd =
      vault.portfolio.totals.effectiveSolPriceUsd ??
      resolvePositionByMint(vault.portfolio.positions, NATIVE_SOL_MINT)
        ?.priceUsd ??
      85;

    const tokenRows = mapVaultToTokenRows(vault.portfolio.positions);
    const transactionDetails: Record<string, TransactionDetail> = {};
    const activityRows = vault.activity.activities.map((activity) => {
      const mapped = mapVaultActivity(
        activity,
        vault.portfolio.positions,
        solPriceUsd
      );
      transactionDetails[mapped.row.id] = mapped.detail;
      return mapped.row;
    });

    return {
      entry: {
        accountIndex: entry.accountIndex,
        label: entry.label,
        address: entry.address,
        balanceWhole: entry.balanceWhole,
        balanceFraction: entry.balanceFraction,
      },
      tokenRows,
      activityRows,
      transactionDetails,
    };
  }, [overview?.vaults, selectedVaultIndex, vaultEntries]);

  const approvals = useMemo(
    () => (overview?.proposals ?? []).map(mapProposalToApprovalItem),
    [overview?.proposals]
  );

  const runProposalAction = useCallback(
    async (
      proposal: SmartAccountProposalSnapshot,
      action: "approve" | "reject" | "execute"
    ) => {
      if (!overview) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      if (!wallet.publicKey || !user?.walletAddress) {
        throw new Error("Connect the authenticated wallet to sign this action.");
      }

      if (wallet.publicKey.toBase58() !== user.walletAddress) {
        throw new Error("Connected wallet does not match the authenticated wallet.");
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        throw new Error("Connected wallet cannot sign smart-account transactions.");
      }

      const client = createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      });
      const sharedArgs = {
        settingsPda: new PublicKey(overview.settingsPda),
        transactionIndex: BigInt(proposal.transactionIndex),
        signer: wallet.publicKey,
        feePayer: wallet.publicKey,
      };
      const prepared =
        action === "approve"
          ? await client.prepareApproveProposal(sharedArgs)
          : action === "reject"
            ? await client.prepareRejectProposal(sharedArgs)
            : await client.prepareExecuteProposal(sharedArgs);

      setIsActionPending(true);
      setPendingProposalId(proposal.proposalAddress);

      try {
        await sendPreparedWithWallet({
          connection,
          wallet: walletBridge,
          prepared,
          confirm: true,
        });
        await refresh();
      } finally {
        setIsActionPending(false);
        setPendingProposalId(null);
      }
    },
    [
      connection,
      overview,
      refresh,
      user?.walletAddress,
      wallet,
    ]
  );

  return {
    overview,
    isLoading,
    error,
    vaultEntries,
    selectedVaultIndex,
    setSelectedVaultIndex,
    selectedVault,
    approvals,
    refresh,
    approveProposal: (proposal) => runProposalAction(proposal, "approve"),
    rejectProposal: (proposal) => runProposalAction(proposal, "reject"),
    executeProposal: (proposal) => runProposalAction(proposal, "execute"),
    isActionPending,
    pendingProposalId,
  };
}
