"use client";

import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { hapticFeedback, shareURL } from "@telegram-apps/sdk-react";
import { Check, ShieldAlert, X } from "lucide-react";
import Image from "next/image";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useTelegramSafeArea } from "@/hooks/useTelegramSafeArea";
import { SOLANA_FEE_SOL } from "@/lib/constants";
import { getDeposit } from "@/lib/solana/deposits/get-deposit";
import {
  getExplorerTxUrl,
  getSolscanAccountUrl,
} from "@/lib/solana/rpc/explorer";
import type { TokenHolding } from "@/lib/solana/token-holdings";
import { resolveTokenInfo } from "@/lib/solana/token-holdings/resolve-token-info";
import {
  formatTransactionDate,
  getStatusText,
} from "@/lib/solana/wallet/formatters";
import { getWalletProvider } from "@/lib/solana/wallet/wallet-details";
import {
  hideAllButtons,
  hideMainButton,
  hideSecondaryButton,
  showMainButton,
} from "@/lib/telegram/mini-app/buttons";
import type { TransactionDetailsData, TransactionStatus } from "@/types/wallet";

export type { TransactionDetailsData, TransactionStatus };

// iOS-style sheet timing (shared with TokensSheet / ReceiveSheet)
const SHEET_TRANSITION = "transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)";
const OVERLAY_TRANSITION = "opacity 0.3s ease";

export type TransactionDetailsSheetProps = {
  trigger?: ReactNode | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  transaction: TransactionDetailsData | null;
  showSuccess?: boolean;
  showError?: string | null;
  solPriceUsd?: number | null;
  tokenHoldings?: TokenHolding[];
  onShare?: () => void;
  onCancelDeposit?: (username: string, amount: number) => Promise<void>;
  // Swap transaction props
  swapFromSymbol?: string;
  swapToSymbol?: string;
  swapToAmount?: number;
  swapToAmountUsd?: number;
  // Secure/unshield transaction props
  secureTokenSymbol?: string;
  secureTokenIcon?: string;
  secureAmount?: number;
  secureAmountUsd?: number;
};

// Globe icon for "View in explorer" button (light theme)
const ExplorerIcon = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="14" cy="14" r="9.33" stroke="#3C3C43" strokeWidth="2" />
    <ellipse
      cx="14"
      cy="14"
      rx="4.67"
      ry="9.33"
      stroke="#3C3C43"
      strokeWidth="2"
    />
    <path d="M4.67 14H23.33" stroke="#3C3C43" strokeWidth="2" />
  </svg>
);

