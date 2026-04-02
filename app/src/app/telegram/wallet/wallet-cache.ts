import type { TelegramDeposit } from "@/types/deposits";
import type { IncomingTransaction, Transaction } from "@/types/wallet";

export const walletTransactionsCache = new Map<string, Transaction[]>();

export const HOLDINGS_REFRESH_DEBOUNCE_MS = 750;

// SOL price cache (shared across page visits)
export let cachedSolPriceUsd: number | null = null;
export let solPriceFetchedAt: number | null = null;
const SOL_PRICE_CACHE_TTL = 60_000; // 1 minute

export const getCachedSolPrice = (): number | null => {
  if (cachedSolPriceUsd === null || solPriceFetchedAt === null) return null;
  // Return cached price if within TTL
  if (Date.now() - solPriceFetchedAt < SOL_PRICE_CACHE_TTL) {
    return cachedSolPriceUsd;
  }
  return cachedSolPriceUsd; // Still return stale price, but allow refresh
};

export const setCachedSolPrice = (price: number): void => {
  cachedSolPriceUsd = price;
  solPriceFetchedAt = Date.now();
};

// Incoming transactions cache (keyed by username)
export let cachedUsername: string | null = null;
const incomingTransactionsCache = new Map<string, IncomingTransaction[]>();

export const getCachedIncomingTransactions = (
  username: string | null
): IncomingTransaction[] | null => {
  if (!username) return null;
  return incomingTransactionsCache.get(username) ?? null;
};

export const setCachedIncomingTransactions = (
  username: string | null,
  txns: IncomingTransaction[]
): void => {
  if (!username) return;
  cachedUsername = username;
  incomingTransactionsCache.set(username, txns);
};

export const mapDepositToIncomingTransaction = (
  deposit: TelegramDeposit
): IncomingTransaction => {
  const senderBase58 = deposit.user.toBase58();
  return {
    id: `${senderBase58}-${deposit.lastNonce}`,
    amountLamports: deposit.amount,
    sender: senderBase58,
    username: deposit.username,
  };
};

// Track wallet address at module level for cache lookups on remount
export let cachedWalletAddress: string | null = null;
export const setCachedWalletAddress = (address: string | null): void => {
  cachedWalletAddress = address;
};

// Display currency preference cache
export let cachedDisplayCurrency: "USD" | "SOL" | null = null;
export const setCachedDisplayCurrency = (
  currency: "USD" | "SOL" | null
): void => {
  cachedDisplayCurrency = currency;
};

// Balance background preference cache
export let cachedBalanceBg: string | null | undefined = undefined; // undefined = not loaded yet
export const setCachedBalanceBg = (bg: string | null | undefined): void => {
  cachedBalanceBg = bg;
};

// Check if we have enough cached data to skip loading
export const hasCachedWalletData = (): boolean => {
  if (!cachedWalletAddress) return false;
  const hasPrice = getCachedSolPrice() !== null;
  return hasPrice;
};
