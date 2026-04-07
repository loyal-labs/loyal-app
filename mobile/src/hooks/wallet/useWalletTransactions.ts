import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";

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

type FetchTransfersPage = (
  publicKey: PublicKey,
  options: {
    limit: number;
    before?: string;
    onlySystemTransfers: boolean;
  },
) => Promise<{ transfers: WalletTransfer[]; nextCursor?: string }>;

export async function fetchWalletTransfersWithPagination(
  publicKey: PublicKey,
  fetchPage: FetchTransfersPage = getAccountTransactionHistory,
): Promise<WalletTransfer[]> {
  const collected: WalletTransfer[] = [];
  const seenSignatures = new Set<string>();

  let before: string | undefined;
  for (let page = 0; page < TX_HISTORY_MAX_PAGES; page++) {
    const { transfers, nextCursor } = await fetchPage(publicKey, {
      limit: TX_HISTORY_SIGNATURES_PER_PAGE,
      before,
      onlySystemTransfers: false,
    });

    for (const transfer of transfers) {
      if (!seenSignatures.has(transfer.signature)) {
        seenSignatures.add(transfer.signature);
        collected.push(transfer);
      }
    }

    if (collected.length >= TX_HISTORY_TARGET_TRANSFERS) break;
    if (!nextCursor || nextCursor === before) break;
    before = nextCursor;
  }

  return collected;
}

export function useWalletTransactions(walletAddress: string | null) {
  const [walletTransactions, setWalletTransactions] = useState<Transaction[]>(
    () =>
      walletAddress
        ? walletTransactionsCache.get(walletAddress) ?? []
        : [],
  );
  const [isFetchingTransactions, setIsFetchingTransactions] = useState(false);

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

      const cached = walletTransactionsCache.get(walletAddress);

      if (!force && cached) {
        setWalletTransactions(cached);
        if (cached.length >= TX_HISTORY_TARGET_TRANSFERS) {
          return;
        }
      }

      if (!cached) {
        setIsFetchingTransactions(true);
      }
      try {
        const transfers = await fetchWalletTransfersWithPagination(
          new PublicKey(walletAddress),
        );

        const mappedTransactions: Transaction[] = transfers.map(
          mapTransferToTransaction,
        );

        setWalletTransactions((prev) => {
          const pending = prev.filter(
            (tx) => tx.type === "pending" && !tx.signature,
          );
          const existingBySignature = new Map(
            prev
              .filter((tx) => tx.signature)
              .map((tx) => [tx.signature as string, tx]),
          );

          const merged = mappedTransactions.map((tx) => {
            if (!tx.signature) return tx;
            const existing = existingBySignature.get(tx.signature);
            if (!existing) return tx;
            if (
              existing.transferType === "swap" &&
              tx.transferType !== "swap"
            ) {
              return { ...tx, ...existing };
            }
            return { ...existing, ...tx };
          });

          const combined = [...pending, ...merged].sort(
            (a, b) => b.timestamp - a.timestamp,
          );
          walletTransactionsCache.set(walletAddress, combined);
          return combined;
        });
      } catch (error) {
        console.error("Failed to fetch wallet transactions", error);
      } finally {
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
              walletTransactionsCache.set(walletAddress, sorted);
              return sorted;
            });
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
