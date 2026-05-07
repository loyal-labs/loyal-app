"use client";

import {
  createSmartAccountVaultsClient,
  sendPreparedWithWallet,
  SOL_SPENDING_LIMIT_MINT,
  type SmartAccountOverview,
  type SmartAccountProposalSnapshot,
  type SmartAccountSignerSnapshot,
  type SmartAccountSpendingLimitSnapshot,
  type SmartAccountVaultSnapshot,
} from "@loyal-labs/smart-account-vaults";
import {
  type ActivityPage,
  NATIVE_SOL_MINT,
  type PortfolioPosition,
  type WalletActivity,
} from "@loyal-labs/solana-wallet";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type {
  Connection,
  SendOptions,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type SmartAccountVaultActivityRouteResponse = {
  accountIndex: number;
  activity: ActivityPage;
};

type SmartAccountRouteErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
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
  canExecute: boolean;
  proposal: SmartAccountProposalSnapshot;
};

export type SmartAccountVaultEntry = {
  accountIndex: number;
  label: string;
  address: string;
  balanceWhole: string;
  balanceFraction: string;
  signers: SmartAccountSignerEntry[];
};

export type SmartAccountSignerEntry = {
  id: string;
  label: string;
  address: string;
  shortAddress: string;
  icon: string;
  balanceWhole: string;
  balanceFraction: string;
  accessLevel: "suggest" | "sign" | "execute";
  accessLabel: string;
  scope: SmartAccountSignerSnapshot["scope"];
  scopeLabel: string;
  permissions: SmartAccountSignerSnapshot["permissions"];
  canInitiate: boolean;
  canVote: boolean;
  canExecute: boolean;
  policyAddress: string | null;
  spendingLimit: SmartAccountSpendingLimitSnapshot | null;
  spendingLimits: SmartAccountSpendingLimitSnapshot[];
};

export type SmartAccountVaultView = {
  entry: SmartAccountVaultEntry;
  tokenRows: TokenRow[];
  activityRows: ActivityRow[];
  transactionDetails: Record<string, TransactionDetail>;
  spendingLimits: SmartAccountSpendingLimitSnapshot[];
};

type SmartAccountVaultActivityView = Pick<
  SmartAccountVaultView,
  "activityRows" | "transactionDetails"
>;

export type SmartAccountSidebarData = {
  overview: SmartAccountOverview | null;
  isLoading: boolean;
  error: string | null;
  vaultEntries: SmartAccountVaultEntry[];
  selectedVaultIndex: number;
  setSelectedVaultIndex: (index: number) => void;
  selectedVault: SmartAccountVaultView | null;
  approvals: SmartAccountApprovalItem[];
  loadVaultActivity: (accountIndex: number) => Promise<void>;
  refresh: () => Promise<void>;
  approveProposal: (proposal: SmartAccountProposalSnapshot) => Promise<void>;
  rejectProposal: (proposal: SmartAccountProposalSnapshot) => Promise<void>;
  executeProposal: (proposal: SmartAccountProposalSnapshot) => Promise<void>;
  addInitiateSigner: (args: { signerAddress: string }) => Promise<void>;
  deleteSigner: (args: {
    accountIndex: number;
    policyAddress?: string | null;
    signerAddress: string;
  }) => Promise<void>;
  setSignerSpendingLimitUsd: (args: {
    accountIndex: number;
    amountUsd: number;
    existingSpendingLimitAddress?: string | null;
    signerAddress: string;
  }) => Promise<void>;
  topUpSignerWithSpendingLimitUsd: (args: {
    accountIndex: number;
    amountUsd: number;
    signerAddress: string;
    spendingLimitAddress: string;
  }) => Promise<void>;
  deleteSignerSpendingLimit: (args: {
    accountIndex: number;
    spendingLimitAddress: string;
    signerAddress: string;
  }) => Promise<void>;
  isActionPending: boolean;
  pendingProposalId: string | null;
  pendingSpendingLimitActionKey: string | null;
};

const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";
const LOYL_ICON_URL =
  "https://avatars.githubusercontent.com/u/210601628?s=200&v=4";

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

