import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import type { TransactionStatus } from "@/types/wallet";

/**
 * Truncate (floor) to specific decimal places - never rounds up
 */
export function truncateDecimals(num: number, decimals: number): string {
  const factor = Math.pow(10, decimals);
  const truncated = Math.floor(num * factor) / factor;
  return truncated.toFixed(decimals);
}

/**
 * Format lamports to SOL balance string with 4 decimal places
 */
export function formatBalance(lamports: number | null): string {
  if (lamports === null) return "0.0000";
  const sol = lamports / LAMPORTS_PER_SOL;
  return truncateDecimals(sol, 4);
}

/**
 * Format lamports to USD value string with 2 decimal places.
 * Returns "—" if price data is unavailable.
 */
export function formatUsdValue(
  lamports: number | null,
  solPriceUsd: number | null
): string {
  if (lamports === null || solPriceUsd === null) return "—";
  const sol = lamports / LAMPORTS_PER_SOL;
  const usd = sol * solPriceUsd;
  return truncateDecimals(usd, 2);
}

/**
 * Format wallet address for display (4 chars...4 chars)
 */
export function formatAddress(address: string | null): string {
  if (!address) return "Loading...";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Format sender/recipient address for display
 */
export function formatSenderAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Format transaction amount in SOL (removes trailing zeros)
 */
export function formatTransactionAmount(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  // Truncate to 4 decimal places, then remove trailing zeros
  return parseFloat(truncateDecimals(sol, 4)).toString();
}

/**
 * Format timestamp to readable date string
 */
export function formatTransactionDate(timestamp: number): string {
  const date = new Date(timestamp);
  return (
    date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

/**
 * Get status text for transaction status
 */
export function getStatusText(
  status: TransactionStatus,
  isIncoming: boolean
): string {
  // For incoming pending transactions, show "Ready to claim"
  if (isIncoming && status === "pending") {
    return "Ready to claim";
  }
  switch (status) {
    case "completed":
      return "Completed";
    case "pending":
      return "Pending";
    case "error":
      return "Failed";
    default:
      return status;
  }
}
