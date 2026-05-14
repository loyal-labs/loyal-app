import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import {
  getAccountTransactionHistory,
  listenForAccountTransactions,
} from "@/lib/solana/rpc/get-account-txn-history";
import type { WalletTransfer } from "@/lib/solana/rpc/types";
import { walletTransactionsCache } from "@/lib/solana/wallet-cache";
import type { Transaction } from "@/types/wallet";

const TX_HISTORY_SIGNATURES_PER_PAGE = 25;
const TX_HISTORY_TARGET_TRANSFERS = 60;
const TX_HISTORY_MAX_PAGES = 6;
const TX_HISTORY_CACHE_TTL_MS = 30_000;

type TransactionCacheMeta = {
  fetchedAt: number;
};

const walletTransactionsCacheMeta = new Map<string, TransactionCacheMeta>();
const walletTransactionsInflight = new Map<string, Promise<Transaction[]>>();

type FetchTransfersPage = (
  publicKey: PublicKey,
  options: {
    limit: number;
    before?: string;
    until?: string;
    onlySystemTransfers: boolean;
  },
) => Promise<{ transfers: WalletTransfer[]; nextCursor?: string }>;

export async function fetchWalletTransfersWithPagination(
  publicKey: PublicKey,
  fetchPage: FetchTransfersPage = getAccountTransactionHistory,
  options: {
    until?: string;
    maxPages?: number;
    targetTransfers?: number;
  } = {},
): Promise<WalletTransfer[]> {
  const collected: WalletTransfer[] = [];
  const seenSignatures = new Set<string>();

  let before: string | undefined;
  const maxPages = options.maxPages ?? TX_HISTORY_MAX_PAGES;
  const targetTransfers = options.targetTransfers ?? TX_HISTORY_TARGET_TRANSFERS;

  for (let page = 0; page < maxPages; page++) {
    const { transfers, nextCursor } = await fetchPage(publicKey, {
      limit: TX_HISTORY_SIGNATURES_PER_PAGE,
      before,
      until: options.until,
      onlySystemTransfers: false,
    });

    for (const transfer of transfers) {
      if (!seenSignatures.has(transfer.signature)) {
        seenSignatures.add(transfer.signature);
        collected.push(transfer);
      }
    }

    if (collected.length >= targetTransfers) break;
    if (!nextCursor || nextCursor === before) break;
    before = nextCursor;
  }

  return collected;
}

function getTransactionsCacheKey(walletAddress: string): string {
  return `${getSolanaEnv()}:${walletAddress}`;
}

function isTransactionsCacheFresh(cacheKey: string): boolean {
  const meta = walletTransactionsCacheMeta.get(cacheKey);
  if (!meta) return false;
  return Date.now() - meta.fetchedAt < TX_HISTORY_CACHE_TTL_MS;
}

function getLatestSignature(transactions: Transaction[]): string | undefined {
  return transactions.find((tx) => tx.signature)?.signature;
}

function mergeTransactions(
  currentTransactions: Transaction[],
  incomingTransactions: Transaction[],
): Transaction[] {
  const pending = currentTransactions.filter(
    (tx) => tx.type === "pending" && !tx.signature,
  );
  const bySignature = new Map<string, Transaction>();

  for (const tx of currentTransactions) {
    if (tx.signature) {
      bySignature.set(tx.signature, tx);
    }
  }

  for (const tx of incomingTransactions) {
    if (!tx.signature) continue;
    const existing = bySignature.get(tx.signature);
    if (!existing) {
      bySignature.set(tx.signature, tx);
      continue;
    }
    if (existing.transferType === "swap" && tx.transferType !== "swap") {
      bySignature.set(tx.signature, { ...tx, ...existing });
    } else {
      bySignature.set(tx.signature, { ...existing, ...tx });
    }
  }

  return [...pending, ...bySignature.values()].sort(
    (a, b) => b.timestamp - a.timestamp,
  );
}

type UseWalletTransactionsOptions = {
  /**
   * Called whenever the websocket surfaces a transaction involving the
   * user's wallet. The hook has already merged the transfer into the
   * activity feed; this callback lets the caller kick cross-cutting
   * refreshes (SOL balance, holdings) since a tx usually moves funds
   * but the sockets are scoped to the wallet pubkey mention, not to
   * every touched ATA.
   */
  onWsTransaction?: () => void;
};