// Share icon (light theme, same as ReceiveSheet)
const ShareIcon = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M14 2.33333V17.5"
      stroke="#3C3C43"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9.33333 7L14 2.33333L18.6667 7"
      stroke="#3C3C43"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M23.3333 14V22.1667C23.3333 22.7855 23.0875 23.379 22.6499 23.8166C22.2123 24.2542 21.6188 24.5 21 24.5H7C6.38116 24.5 5.78767 24.2542 5.35008 23.8166C4.9125 23.379 4.66667 22.7855 4.66667 22.1667V14"
      stroke="#3C3C43"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function TransactionDetailsSheet({
  open,
  onOpenChange,
  transaction,
  showSuccess = false,
  showError = null,
  solPriceUsd = null,
  tokenHoldings = [],
  onShare,
  onCancelDeposit,
  swapFromSymbol,
  swapToSymbol,
  swapToAmount,
  swapToAmountUsd,
  secureTokenSymbol,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  secureTokenIcon,
  secureAmount,
  secureAmountUsd,
}: TransactionDetailsSheetProps) {
  const { bottom: safeBottom } = useTelegramSafeArea();
  const [mounted, setMounted] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [rendered, setRendered] = useState(false);
  const [show, setShow] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragDelta = useRef(0);
  const isDragging = useRef(false);
  const isClosing = useRef(false);

  // FIXME: parse transfer_to_username_deposit instead
  const isDepositForUsername = false;
  const isSwapTransaction = transaction?.transferType === "swap";
  const isSecureTransaction = transaction?.transferType === "secure";
  const isUnshieldTransaction = transaction?.transferType === "unshield";
  const isSecureOrUnshield = isSecureTransaction || isUnshieldTransaction;

  // Resolve secure/unshield display data from tokenMint when explicit props are absent
  const secureResolvedInfo =
    isSecureOrUnshield && !secureTokenSymbol && transaction?.tokenMint
      ? resolveTokenInfo(transaction.tokenMint, tokenHoldings)
      : null;
  const resolvedSecureSymbol =
    secureTokenSymbol || secureResolvedInfo?.symbol || "?";
  const resolvedSecureAmount =
    secureAmount ??
    (isSecureOrUnshield && transaction?.tokenAmount
      ? parseFloat(transaction.tokenAmount)
      : undefined);
  const resolvedSecureAmountUsd =
    secureAmountUsd ??
    (() => {
      if (resolvedSecureAmount == null || !transaction?.tokenMint)
        return undefined;
      const holding = tokenHoldings.find(
        (h) => h.mint === transaction.tokenMint
      );
      return holding?.priceUsd != null
        ? resolvedSecureAmount * holding.priceUsd
        : undefined;
    })();

  // Deposit state for deposit_for_username transactions
  const [depositAmount, setDepositAmount] = useState<number | null>(null);
  const [isLoadingDeposit, setIsLoadingDeposit] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Open: mount elements, force layout, then trigger CSS transition
  useEffect(() => {
    if (open) {
      isClosing.current = false;
      setRendered(true);
    }
  }, [open]);

  useEffect(() => {
    if (rendered && open && !show && !isClosing.current) {
      sheetRef.current?.getBoundingClientRect();
      setShow(true);
    }
  }, [rendered, open, show]);

  // Measure header
  useEffect(() => {
    if (!open) return;
    const header = document.querySelector("header");
    if (header) {
      setHeaderHeight(header.getBoundingClientRect().bottom);
    }
  }, [open]);

  // Fetch deposit info when modal opens for deposit_for_username
  useEffect(() => {
    if (!open || !isDepositForUsername || !transaction?.recipientUsername) {
      setDepositAmount(null);
      setIsLoadingDeposit(false);
      return;
    }

    const fetchDepositInfo = async () => {
      setIsLoadingDeposit(true);
      try {
        const provider = await getWalletProvider();
        const username = transaction.recipientUsername!.replace(/^@/, "");
        const deposit = await getDeposit(provider, username);
        setDepositAmount(deposit.amount);
      } catch (error) {
        console.warn("Failed to fetch deposit info:", error);
        setDepositAmount(0);
      } finally {
        setIsLoadingDeposit(false);
      }
    };

    void fetchDepositInfo();
  }, [open, isDepositForUsername, transaction?.recipientUsername]);

  const handleCancelTransaction = useCallback(async () => {
    if (!onCancelDeposit || !transaction?.recipientUsername || !depositAmount)
      return;

    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("medium");
    }

    setIsCancelling(true);
    try {
      const username = transaction.recipientUsername.replace(/^@/, "");
      await onCancelDeposit(username, depositAmount);
    } catch (error) {
      console.error("Failed to cancel deposit:", error);
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("error");
      }
    } finally {
      setIsCancelling(false);
    }
  }, [onCancelDeposit, transaction?.recipientUsername, depositAmount]);

  // TODO: enable when refund will be implemented
  // Show "Cancel transaction" button for deposit_for_username transactions with non-zero deposit
  useEffect(() => {
    if (!open) {
      hideMainButton();
      hideSecondaryButton();
      return;
    }

    const canCancel =
      isDepositForUsername &&
      !isLoadingDeposit &&
      depositAmount !== null &&
      depositAmount > 0;

    if (canCancel) {
      showMainButton({
        text: "Cancel transaction",
        onClick: handleCancelTransaction,
        backgroundColor: "#FF4D4D",
        textColor: "#FFFFFF",
        isEnabled: !isCancelling,
        showLoader: isCancelling,
      });
      hideSecondaryButton();

      return () => {
        hideMainButton();
        hideSecondaryButton();
      };
    }

    if (isDepositForUsername) {
      hideMainButton();
      hideSecondaryButton();
      return () => {
        hideMainButton();
        hideSecondaryButton();
      };
    }

    return () => {
      hideMainButton();
      hideSecondaryButton();
    };
  }, [
    open,
    isDepositForUsername,
    isLoadingDeposit,
    depositAmount,
    isCancelling,
    handleCancelTransaction,
  ]);

  const unmount = useCallback(() => {
    setRendered(false);
    setShow(false);
    onOpenChange?.(false);
    isClosing.current = false;
  }, [onOpenChange]);

  const closeSheet = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;
    hideAllButtons();
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    if (sheetRef.current) {
      sheetRef.current.style.transition = SHEET_TRANSITION;
      sheetRef.current.style.transform = "translateY(100%)";
    }
    if (overlayRef.current) {
      overlayRef.current.style.transition = OVERLAY_TRANSITION;
      overlayRef.current.style.opacity = "0";
    }
  }, []);

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      if (e.propertyName === "transform" && isClosing.current) {
        unmount();
      }
    },
    [unmount]
  );

  // Pull-down-to-close
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    isDragging.current = true;
    dragStartY.current = e.touches[0].clientY;
    dragDelta.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    dragDelta.current = Math.max(0, delta);
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dragDelta.current}px)`;
    }
    if (overlayRef.current) {
      const opacity = Math.max(0.2, 1 - dragDelta.current / 300);
      overlayRef.current.style.opacity = String(opacity);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragDelta.current > 120) {
      closeSheet();
    } else {
      if (sheetRef.current) {
        sheetRef.current.style.transition = SHEET_TRANSITION;
        sheetRef.current.style.transform = "translateY(0px)";
      }
      if (overlayRef.current) {
        overlayRef.current.style.transition = OVERLAY_TRANSITION;
        overlayRef.current.style.opacity = "1";
      }
    }
    dragDelta.current = 0;
  }, [closeSheet]);

  // Lock body scroll
  useEffect(() => {
    if (rendered) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [rendered]);

  if (!mounted || !rendered || !transaction) return null;

  const sheetTopOffset = headerHeight || 56;

  const isIncoming = transaction.type === "incoming";
  const isStoreTransaction = transaction.transferType === "store";
  const isVerifyTransaction =
    transaction.transferType === "verify_telegram_init_data";
  const isSpecialTransaction = isStoreTransaction || isVerifyTransaction;
  const isTokenTransfer =
    !!transaction.tokenMint && typeof transaction.tokenAmount === "string";

  const amountSol = transaction.amountLamports / LAMPORTS_PER_SOL;
  const solUsdPrice = solPriceUsd ?? null;
  const amountUsdSol = solUsdPrice === null ? null : amountSol * solUsdPrice;

  const tokenInfo = isTokenTransfer
    ? resolveTokenInfo(transaction.tokenMint!, tokenHoldings)
    : null;
  const tokenPriceUsd = isTokenTransfer
    ? tokenHoldings.find((h) => h.mint === transaction.tokenMint)?.priceUsd ??
      null
    : null;
  const amountUsdToken =
    isTokenTransfer && tokenPriceUsd !== null
      ? (() => {
          const amt = Number.parseFloat(transaction.tokenAmount!);
          return Number.isFinite(amt) ? amt * tokenPriceUsd : null;
        })()
      : null;

  const mainSymbol = isTokenTransfer ? tokenInfo?.symbol ?? "?" : "SOL";
  const formattedAmount = isTokenTransfer
    ? transaction.tokenAmount!
    : amountSol.toFixed(4).replace(/\.?0+$/, "");
  const mainAmountUsd = isTokenTransfer ? amountUsdToken : amountUsdSol;
  const networkFeeSol = transaction.networkFeeLamports
    ? transaction.networkFeeLamports / LAMPORTS_PER_SOL
    : SOLANA_FEE_SOL;
  const networkFeeUsd =
    solUsdPrice === null ? null : networkFeeSol * solUsdPrice;

  const displayAddress = isIncoming
    ? transaction.senderUsername || transaction.sender || "Unknown"
    : transaction.recipientUsername || transaction.recipient || "Unknown";

  const isUsername = displayAddress.startsWith("@");

  const abbreviatedAddress = isUsername
    ? displayAddress
    : `${displayAddress.slice(0, 4)}…${displayAddress.slice(-4)}`;

  const fullAddress = isIncoming
    ? transaction.sender || "Unknown"
    : transaction.recipient || "Unknown";

  const handleViewInExplorer = () => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    if (transaction.signature) {
      window.open(getExplorerTxUrl(transaction.signature), "_blank");
    }
  };

  const handleShare = () => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }

    if (onShare) {
      onShare();
      return;
    }

    const shareText = `Transaction: ${
      isIncoming ? "+" : "-"
    }${formattedAmount} ${mainSymbol}`;

    if (shareURL.isAvailable()) {
      const explorerUrl = transaction.signature
        ? getExplorerTxUrl(transaction.signature)
        : getSolscanAccountUrl(fullAddress);
      shareURL(explorerUrl, shareText);
    } else if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(shareText);
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("success");
      }
    }
  };

  // Header pill label — prefix is gray, address/username is black
  const headerPrefix = isSpecialTransaction
    ? null
    : showSuccess
    ? "Claimed from "
    : showError
    ? "Claim from "
    : isIncoming
    ? "Received from "
    : "Sent to ";

  const headerSpecialLabel = isStoreTransaction ? "Store data" : "Verify data";

  const content = (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        onClick={closeSheet}
        className="fixed inset-0 z-[9998]"
        style={{
          background: "rgba(0, 0, 0, 0.3)",
          opacity: show ? 1 : 0,
          transition: OVERLAY_TRANSITION,
        }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        onTransitionEnd={handleTransitionEnd}
        className="fixed left-0 right-0 bottom-0 z-[9999] flex flex-col bg-white rounded-t-[38px] font-sans max-w-md mx-auto"
        style={{
          top: sheetTopOffset,
          transform: show ? "translateY(0)" : "translateY(100%)",
          transition: SHEET_TRANSITION,
          boxShadow: "0px -4px 40px rgba(0, 0, 0, 0.08)",
        }}
      >
        {/* Handle bar */}
        <div
          className="flex justify-center pt-2 pb-1 shrink-0 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="w-9 h-1 rounded-full"
            style={{ background: "rgba(0, 0, 0, 0.15)" }}
          />
        </div>

        {/* Header */}
        <div
          className="relative h-[44px] flex items-center justify-center shrink-0 px-4"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Swap / Secure / Unshield Transaction: Title only (no pill) */}
          {isSwapTransaction ? (
            <span className="text-[17px] font-semibold text-black leading-[22px]">
              Swap {swapFromSymbol || "?"} to {swapToSymbol || "?"}
            </span>
          ) : isSecureOrUnshield ? (
            <span className="text-[17px] font-semibold text-black leading-[22px]">
              {isSecureTransaction ? "Secure" : "Unshield"}{" "}
              {resolvedSecureSymbol}
            </span>
          ) : (
            /* Header Pill for non-swap transactions */
            <div
              className="flex items-center px-3 py-1.5 rounded-[54px]"
              style={{ background: "#f2f2f7" }}
            >
              {isSpecialTransaction ? (
                <span
                  className="text-[14px] leading-5"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                >
                  {headerSpecialLabel}
                </span>
              ) : (
                <span className="text-[14px] leading-5">
                  <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>
                    {headerPrefix}
                  </span>
                  <span className="text-black">{abbreviatedAddress}</span>
                </span>
              )}
            </div>
          )}

          {/* Close Button */}
          <button
            onClick={closeSheet}
            className="absolute right-3 w-[30px] h-[30px] rounded-full flex items-center justify-center active:scale-95 transition-all duration-150"
            style={{ background: "rgba(0, 0, 0, 0.06)" }}
          >
            <X
              size={20}
              strokeWidth={2}
              style={{ color: "rgba(60, 60, 67, 0.6)" }}
            />
          </button>
        </div>

        {/* Content — scrollable */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: Math.max(safeBottom, 24) + 80 }}
        >
          {showError ? (
            /* Error View */
            <div className="flex flex-col items-center justify-center px-6 pt-12 pb-24">
              <div className="relative mb-5">
                <div
                  className="w-[72px] h-[72px] rounded-full flex items-center justify-center"
                  style={{
                    background: "#FF4D4D",
                    animation: "result-pulse 0.6s ease-out",
                  }}
                >
                  <ShieldAlert
                    className="text-white"
                    size={40}
                    strokeWidth={2}
                    style={{ animation: "result-icon 0.4s ease-out 0.2s both" }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 items-center text-center max-w-[280px]">
                <h2 className="text-2xl font-semibold text-black leading-7">
                  Claim failed
                </h2>
                <p
                  className="text-base leading-5"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                >
                  {showError}
                </p>
              </div>

              <style jsx>{`
                @keyframes result-pulse {
                  0% {
                    transform: scale(0);
                    opacity: 0;
                  }
                  50% {
                    transform: scale(1.1);
                  }
                  100% {
                    transform: scale(1);
                    opacity: 1;
                  }
                }
                @keyframes result-icon {
                  0% {
                    transform: scale(0) rotate(-45deg);
                    opacity: 0;
                  }
                  100% {
                    transform: scale(1) rotate(0deg);
                    opacity: 1;
                  }
                }
              `}</style>
            </div>
          ) : showSuccess ? (
            /* Success View */
            <div className="flex flex-col items-center justify-center px-6 pt-12 pb-24">
              <div className="relative mb-5">
                <div
                  className="w-[72px] h-[72px] rounded-full flex items-center justify-center"
                  style={{
                    background: "#34C759",
                    animation: "result-pulse 0.6s ease-out",
                  }}
                >
                  <Check
                    className="text-white"
                    size={40}
                    strokeWidth={2.5}
                    style={{ animation: "result-icon 0.4s ease-out 0.2s both" }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 items-center text-center max-w-[280px]">
                <h2 className="text-2xl font-semibold text-black leading-7">
                  SOL claimed
                </h2>
                <p
                  className="text-base leading-5"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                >
                  <span className="text-black">{formattedAmount} SOL</span>{" "}
                  successfully claimed from{" "}
                  <span className="text-black">{abbreviatedAddress}</span>
                </p>
              </div>

              <style jsx>{`
                @keyframes result-pulse {
                  0% {
                    transform: scale(0);
                    opacity: 0;
                  }
                  50% {
                    transform: scale(1.1);
                  }
                  100% {
                    transform: scale(1);
                    opacity: 1;
                  }
                }
                @keyframes result-icon {
                  0% {
                    transform: scale(0) rotate(-45deg);
                    opacity: 0;
                  }
                  100% {
                    transform: scale(1) rotate(0deg);
                    opacity: 1;
                  }
                }
              `}</style>
            </div>
          ) : isSpecialTransaction ? (
            /* Special Transaction Details View (Store/Verify) */
            <>
              {/* Date Section */}
              <div className="flex flex-col items-center justify-center px-4 pt-8 pb-6">
                <p
                  className="text-base leading-[22px] text-center"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                >
                  {formatTransactionDate(transaction.timestamp)}
                </p>
              </div>

              {/* Details Card */}
              <div className="px-4">
                <div
                  className="flex flex-col rounded-[20px] overflow-hidden"
                  style={{ background: "#f2f2f7" }}
                >
                  {/* Status */}
                  <div className="flex flex-col gap-0.5 px-4 py-2.5">
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      Status
                    </p>
                    <p className="text-base leading-5 text-black">
                      {getStatusText(transaction.status, isIncoming)}
                    </p>
                  </div>

                  {/* Info */}
                  <div className="flex flex-col gap-0.5 px-4 py-2.5">
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      Info
                    </p>
                    <p className="text-base leading-5 text-black">
                      {isStoreTransaction
                        ? "Store signed Telegram user identity"
                        : "Verify Telegram signature on user identity"}
                    </p>
                  </div>

                  {/* Network Fee */}
                  <div className="flex flex-col gap-0.5 px-4 py-2.5">
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      Network fee
                    </p>
                    <p className="text-base leading-5">
                      <span className="text-black">{networkFeeSol} SOL</span>
                      <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>
                        {" "}
                        ≈{" "}
                        {networkFeeUsd !== null
                          ? `$${networkFeeUsd.toFixed(2)}`
                          : "—"}
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex w-[256px] mx-auto justify-between px-4 pt-8">
                <button
                  onClick={handleViewInExplorer}
                  className="w-[56px] flex flex-col gap-2 items-center overflow-visible whitespace-nowrap active:opacity-70 transition-opacity"
                >
                  <div
                    className="w-[56px] h-[56px] rounded-full flex items-center justify-center"
                    style={{ background: "rgba(249, 54, 60, 0.14)" }}
                  >
                    <ExplorerIcon />
                  </div>
                  <span
                    className="text-[13px]"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    View in explorer
                  </span>
                </button>

                <button
                  onClick={handleShare}
                  className="w-[56px] flex flex-col gap-2 items-center overflow-visible whitespace-nowrap active:opacity-70 transition-opacity"
                >
                  <div
                    className="w-[56px] h-[56px] rounded-full flex items-center justify-center"
                    style={{ background: "rgba(249, 54, 60, 0.14)" }}
                  >
                    <ShareIcon />
                  </div>
                  <span
                    className="text-[13px]"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    Share
                  </span>
                </button>
              </div>
            </>
          ) : isSecureOrUnshield ? (
            /* Secure/Unshield Transaction Details View */
            <>
              {/* Icon */}
              <div className="flex flex-col items-center justify-center px-4 pt-8 pb-4">
                <div className="w-[64px] h-[64px] flex items-center justify-center">
                  <Image
                    src={isSecureTransaction ? "/Shield.svg" : "/Unshield.svg"}
                    alt={isSecureTransaction ? "Secure" : "Unshield"}
                    width={64}
                    height={64}
                  />
                </div>
              </div>

              {/* Amount Section */}
              <div className="flex flex-col items-center justify-center px-4 pb-6">
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-baseline gap-2">
                    <p className="text-[40px] font-semibold leading-[48px] text-black">
                      {resolvedSecureAmount?.toFixed(4).replace(/\.?0+$/, "") ||
                        "0"}
                    </p>
                    <p
                      className="text-[28px] font-semibold leading-8 tracking-[0.4px]"
                      style={{ color: "rgba(60, 60, 67, 0.4)" }}
                    >
                      {resolvedSecureSymbol}
                    </p>
                  </div>
                  {/* USD Value */}
                  <p
                    className="text-[17px] leading-[22px] text-center"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    ≈
                    {resolvedSecureAmountUsd !== undefined
                      ? `$${resolvedSecureAmountUsd.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "—"}
                  </p>
                  {/* Date */}
                  <p
                    className="text-[17px] leading-[22px] text-center"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    {formatTransactionDate(transaction.timestamp)}
                  </p>
                </div>
              </div>

              {/* Details Card */}
              <div className="px-4">
                <div
                  className="flex flex-col rounded-[20px] overflow-hidden"
                  style={{ background: "#f2f2f7" }}
                >
                  {/* Status */}
                  <div className="flex flex-col gap-0.5 px-4 py-2.5">
                    <p
                      className="text-[15px] leading-5"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      Status
                    </p>
                    <p className="text-[17px] leading-[22px] text-black tracking-[-0.187px]">
                      {getStatusText(transaction.status, false)}
                    </p>
                  </div>

                  {/* Network Fee */}
                  <div className="flex flex-col gap-0.5 px-4 py-2.5">
                    <p
                      className="text-[15px] leading-5"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      Network Fee
                    </p>
                    <p className="text-[17px] leading-[22px] tracking-[-0.187px]">
                      <span className="text-black">{networkFeeSol} SOL</span>
                      <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>
                        {" "}
                        ≈{" "}
                        {networkFeeUsd !== null
                          ? `$${networkFeeUsd.toFixed(2)}`
                          : "—"}
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex w-[256px] mx-auto justify-between px-4 pt-5 pb-4">
                <button
                  onClick={handleViewInExplorer}
                  className="w-[56px] flex flex-col gap-2 items-center overflow-visible whitespace-nowrap active:opacity-70 transition-opacity"
                >
                  <div
                    className="w-[52px] h-[52px] rounded-full flex items-center justify-center"
                    style={{ background: "rgba(249, 54, 60, 0.14)" }}
                  >
                    <ExplorerIcon />
                  </div>
                  <span
                    className="text-[13px] leading-4"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    View in explorer
                  </span>
                </button>

                <button
                  onClick={handleShare}
                  className="w-[56px] flex flex-col gap-2 items-center overflow-visible whitespace-nowrap active:opacity-70 transition-opacity"
                >
                  <div
                    className="w-[52px] h-[52px] rounded-full flex items-center justify-center"
                    style={{ background: "rgba(249, 54, 60, 0.14)" }}
                  >
                    <ShareIcon />
                  </div>
                  <span
                    className="text-[13px] leading-4"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    Share
                  </span>
                </button>
              </div>
            </>
          ) : isSwapTransaction ? (
            /* Swap Transaction Details View */
            <>
              {/* Amount Section */}
              <div className="flex flex-col items-center justify-center px-4 pt-8 pb-6">
                <div className="flex flex-col items-center gap-1">
                  {/* Received Amount (always green) */}
                  <div className="flex items-baseline gap-2">
                    <p
                      className="text-[40px] font-semibold leading-[48px]"
                      style={{ color: "#34C759" }}
                    >
                      +{swapToAmount?.toFixed(4).replace(/\.?0+$/, "") || "0"}
                    </p>
                    <p
                      className="text-[28px] font-semibold leading-8 tracking-[0.4px]"
                      style={{ color: "rgba(60, 60, 67, 0.4)" }}
                    >
                      {swapToSymbol || "?"}
                    </p>
                  </div>
                  {/* USD Value */}
                  <p
                    className="text-[17px] leading-[22px] text-center"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    ≈
                    {swapToAmountUsd !== undefined
                      ? `$${swapToAmountUsd.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "—"}
                  </p>
                  {/* Date */}
                  <p
                    className="text-[17px] leading-[22px] text-center"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    {formatTransactionDate(transaction.timestamp)}
                  </p>
                </div>
              </div>

              {/* Details Card */}
              <div className="px-4">
                <div
                  className="flex flex-col rounded-[20px] overflow-hidden"
                  style={{ background: "#f2f2f7" }}
                >
                  {/* Status */}
                  <div className="flex flex-col gap-0.5 px-4 py-2.5">
                    <p
                      className="text-[15px] leading-5"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      Status
                    </p>
                    <p className="text-[17px] leading-[22px] text-black tracking-[-0.187px]">
                      {getStatusText(transaction.status, false)}
                    </p>
                  </div>

                  {/* Network Fee */}
                  <div className="flex flex-col gap-0.5 px-4 py-2.5">
                    <p
                      className="text-[15px] leading-5"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      Network Fee
                    </p>
                    <p className="text-[17px] leading-[22px] tracking-[-0.187px]">
                      <span className="text-black">{networkFeeSol} SOL</span>
                      <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>
                        {" "}
                        ≈{" "}
                        {networkFeeUsd !== null
                          ? `$${networkFeeUsd.toFixed(2)}`
                          : "—"}
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex w-[256px] mx-auto justify-between px-4 pt-5 pb-4">
                <button
                  onClick={handleViewInExplorer}
                  className="w-[56px] flex flex-col gap-2 items-center overflow-visible whitespace-nowrap active:opacity-70 transition-opacity"
                >
                  <div
                    className="w-[52px] h-[52px] rounded-full flex items-center justify-center"
                    style={{ background: "rgba(249, 54, 60, 0.14)" }}
                  >
                    <ExplorerIcon />
                  </div>
                  <span
                    className="text-[13px] leading-4"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    View in explorer
                  </span>
                </button>

                <button
                  onClick={handleShare}
                  className="w-[56px] flex flex-col gap-2 items-center overflow-visible whitespace-nowrap active:opacity-70 transition-opacity"
                >
                  <div
                    className="w-[52px] h-[52px] rounded-full flex items-center justify-center"
                    style={{ background: "rgba(249, 54, 60, 0.14)" }}
                  >
                    <ShareIcon />
                  </div>
                  <span
                    className="text-[13px] leading-4"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    Share
                  </span>
                </button>
              </div>
            </>
          ) : (
            /* Regular Transaction Details View */
            <>
              {/* Amount Section */}
              <div className="flex flex-col items-center justify-center px-4 pt-8 pb-6">
                <div className="flex flex-col items-center gap-1">
                  {/* Amount */}
                  <div className="flex items-baseline gap-2">
                    <p
                      className="text-[40px] font-semibold leading-[48px]"
                      style={{ color: isIncoming ? "#34C759" : "#000" }}
                    >
                      {isIncoming ? "+" : "−"}
                      {formattedAmount}
                    </p>
                    <p
                      className="text-[28px] font-semibold leading-8 tracking-[0.4px]"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      {mainSymbol}
                    </p>
                  </div>
                  {/* USD Value */}
                  <p
                    className="text-base leading-[22px] text-center"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    ≈
                    {mainAmountUsd !== null
                      ? `$${mainAmountUsd.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "—"}
                  </p>
                  {/* Date */}
                  <p
                    className="text-base leading-[22px] text-center"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    {formatTransactionDate(transaction.timestamp)}
                  </p>
                </div>
              </div>

              {/* Details Card */}
              <div className="px-4">
                <div
                  className="flex flex-col rounded-[20px] overflow-hidden"
                  style={{ background: "#f2f2f7" }}
                >
                  {/* Status */}
                  <div className="flex flex-col gap-0.5 px-4 py-2.5">
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      Status
                    </p>
                    <p className="text-base leading-5 text-black">
                      {getStatusText(transaction.status, isIncoming)}
                    </p>
                  </div>

                  {/* Recipient/Sender */}
                  <div className="flex flex-col gap-0.5 px-4 py-2.5">
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      {isIncoming ? "Received from" : "Recipient"}
                    </p>
                    <p className="text-base leading-5 text-black break-all">
                      {fullAddress}
                    </p>
                  </div>

                  {/* Network Fee (only for outgoing) */}
                  {!isIncoming && (
                    <div className="flex flex-col gap-0.5 px-4 py-2.5">
                      <p
                        className="text-[13px] leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        Network fee
                      </p>
                      <p className="text-base leading-5">
                        <span className="text-black">{networkFeeSol} SOL</span>
                        <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>
                          {" "}
                          ≈{" "}
                          {networkFeeUsd !== null
                            ? `$${networkFeeUsd.toFixed(2)}`
                            : "—"}
                        </span>
                      </p>
                    </div>
                  )}

                  {/* Comment (only for incoming) */}
                  {isIncoming && transaction.comment && (
                    <div className="flex flex-col gap-0.5 px-4 py-2.5">
                      <p
                        className="text-[13px] leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        Comment
                      </p>
                      <p className="text-base leading-5 text-black">
                        {transaction.comment}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex w-[256px] mx-auto justify-between px-4 pt-8">
                <button
                  onClick={handleViewInExplorer}
                  className="w-[56px] flex flex-col gap-2 items-center overflow-visible whitespace-nowrap active:opacity-70 transition-opacity"
                >
                  <div
                    className="w-[56px] h-[56px] rounded-full flex items-center justify-center"
                    style={{ background: "rgba(249, 54, 60, 0.14)" }}
                  >
                    <ExplorerIcon />
                  </div>
                  <span
                    className="text-[13px]"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    View in explorer
                  </span>
                </button>

                <button
                  onClick={handleShare}
                  className="w-[56px] flex flex-col gap-2 items-center overflow-visible whitespace-nowrap active:opacity-70 transition-opacity"
                >
                  <div
                    className="w-[56px] h-[56px] rounded-full flex items-center justify-center"
                    style={{ background: "rgba(249, 54, 60, 0.14)" }}
                  >
                    <ShareIcon />
                  </div>
                  <span
                    className="text-[13px]"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    Share
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
