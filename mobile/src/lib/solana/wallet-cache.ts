import type { Transaction } from "@/types/wallet";

import { mmkv } from "@/lib/storage";

import { BALANCE_BG_KEY, DISPLAY_CURRENCY_KEY } from "./constants";
import { subscribeToWalletBalance } from "./wallet/wallet-details";

// --- In-memory caches (not persisted) ---

export const walletTransactionsCache = new Map<string, Transaction[]>();
export const walletBalanceListeners = new Set<(lamports: number) => void>();

export let walletBalanceSubscriptionPromise: Promise<
  () => Promise<void>
> | null = null;

export const HOLDINGS_REFRESH_DEBOUNCE_MS = 750;

// --- Wallet address (MMKV-backed) ---

const WALLET_ADDRESS_KEY = "walletAddress";

export let cachedWalletAddress: string | null =
  mmkv.getString(WALLET_ADDRESS_KEY) ?? null;

export const setCachedWalletAddress = (address: string | null): void => {
  cachedWalletAddress = address;
  if (address) {
    mmkv.setString(WALLET_ADDRESS_KEY, address);
  } else {
    mmkv.delete(WALLET_ADDRESS_KEY);
  }
};

// --- Wallet balance (MMKV-backed, keyed by address) ---

const balanceKey = (addr: string) => `walletBalance:${addr}`;

export const getCachedWalletBalance = (
  walletAddress: string | null,
): number | null => {
  if (!walletAddress) return null;
  const cached = mmkv.getNumber(balanceKey(walletAddress));
  return typeof cached === "number" ? cached : null;
};

export const setCachedWalletBalance = (
  walletAddress: string | null,
  lamports: number,
): void => {
  if (!walletAddress) return;
  mmkv.setNumber(balanceKey(walletAddress), lamports);
};

// --- SOL price (MMKV-backed with TTL) ---

const SOL_PRICE_KEY = "cachedSolPriceUsd";
const SOL_PRICE_TS_KEY = "solPriceFetchedAt";
const SOL_PRICE_CACHE_TTL = 60_000;

export const getCachedSolPrice = (): number | null => {
  const price = mmkv.getNumber(SOL_PRICE_KEY);
  if (typeof price !== "number") return null;
  const ts = mmkv.getNumber(SOL_PRICE_TS_KEY);
  // Return cached price regardless of TTL (caller may refresh in bg)
  if (typeof ts === "number" && Date.now() - ts < SOL_PRICE_CACHE_TTL) {
    return price;
  }
  return price; // stale but still returned
};

export const setCachedSolPrice = (price: number): void => {
  mmkv.setNumber(SOL_PRICE_KEY, price);
  mmkv.setNumber(SOL_PRICE_TS_KEY, Date.now());
};

// --- Balance subscription ---

export const ensureWalletBalanceSubscription = async (
  walletAddress: string,
) => {
  if (walletBalanceSubscriptionPromise) {
    return walletBalanceSubscriptionPromise;
  }

  walletBalanceSubscriptionPromise = subscribeToWalletBalance((lamports) => {
    setCachedWalletBalance(walletAddress, lamports);
    walletBalanceListeners.forEach((listener) => listener(lamports));
  }).catch((error) => {
    walletBalanceSubscriptionPromise = null;
    throw error;
  });

  return walletBalanceSubscriptionPromise;
};

// --- Display currency preference (MMKV-backed) ---

export const getCachedDisplayCurrency = (): "USD" | "SOL" | null => {
  const val = mmkv.getString(DISPLAY_CURRENCY_KEY);
  if (val === "USD" || val === "SOL") return val;
  return null;
};

export const setCachedDisplayCurrency = (
  currency: "USD" | "SOL" | null,
): void => {
  if (currency) {
    mmkv.setString(DISPLAY_CURRENCY_KEY, currency);
  } else {
    mmkv.delete(DISPLAY_CURRENCY_KEY);
  }
};

// --- Balance background preference (MMKV-backed) ---

export const getCachedBalanceBg = (): string | null | undefined => {
  if (!mmkv.contains(BALANCE_BG_KEY)) return undefined; // not loaded yet
  const val = mmkv.getString(BALANCE_BG_KEY);
  if (val === "none") return null;
  return val ?? null;
};

export const setCachedBalanceBg = (bg: string | null | undefined): void => {
  if (bg === undefined) return;
  mmkv.setString(BALANCE_BG_KEY, bg ?? "none");
};

// --- Check if we have enough cached data ---

export const hasCachedWalletData = (): boolean => {
  if (!cachedWalletAddress) return false;
  const hasBalance = getCachedWalletBalance(cachedWalletAddress) !== null;
  const hasPrice = getCachedSolPrice() !== null;
  return hasBalance && hasPrice;
};
