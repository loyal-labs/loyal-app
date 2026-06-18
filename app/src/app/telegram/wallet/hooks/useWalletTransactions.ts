import type {
  ProgramActionType,
  WalletActivity,
} from "@loyal-labs/solana-wallet";
import { PublicKey } from "@solana/web3.js";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import type {
  Transaction,
  WalletTransactionTransferType,
} from "@/types/wallet";

import { getTelegramWalletDataClient } from "../solana-wallet-data-client";
import { cachedWalletAddress, walletTransactionsCache } from "../wallet-cache";
import { MOCK_WALLET_TRANSACTIONS, USE_MOCK_DATA } from "../wallet-mock-data";

export function useWalletTransactions(walletAddress: string | null): {
  walletTransactions: Transaction[];
  setWalletTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  isFetchingTransactions: boolean;
  loadWalletTransactions: (opts?: { force?: boolean }) => Promise<void>;
} {
  const [walletTransactions, setWalletTransactions] = useState<Transaction[]>(
    () =>
      USE_MOCK_DATA
        ? MOCK_WALLET_TRANSACTIONS
        : cachedWalletAddress
        ? walletTransactionsCache.get(cachedWalletAddress) ?? []
        : []
  );
  const [isFetchingTransactions, setIsFetchingTransactions] = useState(false);

  const resolveTransferType = useCallback(
    (activity: WalletActivity): WalletTransactionTransferType => {
      switch (activity.type) {
        case "sol_transfer":
        case "token_transfer":
          return "transfer";
        case "swap":
        case "secure":
        case "unshield":
          return activity.type;
        case "program_action":
          return activity.action as ProgramActionType;
      }
    },
    []
  );

  const mapTransferToTransaction = useCallback(
    (activity: WalletActivity): Transaction => {
      const isIncoming = activity.direction === "in";
      const counterparty =
        activity.counterparty ||
        (isIncoming ? "Unknown sender" : "Unknown recipient");

      const base: Transaction = {
        id: activity.signature,
        type: isIncoming ? "incoming" : "outgoing",
        transferType: resolveTransferType(activity),
        amountLamports:
          activity.type === "sol_transfer" ||
          activity.type === "swap" ||
          activity.type === "program_action"
            ? activity.amountLamports
            : 0,
        tokenMint:
          activity.type === "token_transfer" ||
          activity.type === "secure" ||
          activity.type === "unshield"
            ? activity.token.mint
            : activity.type === "program_action"
            ? activity.token?.mint
            : undefined,
        tokenAmount:
          activity.type === "token_transfer" ||
          activity.type === "secure" ||
          activity.type === "unshield"
            ? activity.token.amount
            : activity.type === "program_action"
            ? activity.token?.amount
            : undefined,
        tokenDecimals:
          activity.type === "token_transfer" ||
          activity.type === "secure" ||
          activity.type === "unshield"
            ? activity.token.decimals
            : activity.type === "program_action"
            ? activity.token?.decimals
            : undefined,
        sender: isIncoming ? counterparty : undefined,
        recipient: !isIncoming ? counterparty : undefined,
        timestamp: activity.timestamp ?? Date.now(),
        networkFeeLamports: activity.feeLamports,
        signature: activity.signature,
        status: activity.status === "failed" ? "error" : "completed",
      };

      if (activity.type === "swap") {
        base.swapFromMint = activity.fromToken.mint;
        base.swapToMint = activity.toToken.mint;
        if (activity.toToken.amount) {
          base.swapToAmount = parseFloat(activity.toToken.amount);
        }
      }

      return base;
    },
    [resolveTransferType]
  );

  const loadWalletTransactions = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!walletAddress) return;

      const cached = walletTransactionsCache.get(walletAddress);

      if (!force && cached) {
        // Use cached data immediately, no loading state
        setWalletTransactions(cached);
        return;
      }

      // Only show loading if we don't have cached data to display
      if (!cached) {
        setIsFetchingTransactions(true);
      }
      try {
        const { activities } = await getTelegramWalletDataClient().getActivity(
          new PublicKey(walletAddress),
          {
            limit: 10,
            onlySystemTransfers: false,
          }
        );

        const mappedTransactions: Transaction[] = activities.map(
          mapTransferToTransaction
        );

        setWalletTransactions((prev) => {
          const pending = prev.filter(
            (tx) => tx.type === "pending" && !tx.signature
          );
          const existingBySignature = new Map(
            prev
              .filter((tx) => tx.signature)
              .map((tx) => [tx.signature as string, tx])
          );

          const merged = mappedTransactions.map((tx) => {
            if (!tx.signature) return tx;
            const existing = existingBySignature.get(tx.signature);
            if (!existing) return tx;
            // Preserve app-injected swap data when on-chain data arrives
            if (
              existing.transferType === "swap" &&
              tx.transferType !== "swap"
            ) {
              return { ...tx, ...existing };
            }
            return { ...existing, ...tx };
          });

          const combined = [...pending, ...merged].sort(
            (a, b) => b.timestamp - a.timestamp
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
    [mapTransferToTransaction, walletAddress]
  );

  // Initial transaction load
  useEffect(() => {
    if (USE_MOCK_DATA) return;
    if (!walletAddress) return;
    void loadWalletTransactions();
  }, [walletAddress, loadWalletTransactions]);

  // Subscribe to websocket transaction updates
  useEffect(() => {
    if (USE_MOCK_DATA) return;
    if (!walletAddress) return;

    let isCancelled = false;
    let unsubscribe: (() => Promise<void>) | null = null;

    void (async () => {
      try {
        unsubscribe = await getTelegramWalletDataClient().subscribeActivity(
          new PublicKey(walletAddress),
          (activity) => {
            if (isCancelled) return;
            const mapped = mapTransferToTransaction(activity);
            setWalletTransactions((prev) => {
              const next = [...prev];

              const matchIndex = mapped.signature
                ? next.findIndex((tx) => tx.signature === mapped.signature)
                : next.findIndex((tx) => tx.id === mapped.id);

              if (matchIndex >= 0) {
                const existing = next[matchIndex];
                // Preserve app-injected swap data when on-chain data arrives
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
          { onlySystemTransfers: false, emitInitial: false }
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