export function useWalletTransactions(
  walletAddress: string | null,
  { onWsTransaction }: UseWalletTransactionsOptions = {},
) {
  const [walletTransactions, setWalletTransactions] = useState<Transaction[]>(
    () =>
      walletAddress
        ? (walletTransactionsCache.get(getTransactionsCacheKey(walletAddress)) ??
          [])
        : [],
  );
  const [isFetchingTransactions, setIsFetchingTransactions] = useState(false);
  const onWsTransactionRef = useRef(onWsTransaction);
  onWsTransactionRef.current = onWsTransaction;

  const mapTransferToTransaction = useCallback(
    (transfer: WalletTransfer): Transaction => {
      const isIncoming = transfer.direction === "in";
      const counterparty =
        transfer.counterparty ||
        (isIncoming ? "Unknown sender" : "Unknown recipient");

      const base: Transaction = {
        id: transfer.signature,
        type: isIncoming ? "incoming" : "outgoing",
        transferType: transfer.type,
        amountLamports: transfer.amountLamports,
        tokenMint: transfer.tokenMint,
        tokenAmount: transfer.tokenAmount,
        tokenDecimals: transfer.tokenDecimals,
        sender: isIncoming ? counterparty : undefined,
        recipient: !isIncoming ? counterparty : undefined,
        timestamp: transfer.timestamp ?? Date.now(),
        networkFeeLamports: transfer.feeLamports,
        signature: transfer.signature,
        status: transfer.status === "failed" ? "error" : "completed",
      };

      if (transfer.type === "swap") {
        base.swapFromMint = transfer.swapFromMint;
        base.swapToMint = transfer.swapToMint;
        if (transfer.swapToAmount) {
          base.swapToAmount = parseFloat(transfer.swapToAmount);
        }
      }

      return base;
    },
    [],
  );

  const loadWalletTransactions = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!walletAddress) return;

      const cacheKey = getTransactionsCacheKey(walletAddress);
      const cached = walletTransactionsCache.get(cacheKey);

      if (!force && cached) {
        setWalletTransactions(cached);
        if (isTransactionsCacheFresh(cacheKey)) {
          return;
        }
      }

      const inflight = walletTransactionsInflight.get(cacheKey);
      if (inflight) {
        try {
          const transactions = await inflight;
          setWalletTransactions(transactions);
        } catch (error) {
          console.error("Failed to fetch wallet transactions", error);
        }
        return;
      }

      if (!cached) {
        setIsFetchingTransactions(true);
      }

      const latestSignature = cached ? getLatestSignature(cached) : undefined;
      const fetchPromise = (async () => {
        const transfers = await fetchWalletTransfersWithPagination(
          new PublicKey(walletAddress),
          getAccountTransactionHistory,
          latestSignature ? { until: latestSignature } : {},
        );

        const mappedTransactions: Transaction[] = transfers.map(
          mapTransferToTransaction,
        );

        const mergedTransactions = mergeTransactions(
          walletTransactionsCache.get(cacheKey) ?? [],
          mappedTransactions,
        );
        walletTransactionsCache.set(cacheKey, mergedTransactions);
        walletTransactionsCacheMeta.set(cacheKey, { fetchedAt: Date.now() });
        return mergedTransactions;
      })();

      walletTransactionsInflight.set(cacheKey, fetchPromise);
      try {
        const transactions = await fetchPromise;
        setWalletTransactions((prev) => mergeTransactions(prev, transactions));
      } catch (error) {
        console.error("Failed to fetch wallet transactions", error);
      } finally {
        if (walletTransactionsInflight.get(cacheKey) === fetchPromise) {
          walletTransactionsInflight.delete(cacheKey);
        }
        setIsFetchingTransactions(false);
      }
    },
    [mapTransferToTransaction, walletAddress],
  );

  // Initial transaction load
  useEffect(() => {
    if (!walletAddress) return;
    void loadWalletTransactions();
  }, [walletAddress, loadWalletTransactions]);

  // Subscribe to websocket transaction updates
  useEffect(() => {
    if (!walletAddress) return;

    let isCancelled = false;
    let unsubscribe: (() => Promise<void>) | null = null;

    void (async () => {
      try {
        const cacheKey = getTransactionsCacheKey(walletAddress);
        unsubscribe = await listenForAccountTransactions(
          new PublicKey(walletAddress),
          (transfer) => {
            if (isCancelled) return;
            const mapped = mapTransferToTransaction(transfer);
            setWalletTransactions((prev) => {
              const next = [...prev];

              const matchIndex = mapped.signature
                ? next.findIndex((tx) => tx.signature === mapped.signature)
                : next.findIndex((tx) => tx.id === mapped.id);

              if (matchIndex >= 0) {
                const existing = next[matchIndex];
                if (
                  existing.transferType === "swap" &&
                  mapped.transferType !== "swap"
                ) {
                  next[matchIndex] = { ...mapped, ...existing };
                } else {
                  next[matchIndex] = { ...existing, ...mapped };
                }
              } else {
                next.unshift(mapped);
              }

              const sorted = next.sort((a, b) => b.timestamp - a.timestamp);
              walletTransactionsCache.set(cacheKey, sorted);
              return sorted;
            });
            onWsTransactionRef.current?.();
          },
          { onlySystemTransfers: false },
        );
      } catch (error) {
        console.error("Failed to subscribe to transaction updates", error);
      }
    })();

    return () => {
      isCancelled = true;
      if (unsubscribe) {
        void unsubscribe();
      }
    };
  }, [mapTransferToTransaction, walletAddress]);

  return {
    walletTransactions,
    setWalletTransactions,
    isFetchingTransactions,
    loadWalletTransactions,
  };
}
