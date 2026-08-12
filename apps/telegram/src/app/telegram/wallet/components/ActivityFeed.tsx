"use client";

import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import {
  resolveTokenIcon,
  type TokenHolding,
} from "@/lib/solana/token-holdings";
import {
  formatSenderAddress,
  formatTransactionAmount,
} from "@/lib/solana/wallet/formatters";
import type { IncomingTransaction, Transaction } from "@/types/wallet";

import { MOCK_ACTIVITY_INFO, USE_MOCK_DATA } from "../wallet-mock-data";

interface ActivityFeedProps {
  limitedActivityItems: Array<
    | { type: "incoming"; transaction: IncomingTransaction }
    | { type: "wallet"; transaction: Transaction }
  >;
  incomingTransactions: IncomingTransaction[];
  walletTransactions: Transaction[];
  tokenHoldings: TokenHolding[];
  isLoading: boolean;
  isFetchingTransactions: boolean;
  isFetchingDeposits: boolean;
  onTransactionClick: (transaction: Transaction) => void;
  onShowAll: () => void;
}

export function ActivityFeed({
  limitedActivityItems,
  incomingTransactions,
  walletTransactions,
  tokenHoldings,
  isLoading,
  isFetchingTransactions,
  isFetchingDeposits,
  onTransactionClick,
  onShowAll,
}: ActivityFeedProps) {
  // Track seen transaction IDs to detect new ones for animation
  const seenTransactionIdsRef = useRef<Set<string>>(new Set());
  const [newTransactionIds, setNewTransactionIds] = useState<Set<string>>(
    new Set()
  );

  // Detect new transactions for animation
  useEffect(() => {
    const currentIds = new Set(
      limitedActivityItems.map((item) => item.transaction.id)
    );
    const previousIds = seenTransactionIdsRef.current;

    // Find newly added transactions
    const newIds = new Set<string>();
    for (const id of currentIds) {
      if (!previousIds.has(id)) {
        newIds.add(id);
      }
    }

    // Update seen transactions
    seenTransactionIdsRef.current = currentIds;

    // If we have new transactions, mark them for animation
    if (newIds.size > 0) {
      setNewTransactionIds(newIds);

      // Clear the new status after animation completes (500ms)
      const timer = setTimeout(() => {
        setNewTransactionIds(new Set());
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [limitedActivityItems]);

  const hasNoTransactions =
    incomingTransactions.length === 0 && walletTransactions.length === 0;
  const isActivityLoading =
    isLoading ||
    (isFetchingTransactions && walletTransactions.length === 0) ||
    (isFetchingDeposits && incomingTransactions.length === 0);

  // Loading state - show skeleton transaction cards
  if (isActivityLoading) {
    return (
      <>
        <div className="px-3 pt-3 pb-2 flex items-center justify-between">
          <p className="text-base font-medium text-black leading-5 tracking-[-0.176px]">
            Activity
          </p>
        </div>
        <div className="flex-1 px-4 pb-4">
          <div className="flex flex-col">
            {/* Skeleton Transaction Card 1 */}
            <div className="flex items-center px-4 rounded-2xl overflow-hidden">
              <div className="py-1.5 pr-3">
                <div className="w-12 h-12 rounded-full bg-black/5 animate-pulse" />
              </div>
              <div className="flex-1 py-2.5 flex flex-col gap-1.5">
                <div className="w-20 h-5 bg-black/5 animate-pulse rounded" />
                <div className="w-28 h-4 bg-black/5 animate-pulse rounded" />
              </div>
              <div className="flex flex-col items-end gap-1.5 py-2.5 pl-3">
                <div className="w-16 h-5 bg-black/5 animate-pulse rounded" />
                <div className="w-12 h-4 bg-black/5 animate-pulse rounded" />
              </div>
            </div>
            {/* Skeleton Transaction Card 2 */}
            <div className="flex items-center px-4 rounded-2xl overflow-hidden">
              <div className="py-1.5 pr-3">
                <div className="w-12 h-12 rounded-full bg-black/5 animate-pulse" />
              </div>
              <div className="flex-1 py-2.5 flex flex-col gap-1.5">
                <div className="w-16 h-5 bg-black/5 animate-pulse rounded" />
                <div className="w-24 h-4 bg-black/5 animate-pulse rounded" />
              </div>
              <div className="flex flex-col items-end gap-1.5 py-2.5 pl-3">
                <div className="w-20 h-5 bg-black/5 animate-pulse rounded" />
                <div className="w-14 h-4 bg-black/5 animate-pulse rounded" />
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // No transactions - show empty state
  if (hasNoTransactions) {
    return (
      <div className="flex-1">
        {/* Activity header */}
        <div className="px-3 pt-3 pb-2 flex items-center justify-between">
          <p className="text-base font-medium text-black leading-5 tracking-[-0.176px]">
            Activity
          </p>
        </div>
        {/* Empty transactions state */}
        <div className="px-4 pb-36">
          <div className="flex flex-col gap-4 items-center justify-center px-8 py-6 rounded-[20px]">
            <Image src="/dogs/dog-cry.png" alt="" width={60} height={48} />
            <p
              className="text-[17px] leading-[22px] text-center"
              style={{ color: "rgba(60, 60, 67, 0.6)" }}
            >
              You don&apos;t have any transactions yet
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Normal state with transactions
  return (
    <>
      <div className="px-3 pt-3 pb-2">
        <p className="text-base font-medium text-black leading-5 tracking-[-0.176px]">
          Activity
        </p>
      </div>
      <div className="flex-1 pb-4">
        <div className="flex flex-col pb-36">
          <AnimatePresence initial={false} mode="popLayout">
            {limitedActivityItems.map((item) => {
              const isNewTransaction = newTransactionIds.has(
                item.transaction.id
              );

              if (item.type === "incoming") {
                const transaction = item.transaction;
                return (
                  <motion.div
                    key={transaction.id}
                    layout
                    initial={
                      isNewTransaction
                        ? { opacity: 0, scale: 0.85, y: -10 }
                        : false
                    }
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{
                      layout: {
                        type: "spring",
                        stiffness: 500,
                        damping: 35,
                      },
                      opacity: { duration: 0.25 },
                      scale: {
                        duration: 0.3,
                        ease: [0.34, 1.56, 0.64, 1],
                      },
                    }}
                    className="flex items-center px-4 rounded-2xl overflow-hidden w-full"
                  >
                    {/* Left - Icon */}
                    <div className="py-1.5 pr-3">
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center"
                        style={{
                          background: "rgba(50, 229, 94, 0.15)",
                        }}
                      >
                        <ArrowDown
                          className="w-7 h-7"
                          strokeWidth={1.5}
                          style={{ color: "#32e55e" }}
                        />
                      </div>
                    </div>

                    {/* Middle - Text */}
                    <div className="flex-1 py-2.5 flex flex-col gap-0.5">
                      <p className="text-base text-black leading-5">
                        Receiving
                      </p>
                      <p
                        className="text-[13px] leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        {formatTransactionAmount(transaction.amountLamports)}{" "}
                        SOL from {formatSenderAddress(transaction.sender)}
                      </p>
                    </div>

                    {/* Right - Claiming Badge with pulse animation */}
                    <div className="py-2.5 pl-3">
                      <motion.div
                        className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm leading-5"
                        style={{
                          background: "rgba(50, 229, 94, 0.15)",
                          color: "#32e55e",
                        }}
                        animate={{ opacity: [1, 0.4, 1] }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                      >
                        Claiming...
                      </motion.div>
                    </div>
                  </motion.div>
                );
              }

              // Wallet transaction
              const transaction = item.transaction;
              const isIncoming = transaction.type === "incoming";
              const isPending = transaction.type === "pending";
              const mockInfo = USE_MOCK_DATA
                ? MOCK_ACTIVITY_INFO[transaction.id]
                : undefined;
              const isSecureTransaction = transaction.transferType === "secure";
              const isUnshieldTransaction =
                transaction.transferType === "unshield";
              const isSecureOrUnshield =
                isSecureTransaction || isUnshieldTransaction;
              const transferTypeLabel =
                transaction.transferType === "store"
                  ? "Store data"
                  : transaction.transferType === "verify_telegram_init_data"
                  ? "Verify data"
                  : null;
              const counterparty = isIncoming
                ? transaction.sender || "Unknown sender"
                : transaction.recipient || "Unknown recipient";
              const isUnknownRecipient = counterparty
                .toLowerCase()
                .startsWith("unknown recipient");
              const formattedCounterparty = isUnknownRecipient
                ? counterparty
                : counterparty.startsWith("@")
                ? counterparty
                : formatSenderAddress(counterparty);
              const isEffectivelyZero =
                Math.abs(transaction.amountLamports) < LAMPORTS_PER_SOL / 10000; // below 0.0001 SOL displays as 0
              const amountPrefix = isEffectivelyZero
                ? ""
                : isIncoming
                ? "+"
                : "\u2212";
              const amountColor = isIncoming
                ? "#32e55e"
                : isPending
                ? "#00b1fb"
                : "#000";
              const timestamp = new Date(transaction.timestamp);

              // Compact view for store/verify transactions
              const isCompactTransaction = transferTypeLabel !== null;

              if (isCompactTransaction) {
                return (
                  <motion.button
                    key={transaction.id}
                    layout
                    initial={
                      isNewTransaction
                        ? { opacity: 0, scale: 0.85, y: -10 }
                        : false
                    }
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{
                      layout: {
                        type: "spring",
                        stiffness: 500,
                        damping: 35,
                      },
                      opacity: { duration: 0.25 },
                      scale: {
                        duration: 0.3,
                        ease: [0.34, 1.56, 0.64, 1],
                      },
                    }}
                    onClick={() => onTransactionClick(transaction)}
                    className="flex items-center py-2 px-4 rounded-2xl overflow-hidden w-full text-left active:opacity-80 transition-opacity"
                  >
                    {/* Left - Text */}
                    <div className="flex-1 flex items-center">
                      <p
                        className="text-sm leading-5"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        {transferTypeLabel}
                      </p>
                    </div>

                    {/* Right - Date only */}
                    <div className="pl-3">
                      <p
                        className="text-[13px] leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.4)" }}
                      >
                        {timestamp.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                        ,{" "}
                        {timestamp.toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </motion.button>
                );
              }

              // Secure/Unshield transaction view
              if (isSecureOrUnshield) {
                const secureHolding = transaction.tokenMint
                  ? tokenHoldings.find((h) => h.mint === transaction.tokenMint)
                  : undefined;
                const secureIcon =
                  transaction.secureTokenIcon ||
                  (transaction.tokenMint
                    ? resolveTokenIcon({
                        mint: transaction.tokenMint,
                        imageUrl: secureHolding?.imageUrl,
                      })
                    : "/tokens/solana-sol-logo.png");
                const secureSymbol =
                  transaction.secureTokenSymbol ||
                  secureHolding?.symbol ||
                  "Token";
                const secureAmount =
                  transaction.secureAmount ??
                  (transaction.tokenAmount
                    ? parseFloat(transaction.tokenAmount)
                    : null);

                return (
                  <motion.button
                    key={transaction.id}
                    layout
                    initial={
                      isNewTransaction
                        ? { opacity: 0, scale: 0.85, y: -10 }
                        : false
                    }
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{
                      layout: {
                        type: "spring",
                        stiffness: 500,
                        damping: 35,
                      },
                      opacity: { duration: 0.25 },
                      scale: {
                        duration: 0.3,
                        ease: [0.34, 1.56, 0.64, 1],
                      },
                    }}
                    onClick={() => onTransactionClick(transaction)}
                    className="flex items-center px-4 rounded-2xl overflow-hidden w-full text-left active:opacity-80 transition-opacity"
                  >
                    {/* Left - Icon */}
                    <div className="py-1.5 pr-3">
                      <div className="w-12 h-12 relative">
                        <div className="absolute left-0 top-0 w-8 h-8 rounded-full overflow-hidden bg-[#f2f2f7]">
                          <Image
                            src={secureIcon}
                            alt={secureSymbol}
                            fill
                            className="object-cover"
                          />
                        </div>
                        <div className="absolute bottom-0 right-0 w-8 h-8">
                          <Image
                            src={
                              isSecureTransaction
                                ? "/icons/Shield_32.png"
                                : "/icons/Unshield_32.png"
                            }
                            alt={
                              isSecureTransaction ? "Shielded" : "Unshielded"
                            }
                            width={32}
                            height={32}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Middle - Text */}
                    <div className="flex-1 py-2.5 flex flex-col gap-0.5">
                      <p className="text-base text-black leading-5">
                        {isSecureTransaction ? "Shielded" : "Unshielded"}
                      </p>
                      <p
                        className="text-[13px] leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        {secureSymbol}
                      </p>
                    </div>

                    {/* Right - Value */}
                    <div className="flex flex-col items-end gap-0.5 py-2.5 pl-3">
                      <p className="text-base leading-5 text-black">
                        {secureAmount != null
                          ? `${secureAmount.toLocaleString("en-US", {
                              maximumFractionDigits: 4,
                            })} ${secureSymbol}`
                          : `${formatTransactionAmount(
                              transaction.amountLamports
                            )} SOL`}
                      </p>
                      <p
                        className="text-[13px] leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        {timestamp.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                        ,{" "}
                        {timestamp.toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </motion.button>
                );
              }

              // Swap transaction view
              if (transaction.transferType === "swap") {
                const swapFromHolding = transaction.swapFromMint
                  ? tokenHoldings.find(
                      (h) => h.mint === transaction.swapFromMint
                    )
                  : undefined;
                const swapToHolding = transaction.swapToMint
                  ? tokenHoldings.find((h) => h.mint === transaction.swapToMint)
                  : undefined;
                const swapFromIcon = transaction.swapFromMint
                  ? resolveTokenIcon({
                      mint: transaction.swapFromMint,
                      imageUrl: swapFromHolding?.imageUrl,
                    })
                  : "/tokens/solana-sol-logo.png";
                const swapToIcon = transaction.swapToMint
                  ? resolveTokenIcon({
                      mint: transaction.swapToMint,
                      imageUrl: swapToHolding?.imageUrl,
                    })
                  : "/tokens/solana-sol-logo.png";
                const swapFromSymbol =
                  transaction.swapFromSymbol || swapFromHolding?.symbol || "?";
                const swapToSymbol =
                  transaction.swapToSymbol || swapToHolding?.symbol || "?";
                const swapToAmount = transaction.swapToAmount;

                return (
                  <motion.button
                    key={transaction.id}
                    layout
                    initial={
                      isNewTransaction
                        ? { opacity: 0, scale: 0.85, y: -10 }
                        : false
                    }
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{
                      layout: {
                        type: "spring",
                        stiffness: 500,
                        damping: 35,
                      },
                      opacity: { duration: 0.25 },
                      scale: {
                        duration: 0.3,
                        ease: [0.34, 1.56, 0.64, 1],
                      },
                    }}
                    onClick={() => onTransactionClick(transaction)}
                    className="flex items-center px-4 rounded-2xl overflow-hidden w-full text-left active:opacity-80 transition-opacity"
                  >
                    {/* Swap token icons - from (back) + to (front) */}
                    <div className="py-1.5 pr-3">
                      <div className="w-12 h-12 relative">
                        <div className="absolute left-0.5 top-0.5 w-7 h-7 rounded-full border-2 border-white overflow-hidden bg-[#f2f2f7]">
                          <Image
                            src={swapFromIcon}
                            alt={swapFromSymbol}
                            fill
                            className="object-cover"
                          />
                        </div>
                        <div className="absolute right-0.5 bottom-0.5 w-7 h-7 rounded-full border-2 border-white overflow-hidden bg-[#f2f2f7]">
                          <Image
                            src={swapToIcon}
                            alt={swapToSymbol}
                            fill
                            className="object-cover"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Middle - Text */}
                    <div className="flex-1 py-2.5 flex flex-col gap-0.5">
                      <p className="text-base text-black leading-5">Swap</p>
                      <p
                        className="text-[13px] leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        {swapFromSymbol} to {swapToSymbol}
                      </p>
                    </div>

                    {/* Right - Value */}
                    <div className="flex flex-col items-end gap-0.5 py-2.5 pl-3">
                      <p
                        className="text-base leading-5"
                        style={{ color: "#32e55e" }}
                      >
                        {swapToAmount != null
                          ? `+${swapToAmount.toLocaleString("en-US", {
                              maximumFractionDigits: 4,
                            })} ${swapToSymbol}`
                          : "Swap"}
                      </p>
                      <p
                        className="text-[13px] leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        {timestamp.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                        ,{" "}
                        {timestamp.toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </motion.button>
                );
              }

              return (
                <motion.button
                  key={transaction.id}
                  layout
                  initial={
                    isNewTransaction
                      ? { opacity: 0, scale: 0.85, y: -10 }
                      : false
                  }
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{
                    layout: {
                      type: "spring",
                      stiffness: 500,
                      damping: 35,
                    },
                    opacity: { duration: 0.25 },
                    scale: {
                      duration: 0.3,
                      ease: [0.34, 1.56, 0.64, 1],
                    },
                  }}
                  onClick={() => onTransactionClick(transaction)}
                  className="flex items-center px-4 rounded-2xl overflow-hidden w-full text-left active:opacity-80 transition-opacity"
                >
                  {/* Left - Icon */}
                  <div className="py-1.5 pr-3">
                    {isPending ? (
                      <div className="w-12 h-12 rounded-full overflow-hidden relative">
                        <Image
                          src="/loyal-shield.png"
                          alt="To be claimed"
                          fill
                          className="object-cover"
                        />
                      </div>
                    ) : mockInfo ? (
                      <div className="w-12 h-12 rounded-full overflow-hidden relative bg-[#f2f2f7]">
                        <Image
                          src={mockInfo.tokenIcon}
                          alt={mockInfo.tokenSymbol}
                          fill
                          className="object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-full overflow-hidden relative">
                        <Image
                          src="/tokens/solana-sol-logo.png"
                          alt="SOL"
                          fill
                          className="object-cover"
                        />
                      </div>
                    )}
                  </div>

                  {/* Middle - Text */}
                  <div className="flex-1 py-2.5 flex flex-col gap-0.5">
                    <p className="text-base text-black leading-5">
                      {mockInfo
                        ? mockInfo.label
                        : isIncoming
                        ? "Received"
                        : isPending
                        ? "To be claimed"
                        : "Sent"}
                    </p>
                    {mockInfo ? (
                      <p
                        className="text-[13px] leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        {mockInfo.subtitle}
                      </p>
                    ) : (
                      !(
                        isPending === false &&
                        !isIncoming &&
                        isUnknownRecipient
                      ) && (
                        <p
                          className="text-[13px] leading-4"
                          style={{ color: "rgba(60, 60, 67, 0.6)" }}
                        >
                          {isIncoming ? "from" : isPending ? "by" : "to"}{" "}
                          {formattedCounterparty}
                        </p>
                      )
                    )}
                  </div>

                  {/* Right - Value */}
                  <div className="flex flex-col items-end gap-0.5 py-2.5 pl-3">
                    <p
                      className="text-base leading-5"
                      style={{ color: amountColor }}
                    >
                      {mockInfo
                        ? mockInfo.displayAmount
                        : `${amountPrefix}${
                            isEffectivelyZero
                              ? "0"
                              : formatTransactionAmount(
                                  transaction.amountLamports
                                )
                          } SOL`}
                    </p>
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      {timestamp.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                      ,{" "}
                      {timestamp.toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>

          {/* Show All button */}
          {incomingTransactions.length + walletTransactions.length > 10 && (
            <button
              onClick={() => {
                if (hapticFeedback.impactOccurred.isAvailable()) {
                  hapticFeedback.impactOccurred("light");
                }
                onShowAll();
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium leading-5"
              style={{
                background: "rgba(249, 54, 60, 0.14)",
                color: "#f9363c",
              }}
            >
              Show All
            </button>
          )}
        </div>
      </div>
    </>
  );
}