function lamportsToUsd(lamports: number, solPriceUsd: number): number {
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

function resolveSolPriceUsd(args: {
  effectiveSolPriceUsd?: number | null;
  positions: PortfolioPosition[];
}): number {
  return (
    args.effectiveSolPriceUsd ??
    resolvePositionByMint(args.positions, NATIVE_SOL_MINT)?.priceUsd ??
    85
  );
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

const AGENT_ICON_COUNT = 26;

function hashAddress(address: string): number {
  let hash = 0;

  for (let index = 0; index < address.length; index += 1) {
    hash = (hash * 31 + address.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getSignerIcon(args: {
  address: string;
  isAuthenticatedUser: boolean;
}): string {
  if (args.isAuthenticatedUser) {
    return "/agents/Agent-03.svg";
  }

  const iconIndex = (hashAddress(args.address) % AGENT_ICON_COUNT) + 1;
  return `/agents/Agent-${String(iconIndex).padStart(2, "0")}.svg`;
}

function getSignerAccessLevel(
  signer: SmartAccountSignerSnapshot
): SmartAccountSignerEntry["accessLevel"] {
  if (signer.canExecute) {
    return "execute";
  }

  if (signer.canVote) {
    return "sign";
  }

  return "suggest";
}

function getSignerAccessLabel(
  signer: SmartAccountSignerSnapshot
): SmartAccountSignerEntry["accessLabel"] {
  if (signer.canExecute) {
    return "Can execute";
  }

  if (signer.canVote) {
    return "Can vote";
  }

  return "Can propose";
}

function resolveSignerSpendingLimit(args: {
  signerAddress: string;
  spendingLimits: SmartAccountSpendingLimitSnapshot[];
}): SmartAccountSpendingLimitSnapshot | null {
  const matchingLimits = args.spendingLimits.filter((spendingLimit) =>
    spendingLimit.signers.includes(args.signerAddress)
  );

  return (
    matchingLimits.find(
      (spendingLimit) =>
        !spendingLimit.isExpired &&
        spendingLimit.mint === SOL_SPENDING_LIMIT_MINT
    ) ??
    matchingLimits.find((spendingLimit) => !spendingLimit.isExpired) ??
    matchingLimits[0] ??
    null
  );
}

function mapSignersToEntries(args: {
  signers: SmartAccountSignerSnapshot[];
  authenticatedWalletAddress: string | null | undefined;
  /**
   * Full portfolio total (USD) for the authenticated user — already includes
   * SPL tokens + shielded balances. When provided, the "User" row in the
   * sidebar shows this instead of just `signer.lamports * solPrice`, so the
   * sidebar matches the wallet detail view.
   */
  authenticatedUserTotalUsd?: number | null;
  solPriceUsd: number;
  spendingLimits?: SmartAccountSpendingLimitSnapshot[];
}): SmartAccountSignerEntry[] {
  let agentCount = 0;
  let signerCount = 0;

  return args.signers.map((signer) => {
    const isAuthenticatedUser =
      !!args.authenticatedWalletAddress &&
      signer.address === args.authenticatedWalletAddress;
    const label = isAuthenticatedUser
      ? "User"
      : signer.scope === "policy"
      ? `Agent ${++agentCount}`
      : `Signer ${++signerCount}`;
    const balanceUsd =
      isAuthenticatedUser &&
      typeof args.authenticatedUserTotalUsd === "number" &&
      Number.isFinite(args.authenticatedUserTotalUsd)
        ? args.authenticatedUserTotalUsd
        : lamportsToUsd(signer.lamports ?? 0, args.solPriceUsd);
    const balance = splitUsd(balanceUsd);

    return {
      id: `${signer.scope}:${signer.consensusAddress}:${signer.address}:${
        signer.policyAddress ?? "root"
      }`,
      label,
      address: signer.address,
      shortAddress: shortAddress(signer.address),
      icon: getSignerIcon({
        address: signer.address,
        isAuthenticatedUser,
      }),
      balanceWhole: balance.whole,
      balanceFraction: balance.fraction,
      accessLevel: getSignerAccessLevel(signer),
      accessLabel: getSignerAccessLabel(signer),
      scope: signer.scope,
      scopeLabel:
        signer.scope === "policy" ? "Constrained policy" : "Root signer",
      permissions: signer.permissions,
      canInitiate: signer.canInitiate,
      canVote: signer.canVote,
      canExecute: signer.canExecute,
      policyAddress: signer.policyAddress,
      spendingLimit: resolveSignerSpendingLimit({
        signerAddress: signer.address,
        spendingLimits: args.spendingLimits ?? [],
      }),
      spendingLimits: (args.spendingLimits ?? []).filter((spendingLimit) =>
        spendingLimit.signers.includes(signer.address)
      ),
    };
  });
}

function mapVaultActivity(
  activity: WalletActivity,
  positions: PortfolioPosition[],
  solPriceUsd: number
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
      const position = resolvePositionByMint(
        positions,
        activity.fromToken.mint
      );
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
      usdValue = formatUsd(lamportsToUsd(activity.amountLamports, solPriceUsd));
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
      usdValue = formatUsd(lamportsToUsd(activity.amountLamports, solPriceUsd));
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
      totalAmountDisplay: formatTokenBalance(position.totalBalance),
      totalValueDisplay: formatUsd(position.totalValueUsd),
      publicAmountDisplay: formatTokenBalance(position.publicBalance),
      publicValueDisplay: formatUsd(position.publicValueUsd),
      securedAmountDisplay: formatTokenBalance(position.securedBalance),
      securedValueDisplay: formatUsd(position.securedValueUsd),
    }));
}

function mapVaultActivityPageToView(
  activityPage: ActivityPage,
  positions: PortfolioPosition[],
  solPriceUsd: number
): SmartAccountVaultActivityView {
  const transactionDetails: Record<string, TransactionDetail> = {};
  const activityRows = activityPage.activities.map((activity) => {
    const mapped = mapVaultActivity(activity, positions, solPriceUsd);
    transactionDetails[mapped.row.id] = mapped.detail;
    return mapped.row;
  });

  return {
    activityRows,
    transactionDetails,
  };
}

function mapVaultToActivityView(
  vault: SmartAccountVaultSnapshot
): SmartAccountVaultActivityView {
  const solPriceUsd =
    vault.portfolio.totals.effectiveSolPriceUsd ??
    resolvePositionByMint(vault.portfolio.positions, NATIVE_SOL_MINT)
      ?.priceUsd ??
    85;

  return mapVaultActivityPageToView(
    vault.activity,
    vault.portfolio.positions,
    solPriceUsd
  );
}

function mapProposalToApprovalItem(
  proposal: SmartAccountProposalSnapshot
): SmartAccountApprovalItem {
  const amount = proposal.summary.amountUi ?? "Pending";
  const isSettingsChange = proposal.summary.kind === "settings_change";
  const isExecutablePolicyProposal =
    proposal.payloadType === "policy_transaction" &&
    (proposal.summary.kind !== "unknown" ||
      proposal.decodedInstructions.length > 0);
  const symbol =
    proposal.summary.symbol ??
    (proposal.summary.kind === "sol_transfer"
      ? "SOL"
      : isSettingsChange
      ? ""
      : "TOKEN");
  const sourceAccountIndex = proposal.accountIndex;

  return {
    id: proposal.proposalAddress,
    title: proposal.summary.title,
    destinationLabel: isSettingsChange
      ? "settings"
      : shortAddress(proposal.summary.destination),
    amount,
    symbol,
    sourceAccountIndex,
    sourceLabel:
      sourceAccountIndex === null
        ? "Unknown vault"
        : `Vault ${sourceAccountIndex}`,
    status: proposal.status,
    canExecute:
      proposal.payloadType === "transaction" ||
      proposal.payloadType === "settings_transaction" ||
      isExecutablePolicyProposal,
    proposal,
  };
}

function compareProposalSnapshotsByRecency(
  left: SmartAccountProposalSnapshot,
  right: SmartAccountProposalSnapshot
) {
  const timestampDelta =
    (right.statusTimestamp ?? 0) - (left.statusTimestamp ?? 0);

  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  const leftIndex = BigInt(left.transactionIndex);
  const rightIndex = BigInt(right.transactionIndex);

  if (leftIndex !== rightIndex) {
    return rightIndex > leftIndex ? 1 : -1;
  }

  return left.proposalAddress.localeCompare(right.proposalAddress);
}

function createWalletAdapterBridge(wallet: ReturnType<typeof useWallet>) {
  if (!wallet.publicKey || !wallet.sendTransaction) {
    return null;
  }

  return {
    publicKey: wallet.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(
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

function resolveVaultSolPriceUsd(
  vault: SmartAccountOverview["vaults"][number] | undefined
): number | null {
  const price =
    vault?.portfolio.totals.effectiveSolPriceUsd ??
    resolvePositionByMint(vault?.portfolio.positions ?? [], NATIVE_SOL_MINT)
      ?.priceUsd ??
    null;

  return typeof price === "number" && Number.isFinite(price) && price > 0
    ? price
    : null;
}

function usdToLamports(amountUsd: number, solPriceUsd: number): bigint {
  const lamports = Math.round((amountUsd / solPriceUsd) * LAMPORTS_PER_SOL);

  return BigInt(Math.max(1, lamports));
}

function usdToTokenRawAmount(args: {
  amountUsd: number;
  decimals: number;
  priceUsd: number;
}): bigint {
  const scale = 10 ** args.decimals;
  const rawAmount = Math.round((args.amountUsd / args.priceUsd) * scale);

  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error("Enter an amount greater than $0.");
  }

  if (!Number.isSafeInteger(rawAmount)) {
    throw new Error("Amount is too large for this token.");
  }

  return BigInt(rawAmount);
}

function tokenRawAmountToNumber(
  amountRaw: string,
  decimals: number
): number | null {
  const rawAmount = Number(amountRaw);
  const scale = 10 ** decimals;

  if (!Number.isFinite(rawAmount) || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }

  return rawAmount / scale;
}

function deriveSpendingLimitPriceUsd(
  spendingLimit: SmartAccountSpendingLimitSnapshot
): number | null {
  if (
    typeof spendingLimit.amountUsd !== "number" ||
    !Number.isFinite(spendingLimit.amountUsd)
  ) {
    return null;
  }

  const amount = tokenRawAmountToNumber(
    spendingLimit.amountRaw,
    spendingLimit.decimals
  );

  if (!amount || amount <= 0) {
    return null;
  }

  const price = spendingLimit.amountUsd / amount;

  return Number.isFinite(price) && price > 0 ? price : null;
}

function resolveSpendingLimitUsdConversion(args: {
  spendingLimit: SmartAccountSpendingLimitSnapshot | null;
  vault: SmartAccountOverview["vaults"][number] | undefined;
}): { decimals: number; priceUsd: number | null; symbol: string } {
  if (
    !args.spendingLimit ||
    args.spendingLimit.mint === SOL_SPENDING_LIMIT_MINT
  ) {
    return {
      decimals: 9,
      priceUsd: resolveVaultSolPriceUsd(args.vault),
      symbol: "SOL",
    };
  }

  const position = resolvePositionByMint(
    args.vault?.portfolio.positions ?? [],
    args.spendingLimit.mint
  );
  const priceUsd =
    position?.priceUsd ?? deriveSpendingLimitPriceUsd(args.spendingLimit);

  return {
    decimals: args.spendingLimit.decimals,
    priceUsd:
      typeof priceUsd === "number" && Number.isFinite(priceUsd) && priceUsd > 0
        ? priceUsd
        : null,
    symbol: args.spendingLimit.symbol || position?.asset.symbol || "TOKEN",
  };
}

async function getSolanaErrorLogs(
  error: unknown,
  connection: Connection
): Promise<string[]> {
  const candidate = error as {
    cause?: unknown;
    getLogs?: (nextConnection: Connection) => Promise<string[]>;
    logs?: string[];
  };

  if (Array.isArray(candidate.logs)) {
    return candidate.logs;
  }

  if (typeof candidate.getLogs === "function") {
    try {
      return await candidate.getLogs(connection);
    } catch {
      return [];
    }
  }

  const cause = candidate.cause as
    | {
        getLogs?: (nextConnection: Connection) => Promise<string[]>;
        logs?: string[];
      }
    | undefined;

  if (Array.isArray(cause?.logs)) {
    return cause.logs;
  }

  if (typeof cause?.getLogs === "function") {
    try {
      return await cause.getLogs(connection);
    } catch {
      return [];
    }
  }

  return [];
}

async function normalizeSpendingLimitError(
  error: unknown,
  connection: Connection
): Promise<Error> {
  const message =
    error instanceof Error
      ? error.message
      : "Failed to submit spending-limit transaction.";
  const logs = await getSolanaErrorLogs(error, connection);
  const combinedLogs = logs.length ? logs.join("\n") : message;
  const lamportsMatch = combinedLogs.match(
    /insufficient lamports (\d+), need (\d+)/
  );

  if (lamportsMatch) {
    const currentLamports = Number(lamportsMatch[1]);
    const neededLamports = Number(lamportsMatch[2]);

    if (
      combinedLogs.includes("Instruction: UseSpendingLimit") ||
      combinedLogs.includes("Instruction: ExecuteTransactionSyncV2")
    ) {
      return new Error(
        `Vault does not have enough SOL for this top-up. Available balance in this transfer step is ${formatSolAmount(
          currentLamports
        )} SOL, but it needs ${formatSolAmount(neededLamports)} SOL.`
      );
    }

    return new Error(
      `Not enough SOL in the connected wallet to pay transaction rent. Current balance available to this step is ${formatSolAmount(
        currentLamports
      )} SOL, but it needs at least ${formatSolAmount(
        neededLamports
      )} SOL plus fees. Top up the wallet and try again.`
    );
  }

  if (
    combinedLogs.includes("SpendingLimitExceeded") ||
    combinedLogs.includes("SpendingLimitInsufficientRemainingAmount") ||
    combinedLogs.includes("SpendingLimitViolatesMaxPerUseConstraint")
  ) {
    return new Error("Top-up amount exceeds the remaining spending limit.");
  }

  if (combinedLogs.includes("sum of account balances before and after")) {
    return new Error(
      "Updating the spending-limit policy failed while the program reallocated accounts. Refresh the wallet and try again."
    );
  }

  if (logs.length) {
    return new Error(`${message}\n${logs.join("\n")}`);
  }

  return error instanceof Error ? error : new Error(message);
}

export function useSmartAccountSidebarData(
  options: { authenticatedUserTotalUsd?: number | null } = {}
): SmartAccountSidebarData {
  const { authenticatedUserTotalUsd } = options;
  const { user } = useAuthSession();
  const { connection } = useConnection();
  const wallet = useWallet();
  const [overview, setOverview] = useState<SmartAccountOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVaultIndex, setSelectedVaultIndex] = useState(0);
  const [isActionPending, setIsActionPending] = useState(false);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(
    null
  );
  const [pendingSpendingLimitActionKey, setPendingSpendingLimitActionKey] =
    useState<string | null>(null);
  const [vaultActivityByAccountIndex, setVaultActivityByAccountIndex] =
    useState<Record<number, SmartAccountVaultActivityView>>({});
  const vaultActivityLoadPromisesRef = useRef<Map<number, Promise<void>>>(
    new Map()
  );

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
        const errorPayload =
          (await response.json().catch(() => null)) as
            | SmartAccountRouteErrorResponse
            | null;
        const message =
          errorPayload?.error?.message ?? "Failed to load smart-account overview.";

        throw new Error(message);
      }

      const payload = (await response.json()) as SmartAccountRouteResponse;
      setOverview(payload.overview);
      setVaultActivityByAccountIndex({});
      vaultActivityLoadPromisesRef.current.clear();
    } catch (nextError) {
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
    setVaultActivityByAccountIndex({});
    vaultActivityLoadPromisesRef.current.clear();
  }, [overview?.settingsPda]);

  const loadVaultActivity = useCallback(
    async (accountIndex: number) => {
      if (!user?.settingsPda) {
        return;
      }

      const existingPromise =
        vaultActivityLoadPromisesRef.current.get(accountIndex);
      if (existingPromise) {
        return existingPromise;
      }

      const promise = (async () => {
        const response = await fetch(
          `/api/smart-accounts/vault-activity?accountIndex=${accountIndex}`,
          {
            credentials: "include",
          }
        );

        if (!response.ok) {
          const errorPayload =
            (await response.json().catch(() => null)) as
              | SmartAccountRouteErrorResponse
              | null;
          const message =
            errorPayload?.error?.message ?? "Failed to load vault activity.";

          throw new Error(message);
        }

        const payload =
          (await response.json()) as SmartAccountVaultActivityRouteResponse;
        const vault = overview?.vaults.find(
          (entry) => entry.accountIndex === payload.accountIndex
        );

        if (!vault) {
          return;
        }

        const solPriceUsd =
          vault.portfolio.totals.effectiveSolPriceUsd ??
          resolvePositionByMint(vault.portfolio.positions, NATIVE_SOL_MINT)
            ?.priceUsd ??
          85;
        const activityView = mapVaultActivityPageToView(
          payload.activity,
          vault.portfolio.positions,
          solPriceUsd
        );
        setVaultActivityByAccountIndex((current) => ({
          ...current,
          [payload.accountIndex]: activityView,
        }));
      })();

      vaultActivityLoadPromisesRef.current.set(accountIndex, promise);

      try {
        await promise;
      } finally {
        vaultActivityLoadPromisesRef.current.delete(accountIndex);
      }
    },
    [overview?.vaults, user?.settingsPda]
  );

  const vaultEntries = useMemo<SmartAccountVaultEntry[]>(() => {
    return (overview?.vaults ?? []).map((vault) => {
      const balance = splitUsd(vault.portfolio.totals.totalUsd);
      const solPriceUsd = resolveSolPriceUsd({
        effectiveSolPriceUsd: vault.portfolio.totals.effectiveSolPriceUsd,
        positions: vault.portfolio.positions,
      });
      const signers = mapSignersToEntries({
        signers: vault.signers ?? [],
        authenticatedWalletAddress: user?.walletAddress,
        authenticatedUserTotalUsd,
        solPriceUsd,
        spendingLimits: vault.spendingLimits ?? [],
      });

      return {
        accountIndex: vault.accountIndex,
        label: `Vault ${vault.accountIndex}`,
        address: vault.address,
        balanceWhole: balance.whole,
        balanceFraction: balance.fraction,
        signers,
      };
    });
  }, [overview?.vaults, user?.walletAddress, authenticatedUserTotalUsd]);

  const selectedVault = useMemo<SmartAccountVaultView | null>(() => {
    const vault =
      overview?.vaults.find(
        (entry) => entry.accountIndex === selectedVaultIndex
      ) ??
      overview?.vaults[0] ??
      null;

    if (!vault) {
      return null;
    }

    const fallbackBalance = splitUsd(vault.portfolio.totals.totalUsd);
    const entry = vaultEntries.find(
      (candidate) => candidate.accountIndex === vault.accountIndex
    ) ?? {
      accountIndex: vault.accountIndex,
      label: `Vault ${vault.accountIndex}`,
      address: vault.address,
      balanceWhole: fallbackBalance.whole,
      balanceFraction: fallbackBalance.fraction,
      signers: mapSignersToEntries({
        signers: vault.signers ?? [],
        authenticatedWalletAddress: user?.walletAddress,
        authenticatedUserTotalUsd,
        solPriceUsd: resolveSolPriceUsd({
          effectiveSolPriceUsd: vault.portfolio.totals.effectiveSolPriceUsd,
          positions: vault.portfolio.positions,
        }),
        spendingLimits: vault.spendingLimits ?? [],
      }),
    };
    const tokenRows = mapVaultToTokenRows(vault.portfolio.positions);
    const activityView =
      vaultActivityByAccountIndex[vault.accountIndex] ??
      mapVaultToActivityView(vault);

    return {
      entry: {
        accountIndex: entry.accountIndex,
        label: entry.label,
        address: entry.address,
        balanceWhole: entry.balanceWhole,
        balanceFraction: entry.balanceFraction,
        signers: entry.signers,
      },
      tokenRows,
      activityRows: activityView.activityRows,
      transactionDetails: activityView.transactionDetails,
      spendingLimits: vault.spendingLimits ?? [],
    };
  }, [
    overview?.vaults,
    selectedVaultIndex,
    user?.walletAddress,
    authenticatedUserTotalUsd,
    vaultActivityByAccountIndex,
    vaultEntries,
  ]);

  const approvals = useMemo(
    () =>
      [...(overview?.proposals ?? [])]
        .sort(compareProposalSnapshotsByRecency)
        .map(mapProposalToApprovalItem),
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
        throw new Error(
          "Connect the authenticated wallet to sign this action."
        );
      }

      if (wallet.publicKey.toBase58() !== user.walletAddress) {
        throw new Error(
          "Connected wallet does not match the authenticated wallet."
        );
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        throw new Error(
          "Connected wallet cannot sign smart-account transactions."
        );
      }

      const client = createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      });
      const sharedArgs = {
        settingsPda: new PublicKey(proposal.consensusAddress),
        transactionIndex: BigInt(proposal.transactionIndex),
        signer: wallet.publicKey,
        feePayer: wallet.publicKey,
      };
      const prepared =
        action === "approve"
          ? await client.prepareApproveProposal(sharedArgs)
          : action === "reject"
          ? await client.prepareRejectProposal(sharedArgs)
          : proposal.payloadType === "settings_transaction"
          ? await client.prepareExecuteSettingsProposal(sharedArgs)
          : proposal.payloadType === "policy_transaction"
          ? await client.prepareExecutePolicyProposal(sharedArgs)
          : proposal.payloadType === "transaction"
          ? await client.prepareExecuteProposal(sharedArgs)
          : (() => {
              throw new Error(
                "This proposal type cannot be executed from the wallet sidebar."
              );
            })();

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
    [connection, overview, refresh, user?.walletAddress, wallet]
  );

  const runSpendingLimitAction = useCallback(
    async (args: {
      actionKey: string;
      prepare: (
        client: ReturnType<typeof createSmartAccountVaultsClient>
      ) => Promise<{
        prepared: Parameters<typeof sendPreparedWithWallet>[0]["prepared"];
      }>;
      requireAuthenticatedWallet?: boolean;
    }) => {
      if (!overview) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      if (!wallet.publicKey) {
        throw new Error("Connect a wallet to sign this action.");
      }

      if (args.requireAuthenticatedWallet ?? true) {
        if (!user?.walletAddress) {
          throw new Error(
            "Connect the authenticated wallet to sign this action."
          );
        }

        if (wallet.publicKey.toBase58() !== user.walletAddress) {
          throw new Error(
            "Connected wallet does not match the authenticated wallet."
          );
        }
      }

      const walletBridge = createWalletAdapterBridge(wallet);
      if (!walletBridge) {
        throw new Error(
          "Connected wallet cannot sign smart-account transactions."
        );
      }

      const client = createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      });
      const { prepared } = await args.prepare(client);

      setIsActionPending(true);
      setPendingSpendingLimitActionKey(args.actionKey);

      try {
        try {
          await sendPreparedWithWallet({
            connection,
            wallet: walletBridge,
            prepared,
            confirm: true,
          });
        } catch (sendError) {
          throw await normalizeSpendingLimitError(sendError, connection);
        }
        await refresh();
      } finally {
        setIsActionPending(false);
        setPendingSpendingLimitActionKey(null);
      }
    },
    [connection, overview, refresh, user?.walletAddress, wallet]
  );

  const setSignerSpendingLimitUsd = useCallback(
    async (args: {
      accountIndex: number;
      amountUsd: number;
      existingSpendingLimitAddress?: string | null;
      signerAddress: string;
    }) => {
      if (!overview || !wallet.publicKey) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      if (!Number.isFinite(args.amountUsd) || args.amountUsd <= 0) {
        throw new Error("Enter a spending limit greater than $0.");
      }

      const vault = overview.vaults.find(
        (entry) => entry.accountIndex === args.accountIndex
      );
      const existingSpendingLimit = args.existingSpendingLimitAddress
        ? vault?.spendingLimits.find(
            (entry) => entry.address === args.existingSpendingLimitAddress
          ) ??
          overview.spendingLimits.find(
            (entry) => entry.address === args.existingSpendingLimitAddress
          ) ??
          null
        : null;

      if (args.existingSpendingLimitAddress && !existingSpendingLimit) {
        throw new Error("Spending limit is not loaded. Refresh and try again.");
      }

      const conversion = resolveSpendingLimitUsdConversion({
        spendingLimit: existingSpendingLimit,
        vault,
      });

      if (!conversion.priceUsd) {
        throw new Error(
          `${conversion.symbol}/USD price is unavailable for this spending limit.`
        );
      }

      const amount = usdToTokenRawAmount({
        amountUsd: args.amountUsd,
        decimals: conversion.decimals,
        priceUsd: conversion.priceUsd,
      });

      await runSpendingLimitAction({
        actionKey: `set:${args.accountIndex}:${args.signerAddress}`,
        prepare: (client) =>
          client.prepareSetSpendingLimitPolicy({
            settingsPda: new PublicKey(overview.settingsPda),
            creator: wallet.publicKey!,
            feePayer: wallet.publicKey!,
            signer: new PublicKey(args.signerAddress),
            accountIndex: args.existingSpendingLimitAddress
              ? undefined
              : args.accountIndex,
            amount,
            period: args.existingSpendingLimitAddress ? undefined : "month",
            existingSpendingLimitPolicy: args.existingSpendingLimitAddress
              ? new PublicKey(args.existingSpendingLimitAddress)
              : null,
          }),
      });
    },
    [overview, runSpendingLimitAction, wallet.publicKey]
  );

  const addInitiateSigner = useCallback(
    async (args: { signerAddress: string }) => {
      if (!overview || !wallet.publicKey) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      const signer = new PublicKey(args.signerAddress);
      const existingSigner = overview.policies
        .filter((policy) => policy.state === "SpendingLimit")
        .flatMap((policy) => policy.signers)
        .find((entry) => entry.address === signer.toBase58());

      if (existingSigner?.canInitiate) {
        return;
      }

      await runSpendingLimitAction({
        actionKey: `add-signer:${signer.toBase58()}`,
        prepare: (client) =>
          client.prepareAddInitiateSigner({
            settingsPda: new PublicKey(overview.settingsPda),
            creator: wallet.publicKey!,
            feePayer: wallet.publicKey!,
            signer,
          }),
      });
    },
    [overview, runSpendingLimitAction, wallet.publicKey]
  );

  const deleteSignerSpendingLimit = useCallback(
    async (args: {
      accountIndex: number;
      spendingLimitAddress: string;
      signerAddress: string;
    }) => {
      if (!overview || !wallet.publicKey) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      await runSpendingLimitAction({
        actionKey: `delete:${args.accountIndex}:${args.signerAddress}`,
        prepare: (client) =>
          client.prepareRemoveSpendingLimitPolicy({
            settingsPda: new PublicKey(overview.settingsPda),
            creator: wallet.publicKey!,
            feePayer: wallet.publicKey!,
            spendingLimitPolicy: new PublicKey(args.spendingLimitAddress),
          }),
      });
    },
    [overview, runSpendingLimitAction, wallet.publicKey]
  );

  const deleteSigner = useCallback(
    async (args: {
      accountIndex: number;
      policyAddress?: string | null;
      signerAddress: string;
    }) => {
      if (!overview || !wallet.publicKey) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      const policyAddress = args.policyAddress;
      if (!policyAddress) {
        throw new Error("Only constrained agent signers can be deleted here.");
      }

      await runSpendingLimitAction({
        actionKey: `delete-signer:${args.accountIndex}:${args.signerAddress}`,
        prepare: (client) =>
          client.prepareRemoveInitiateSigner({
            settingsPda: new PublicKey(overview.settingsPda),
            creator: wallet.publicKey!,
            feePayer: wallet.publicKey!,
            signer: new PublicKey(args.signerAddress),
            accountIndex: args.accountIndex,
            policyPda: new PublicKey(policyAddress),
          }),
      });
    },
    [overview, runSpendingLimitAction, wallet.publicKey]
  );

  const topUpSignerWithSpendingLimitUsd = useCallback(
    async (args: {
      accountIndex: number;
      amountUsd: number;
      signerAddress: string;
      spendingLimitAddress: string;
    }) => {
      if (!overview || !wallet.publicKey) {
        throw new Error("Smart-account overview is not loaded yet.");
      }

      if (!Number.isFinite(args.amountUsd) || args.amountUsd <= 0) {
        throw new Error("Enter a top-up amount greater than $0.");
      }

      const vault = overview.vaults.find(
        (entry) => entry.accountIndex === args.accountIndex
      );
      const spendingLimit =
        vault?.spendingLimits.find(
          (entry) => entry.address === args.spendingLimitAddress
        ) ??
        overview.spendingLimits.find(
          (entry) => entry.address === args.spendingLimitAddress
        ) ??
        null;

      if (!spendingLimit || spendingLimit.mint !== SOL_SPENDING_LIMIT_MINT) {
        throw new Error("A SOL spending limit is required for top-up.");
      }

      if (spendingLimit.isExpired) {
        throw new Error("This spending limit is expired.");
      }

      const connectedWalletAddress = wallet.publicKey.toBase58();
      const policySigner = overview.policies
        .find((policy) => policy.address === spendingLimit.address)
        ?.signers.find((signer) => signer.address === connectedWalletAddress);

      if (!policySigner?.canInitiate) {
        throw new Error(
          "Connected wallet is not authorized to use this spending limit. Connect a wallet listed on this spending-limit policy with proposal access, or add it to the policy first."
        );
      }

      const solPriceUsd = resolveVaultSolPriceUsd(vault);
      if (!solPriceUsd) {
        throw new Error("SOL/USD price is unavailable for this vault.");
      }

      const amount = usdToLamports(args.amountUsd, solPriceUsd);
      const remainingAmount = BigInt(spendingLimit.effectiveRemainingAmountRaw);

      if (amount > remainingAmount) {
        throw new Error("Top-up amount exceeds the remaining spending limit.");
      }

      await runSpendingLimitAction({
        actionKey: `topup:${args.accountIndex}:${args.signerAddress}`,
        prepare: async (client) => ({
          prepared: await client.prepareUseSolSpendingLimitPolicy({
            settingsPda: new PublicKey(overview.settingsPda),
            feePayer: wallet.publicKey!,
            signer: wallet.publicKey!,
            spendingLimitPolicy: new PublicKey(args.spendingLimitAddress),
            destination: new PublicKey(args.signerAddress),
            accountIndex: args.accountIndex,
            amountLamports: amount,
          }),
        }),
        requireAuthenticatedWallet: false,
      });
    },
    [overview, runSpendingLimitAction, wallet.publicKey]
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
    loadVaultActivity,
    refresh,
    approveProposal: (proposal) => runProposalAction(proposal, "approve"),
    rejectProposal: (proposal) => runProposalAction(proposal, "reject"),
    executeProposal: (proposal) => runProposalAction(proposal, "execute"),
    addInitiateSigner,
    deleteSigner,
    setSignerSpendingLimitUsd,
    topUpSignerWithSpendingLimitUsd,
    deleteSignerSpendingLimit,
    isActionPending,
    pendingProposalId,
    pendingSpendingLimitActionKey,
  };
}
