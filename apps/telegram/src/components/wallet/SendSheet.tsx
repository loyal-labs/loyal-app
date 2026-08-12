"use client";

import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  hapticFeedback,
  openTelegramLink,
  retrieveLaunchParams,
} from "@telegram-apps/sdk-react";
import { ArrowLeft, Search, X } from "lucide-react";
import Image from "next/image";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useTelegramSafeArea } from "@/hooks/useTelegramSafeArea";
import {
  LAST_AMOUNT_KEY,
  MAX_RECENT_RECIPIENTS,
  RECENT_RECIPIENTS_KEY,
  SOL_PRICE_USD,
} from "@/lib/constants";
import { fetchSolUsdPrice } from "@/lib/solana/fetch-sol-price";
import { resolveTokenIcon } from "@/lib/solana/token-holdings";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { hideAllButtons } from "@/lib/telegram/mini-app/buttons";
import {
  getCloudValue,
  setCloudValue,
} from "@/lib/telegram/mini-app/cloud-storage";

import {
  getMaxAmountWithFeeReserve,
  getSendFeeReserveSol,
  hasEnoughSolForFee,
  type WalletSendFlow,
} from "./fee-reserve";

// iOS-style sheet timing (shared with other sheets)
const SHEET_TRANSITION = "transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)";
const OVERLAY_TRANSITION = "opacity 0.3s ease";

// Parse raw Solana error into a user-friendly message
function getFriendlyError(raw: string): {
  message: string;
  details: string | null;
} {
  const lower = raw.toLowerCase();

  if (
    lower.includes("insufficient lamports") ||
    lower.includes("not enough sol")
  ) {
    return {
      message: "You don't have enough SOL to complete this transaction.",
      details: null,
    };
  }
  if (lower.includes("insufficient funds")) {
    return {
      message: "Insufficient funds for this transaction.",
      details: null,
    };
  }
  if (
    lower.includes("blockhash not found") ||
    lower.includes("block height exceeded")
  ) {
    return {
      message: "The transaction expired. Please try again.",
      details: null,
    };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return {
      message: "The transaction timed out. Please try again.",
      details: null,
    };
  }
  if (lower.includes("user rejected") || lower.includes("user cancelled")) {
    return { message: "Transaction was cancelled.", details: null };
  }
  if (lower.includes("simulation failed") || lower.includes("program error")) {
    return {
      message:
        "The transaction could not be processed. Please try again later.",
      details: raw,
    };
  }
  if (raw.length > 120) {
    return { message: "Something went wrong. Please try again.", details: raw };
  }
  return { message: raw, details: null };
}

export type SendSheetProps = {
  trigger?: ReactNode | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialRecipient?: string;
  onValidationChange?: (isValid: boolean) => void;
  onFormValuesChange?: (values: {
    amount: string;
    recipient: string;
    isSecured: boolean;
  }) => void;
  step: 1 | 2 | 3 | 4 | 5;
  onStepChange: (step: 1 | 2 | 3 | 4 | 5) => void;
  balance?: number | null;
  walletAddress?: string;
  solPriceUsd?: number | null;
  isSolPriceLoading?: boolean;
  sentAmountSol?: number;
  sendError?: string | null;
  isSending?: boolean;
  tokenHoldings?: TokenHolding[];
};

// Basic Solana address validation (base58, 32-44 chars)
export const isValidSolanaAddress = (address: string): boolean => {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
};

// Telegram username validation (starts with @, 5-32 chars excluding @)
export const isValidTelegramUsername = (username: string): boolean => {
  if (!username.startsWith("@")) return false;
  const usernameWithoutAt = username.slice(1);
  return usernameWithoutAt.length >= 5 && usernameWithoutAt.length <= 32;
};

// Recent recipient type
export type RecentRecipient = {
  address: string;
  timestamp: number;
};

// Get recent recipients from Telegram cloud storage
export const getRecentRecipients = async (): Promise<RecentRecipient[]> => {
  try {
    const stored = await getCloudValue(RECENT_RECIPIENTS_KEY);
    if (stored && typeof stored === "string") {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
};

// Add a recipient to recent list (moves to top if already exists)
export const addRecentRecipient = async (address: string): Promise<void> => {
  try {
    const trimmed = address.trim();
    if (!trimmed) return;

    const existing = await getRecentRecipients();
    const filtered = existing.filter((r) => r.address !== trimmed);
    const updated: RecentRecipient[] = [
      { address: trimmed, timestamp: Date.now() },
      ...filtered,
    ].slice(0, MAX_RECENT_RECIPIENTS);

    await setCloudValue(RECENT_RECIPIENTS_KEY, JSON.stringify(updated));
  } catch {}
};

// Truncate (floor) to specific decimal places - never rounds up
const truncateDecimals = (num: number, decimals: number): string => {
  const factor = Math.pow(10, decimals);
  const truncated = Math.floor(num * factor) / factor;
  return truncated.toFixed(decimals);
};

type LastAmount = {
  sol: number;
  usd: number;
};

const getLastAmount = async (): Promise<LastAmount | null> => {
  try {
    const stored = await getCloudValue(LAST_AMOUNT_KEY);
    if (stored && typeof stored === "string") return JSON.parse(stored);
  } catch {}
  return null;
};

const saveLastAmount = async (
  solAmount: number,
  solPriceUsd: number | null
): Promise<void> => {
  try {
    const lastAmount: LastAmount = {
      sol: solAmount,
      usd: solPriceUsd
        ? parseFloat((solAmount * solPriceUsd).toFixed(2))
        : solAmount,
    };
    await setCloudValue(LAST_AMOUNT_KEY, JSON.stringify(lastAmount));
  } catch {}
};

// Generate a consistent color based on name
const getAvatarColor = (name: string): string => {
  const colors = [
    "rgba(99, 102, 241, 0.15)",
    "rgba(236, 72, 153, 0.15)",
    "rgba(34, 197, 94, 0.15)",
    "rgba(249, 115, 22, 0.15)",
    "rgba(139, 92, 246, 0.15)",
    "rgba(14, 165, 233, 0.15)",
  ];
  const index = name.charCodeAt(0) % colors.length;
  return colors[index];
};

// Chevron icon (light theme)
const ChevronIcon = () => (
  <svg
    width="16"
    height="24"
    viewBox="0 0 16 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M5.5 6L11 12L5.5 18"
      stroke="rgba(60,60,67,0.3)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Arrow up/down icon for currency switch (light theme)
const ArrowUpDownIcon = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M9.33 5.25V22.75M9.33 22.75L5.25 18.67M9.33 22.75L13.42 18.67"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M18.67 22.75V5.25M18.67 5.25L14.58 9.33M18.67 5.25L22.75 9.33"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function ErrorResult({ error }: { error: string }) {
  const [showDetails, setShowDetails] = useState(false);
  const { message, details } = getFriendlyError(error);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
      <div className="relative mb-5">
        <Image src="/dogs/dog-cry.png" alt="Error" width={96} height={96} />
      </div>
      <div className="flex flex-col gap-2 items-center text-center max-w-[280px]">
        <h2 className="text-xl font-semibold text-black leading-6">
          Transaction failed
        </h2>
        <p
          className="text-base leading-5"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          {message}
        </p>
        {details && (
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="text-[13px] leading-4 mt-1"
            style={{ color: "rgba(60, 60, 67, 0.4)" }}
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
        )}
        {details && showDetails && (
          <p
            className="text-[11px] leading-[14px] mt-1 break-all max-h-[120px] overflow-y-auto"
            style={{ color: "rgba(60, 60, 67, 0.3)" }}
          >
            {details}
          </p>
        )}
      </div>
    </div>
  );
}

export default function SendSheet({
  open,
  onOpenChange,
  initialRecipient,
  onValidationChange,
  onFormValuesChange,
  step,
  onStepChange,
  balance,
  walletAddress,
  solPriceUsd: solPriceUsdProp,
  isSolPriceLoading: isSolPriceLoadingProp,
  sentAmountSol,
  sendError,
  isSending = false,
  tokenHoldings = [],
}: SendSheetProps) {
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

  // Detect iOS for platform-specific focus handling
  const [isIOS] = useState(() => {
    try {
      const params = retrieveLaunchParams();
      return params.tgWebAppPlatform === "ios";
    } catch {
      return false;
    }
  });

  // Abbreviate wallet address for display
  const abbreviatedAddress = walletAddress
    ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
    : "";

  // Token selection state
  const [tokenSearchQuery, setTokenSearchQuery] = useState("");
  const [selectedToken, setSelectedToken] = useState<TokenHolding | null>(null);

  const filteredTokens = useMemo(() => {
    if (!tokenSearchQuery.trim()) return tokenHoldings;
    const q = tokenSearchQuery.toLowerCase();
    return tokenHoldings.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
    );
  }, [tokenHoldings, tokenSearchQuery]);

  // Form state
  const [amountStr, setAmountStr] = useState("");
  const [recipient, setRecipient] = useState("");
  const [currency, setCurrency] = useState<"SOL" | "USD">("SOL");
  const [, setLastAmount] = useState<LastAmount | null>(null);
  const [recentRecipients, setRecentRecipients] = useState<RecentRecipient[]>(
    []
  );
  const [solPriceUsdState, setSolPriceUsdState] = useState<number | null>(null);
  const [isSolPriceLoadingState, setIsSolPriceLoadingState] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const amountTextRef = useRef<HTMLParagraphElement>(null);
  const [caretLeft, setCaretLeft] = useState(0);

  // Use the selected token's balance if available, otherwise fall back to wallet SOL balance
  const walletBalanceInSol = balance ? balance / LAMPORTS_PER_SOL : 0;
  const balanceInSol = selectedToken
    ? selectedToken.balance
    : walletBalanceInSol;
  const isUsingExternalPrice =
    solPriceUsdProp !== undefined || isSolPriceLoadingProp !== undefined;
  const solPriceUsd = isUsingExternalPrice
    ? solPriceUsdProp ?? null
    : solPriceUsdState;
  const isSolPriceLoading = isUsingExternalPrice
    ? isSolPriceLoadingProp ?? solPriceUsd === null
    : isSolPriceLoadingState;
  const balanceInUsd = solPriceUsd ? balanceInSol * solPriceUsd : null;
  const tokenSymbol = selectedToken?.symbol || "SOL";
  const isSecuredTransfer = selectedToken?.isSecured === true;
  const recipientTrimmed = recipient.trim();
  const sendFlow: WalletSendFlow =
    isValidTelegramUsername(recipientTrimmed) || isSecuredTransfer
      ? "private-send"
      : "direct-sol-send";
  const sendFeeReserveSol = getSendFeeReserveSol(sendFlow);
  const sendFeeUsd = solPriceUsd ? sendFeeReserveSol * solPriceUsd : null;
  const maxSendAmountInSol = getMaxAmountWithFeeReserve({
    assetBalance: balanceInSol,
    feePayerSolBalance: walletBalanceInSol,
    feeReserveSol: sendFeeReserveSol,
    amountAndFeeUseSameSolBalance: sendFlow === "direct-sol-send",
  });
  const maxSendAmountInUsd = solPriceUsd ? maxSendAmountInSol * solPriceUsd : 0;

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

  // Load SOL price for USD conversions when not provided externally
  useEffect(() => {
    if (isUsingExternalPrice) {
      setIsSolPriceLoadingState(false);
      return;
    }

    let isMounted = true;

    const loadPrice = async () => {
      try {
        const price = await fetchSolUsdPrice();
        if (!isMounted) return;
        setSolPriceUsdState(price);
      } catch (error) {
        console.error("Failed to fetch SOL price", error);
        if (!isMounted) return;
        setSolPriceUsdState(SOL_PRICE_USD);
      } finally {
        if (isMounted) {
          setIsSolPriceLoadingState(false);
        }
      }
    };

    void loadPrice();

    return () => {
      isMounted = false;
    };
  }, [isUsingExternalPrice]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setAmountStr("");
      setRecipient(initialRecipient || "");
      setCurrency("SOL");
      setTokenSearchQuery("");
      setSelectedToken(null);
      void getLastAmount().then(setLastAmount);
      void getRecentRecipients().then(setRecentRecipients);
    }
  }, [open, initialRecipient]);

  // Auto-focus and blur based on step
  useEffect(() => {
    if (!open) return;

    if (!isIOS) {
      if (step === 2) {
        const timer = setTimeout(() => {
          inputRef.current?.focus();
        }, 300);
        return () => clearTimeout(timer);
      }
      if (step === 3) {
        const timer = setTimeout(() => {
          amountInputRef.current?.focus({ preventScroll: true });
        }, 300);
        return () => clearTimeout(timer);
      }
    }

    if (step === 4 || step === 5) {
      amountInputRef.current?.blur();
      inputRef.current?.blur();
    }
  }, [open, step, isIOS]);

  // Update caret position based on actual text width
  useEffect(() => {
    if (amountTextRef.current) {
      setCaretLeft(amountTextRef.current.offsetWidth);
    } else {
      setCaretLeft(0);
    }
  }, [amountStr]);

  // Prevent backspace from navigating when on step 3
  const amountStrRef = useRef(amountStr);
  useEffect(() => {
    amountStrRef.current = amountStr;
  }, [amountStr]);

  useEffect(() => {
    if (!open || step !== 3) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Backspace") {
        if (!amountStrRef.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, step]);

  // Save last amount when moving to step 4 (confirmation)
  useEffect(() => {
    if (step === 4 && amountStr) {
      const amount = parseFloat(amountStr);
      if (!isNaN(amount) && amount > 0) {
        const solAmount =
          currency === "USD"
            ? solPriceUsd
              ? amount / solPriceUsd
              : NaN
            : amount;
        if (!isNaN(solAmount) && solAmount > 0) {
          void saveLastAmount(solAmount, solPriceUsd);
        }
      }
    }
  }, [step, amountStr, currency, solPriceUsd]);

  // Handle value reporting to parent
  useEffect(() => {
    if (onFormValuesChange) {
      let finalAmount = amountStr;
      if (currency === "USD" && amountStr) {
        const usdVal = parseFloat(amountStr);
        if (!isNaN(usdVal)) {
          finalAmount = solPriceUsd ? (usdVal / solPriceUsd).toFixed(6) : "";
        }
      }
      onFormValuesChange({
        amount: finalAmount,
        recipient,
        isSecured: !!selectedToken?.isSecured,
      });
    }
  }, [
    amountStr,
    recipient,
    currency,
    onFormValuesChange,
    solPriceUsd,
    selectedToken,
  ]);

  // Validation Logic
  useEffect(() => {
    if (!open) {
      onValidationChange?.(false);
      return;
    }

    const isRecipientValid =
      isValidSolanaAddress(recipientTrimmed) ||
      isValidTelegramUsername(recipientTrimmed);

    if (step === 1) {
      // Token selection step — always valid (user picks from list)
      onValidationChange?.(true);
      return;
    }

    if (step === 2) {
      onValidationChange?.(isRecipientValid);
      return;
    }

    const amount = parseFloat(amountStr);
    const isAmountValid = !isNaN(amount) && amount > 0 && isFinite(amount);

    const amountInSol =
      currency === "SOL" ? amount : solPriceUsd ? amount / solPriceUsd : NaN;
    const hasEnoughBalance =
      !isNaN(amountInSol) && amountInSol <= maxSendAmountInSol;
    const canCoverNetworkFees = hasEnoughSolForFee(
      walletBalanceInSol,
      sendFeeReserveSol
    );

    if (step === 3) {
      const isValid =
        isAmountValid &&
        isRecipientValid &&
        hasEnoughBalance &&
        canCoverNetworkFees &&
        (currency === "SOL" || !!solPriceUsd);
      onValidationChange?.(isValid);
      return;
    }

    if (step === 4) {
      const isValid =
        isAmountValid &&
        isRecipientValid &&
        hasEnoughBalance &&
        canCoverNetworkFees &&
        (currency === "SOL" || !!solPriceUsd);
      onValidationChange?.(isValid);
      return;
    }

    onValidationChange?.(false);
  }, [
    step,
    amountStr,
    recipient,
    open,
    onValidationChange,
    currency,
    maxSendAmountInSol,
    walletBalanceInSol,
    solPriceUsd,
    recipientTrimmed,
    sendFeeReserveSol,
  ]);

  const handleRecipientSelect = (selected: string) => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    setRecipient(selected);
    onStepChange(3);
    if (isIOS) {
      amountInputRef.current?.focus({ preventScroll: true });
    }
  };

  const handlePresetAmount = (val: number | string) => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    if (document.activeElement !== amountInputRef.current) {
      amountInputRef.current?.focus({ preventScroll: true });
    }
    const strVal = typeof val === "string" ? val : val.toString();
    setAmountStr(strVal);
  };

  const handleTokenSelect = (token: TokenHolding) => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    setSelectedToken(token);
    setTokenSearchQuery("");
    onStepChange(2);
  };
  // Insufficient balance check
  const insufficientBalance = useMemo(() => {
    const val = parseFloat(amountStr);
    if (isNaN(val) || val <= 0) return false;
    const amountInSol =
      currency === "SOL" ? val : solPriceUsd ? val / solPriceUsd : NaN;
    return amountInSol > maxSendAmountInSol;
  }, [amountStr, currency, maxSendAmountInSol, solPriceUsd]);

  // Sheet animation handlers
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

  // Close when parent sets open=false while sheet is still showing
  useEffect(() => {
    if (!open && rendered && show && !isClosing.current) {
      closeSheet();
    }
  }, [open, rendered, show, closeSheet]);

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

  if (!mounted || !rendered) return null;

  const sheetTopOffset = headerHeight || 56;

  // Pill display for steps 3-5
  const pillAddress = recipient.startsWith("@")
    ? recipient
    : recipient
    ? `${recipient.slice(0, 4)}…${recipient.slice(-4)}`
    : "";

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
          {/* Back Button — steps 2, 3, 4 */}
          {(step === 2 || step === 3 || step === 4) && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (hapticFeedback.impactOccurred.isAvailable()) {
                  hapticFeedback.impactOccurred("light");
                }
                onStepChange((step - 1) as 1 | 2 | 3 | 4);
              }}
              className="absolute left-3 p-1.5 rounded-full flex items-center justify-center active:scale-95 transition-all duration-150"
            >
              <ArrowLeft
                size={22}
                strokeWidth={1.5}
                style={{ color: "rgba(60, 60, 67, 0.6)" }}
              />
            </button>
          )}

          {/* Step 1: Title */}
          {step === 1 && (
            <span className="text-[17px] font-semibold text-black leading-[22px]">
              Send
            </span>
          )}

          {/* Step 2: Title with token name */}
          {step === 2 && (
            <span className="text-[17px] font-semibold text-black leading-[22px]">
              Send {tokenSymbol} to
            </span>
          )}

          {/* Steps 3-5: Recipient Pill */}
          {step >= 3 && (
            <div
              className={`flex items-center px-3 py-1.5 rounded-[54px] ${
                recipient.startsWith("@")
                  ? "cursor-pointer active:scale-95 active:opacity-80 transition-all duration-150"
                  : ""
              }`}
              style={{ background: "#f2f2f7" }}
              onClick={() => {
                if (
                  recipient.startsWith("@") &&
                  openTelegramLink.isAvailable()
                ) {
                  if (hapticFeedback.impactOccurred.isAvailable()) {
                    hapticFeedback.impactOccurred("light");
                  }
                  const username = recipient.slice(1);
                  openTelegramLink(`https://t.me/${username}`);
                }
              }}
            >
              <span className="text-[14px] leading-5">
                <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>
                  {step === 5 ? "Sent to " : "Send to "}
                </span>
                <span className="text-black">{pillAddress}</span>
              </span>
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

        {/* Steps Container with Slide Animation */}
        <div
          className="relative flex-1 overflow-hidden"
          style={{ paddingBottom: Math.max(safeBottom, 24) + 80 }}
        >
          {/* STEP 1: TOKEN SELECTION */}
          <div
            className="absolute inset-0 flex flex-col overflow-y-auto transition-all duration-300 ease-out"
            style={{
              transform: `translateX(${(1 - step) * 100}%)`,
              opacity: step === 1 ? 1 : 0,
              pointerEvents: step === 1 ? "auto" : "none",
            }}
          >
            {/* Search Input */}
            <div className="px-4 pt-2 pb-3 shrink-0">
              <div
                className="flex items-center rounded-[47px] px-4"
                style={{ background: "#f2f2f7" }}
              >
                <Search
                  size={20}
                  strokeWidth={1.5}
                  className="shrink-0 mr-2"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                />
                <input
                  type="text"
                  placeholder="Search"
                  value={tokenSearchQuery}
                  onChange={(e) => setTokenSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent py-3 text-[17px] leading-[22px] text-black placeholder:text-[rgba(60,60,67,0.6)] outline-none"
                />
              </div>
            </div>

            {/* Token List */}
            {filteredTokens.map((token) => {
              const iconSrc = resolveTokenIcon(token);
              const displaySymbol =
                token.symbol === "SOL" &&
                token.name.toLowerCase().includes("wrapped")
                  ? "wSOL"
                  : token.symbol;

              return (
                <button
                  key={`${token.mint}-${token.name}-${
                    token.isSecured ? "secured" : "standard"
                  }`}
                  onClick={() => handleTokenSelect(token)}
                  className="flex items-center px-4 active:bg-black/[0.03] transition-colors"
                >
                  <div className="py-1.5 pr-3">
                    <div className="w-12 h-12 relative">
                      <div className="w-12 h-12 rounded-full overflow-hidden relative bg-[#f2f2f7]">
                        <Image
                          src={iconSrc}
                          alt={displaySymbol}
                          fill
                          className="object-contain"
                        />
                      </div>
                      {token.isSecured && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-[20px] h-[20px]">
                          <Image
                            src="/Shield.svg"
                            alt="Secured"
                            width={20}
                            height={20}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col py-2.5 min-w-0">
                    <p className="text-[17px] font-medium text-black leading-[22px] tracking-[-0.187px] text-left">
                      {displaySymbol}
                    </p>
                    <p
                      className="text-[15px] leading-5 text-left"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      {token.priceUsd !== null
                        ? `$${token.priceUsd.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        : "—"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end py-2.5 pl-3">
                    <p className="text-[17px] text-black leading-[22px] text-right">
                      {token.balance.toLocaleString("en-US", {
                        maximumFractionDigits: 4,
                      })}
                    </p>
                    <p
                      className="text-[15px] leading-5 text-right"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      {token.valueUsd !== null
                        ? `$${token.valueUsd.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        : "—"}
                    </p>
                  </div>
                </button>
              );
            })}

            {filteredTokens.length === 0 && tokenSearchQuery.trim() && (
              <div className="flex items-center justify-center py-12">
                <p
                  className="text-[17px] leading-[22px]"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                >
                  No tokens found
                </p>
              </div>
            )}
          </div>

          {/* STEP 2: RECIPIENT */}
          <div
            className="absolute inset-0 flex flex-col overflow-y-auto transition-all duration-300 ease-out"
            style={{
              transform: `translateX(${(2 - step) * 100}%)`,
              opacity: step === 2 ? 1 : 0,
              pointerEvents: step === 2 ? "auto" : "none",
            }}
          >
            {/* Search Input */}
            <div className="px-4 pt-2 pb-2">
              <div className="flex flex-col gap-2">
                <div
                  className="flex items-center rounded-[47px] overflow-hidden px-4"
                  style={{ background: "#f2f2f7" }}
                >
                  <Search
                    size={20}
                    strokeWidth={1.5}
                    className="shrink-0 mr-2"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  />
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Address or @username"
                    value={recipient}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (/^[a-zA-Z0-9@._]*$/.test(val)) {
                        setRecipient(val);
                      }
                    }}
                    className="flex-1 py-3 bg-transparent text-[17px] leading-[22px] text-black placeholder:text-[rgba(60,60,67,0.6)] outline-none"
                  />
                </div>
                {/* Validation Error */}
                {recipient.trim().length > 0 &&
                  !isValidSolanaAddress(recipient) &&
                  !isValidTelegramUsername(recipient) && (
                    <p
                      className="text-[13px] leading-4 px-1"
                      style={{ color: "#f9363c" }}
                    >
                      Invalid address
                    </p>
                  )}
              </div>
            </div>

            {/* Recent Section Header */}
            {recentRecipients.length > 0 && (
              <div className="px-4 pt-3 pb-2">
                <p className="text-base font-medium text-black tracking-[-0.176px]">
                  Recent
                </p>
              </div>
            )}

            {/* Recent Recipients List */}
            <div className="pb-4">
              {recentRecipients.map((recentItem) => {
                const isUsername = recentItem.address.startsWith("@");
                const displayName = isUsername
                  ? recentItem.address
                  : `${recentItem.address.slice(
                      0,
                      4
                    )}...${recentItem.address.slice(-4)}`;
                const avatarChar = isUsername
                  ? recentItem.address.slice(1, 2).toUpperCase()
                  : recentItem.address.slice(0, 1).toUpperCase();

                return (
                  <button
                    key={recentItem.address}
                    onClick={() => handleRecipientSelect(recentItem.address)}
                    className="w-full flex items-center px-3 py-1 rounded-2xl active:bg-black/[0.03] transition-colors"
                  >
                    <div className="py-1.5 pr-3">
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center font-medium text-lg"
                        style={{
                          background: getAvatarColor(recentItem.address),
                          color: "rgba(60, 60, 67, 0.8)",
                        }}
                      >
                        {avatarChar}
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col gap-0.5 py-2.5">
                      <p className="text-base text-black text-left leading-5">
                        {displayName}
                      </p>
                      <p
                        className="text-[13px] text-left leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        {isUsername ? "Telegram" : "Wallet address"}
                      </p>
                    </div>
                    <div className="pl-3 py-2 flex items-center justify-center h-10">
                      <ChevronIcon />
                    </div>
                  </button>
                );
              })}

              {/* Manual Entry */}
              {recipient.trim().length > 0 &&
                (isValidSolanaAddress(recipient) ||
                  isValidTelegramUsername(recipient)) && (
                  <button
                    onClick={() => handleRecipientSelect(recipient)}
                    className="w-full flex items-center px-3 py-1 rounded-2xl active:bg-black/[0.03] transition-colors"
                  >
                    <div className="py-1.5 pr-3">
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(99, 102, 241, 0.1)" }}
                      >
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 20 20"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M15.8333 5.83333V3.33333C15.8333 3.11232 15.7455 2.90036 15.5893 2.74408C15.433 2.5878 15.221 2.5 15 2.5H4.16667C3.72464 2.5 3.30072 2.67559 2.98816 2.98816C2.67559 3.30072 2.5 3.72464 2.5 4.16667C2.5 4.60869 2.67559 5.03262 2.98816 5.34518C3.30072 5.65774 3.72464 5.83333 4.16667 5.83333H16.6667C16.8877 5.83333 17.0996 5.92113 17.2559 6.07741C17.4122 6.23369 17.5 6.44565 17.5 6.66667V10M17.5 10H15C14.558 10 14.1341 10.1756 13.8215 10.4882C13.5089 10.8007 13.3333 11.2246 13.3333 11.6667C13.3333 12.1087 13.5089 12.5326 13.8215 12.8452C14.1341 13.1577 14.558 13.3333 15 13.3333H17.5C17.721 13.3333 17.933 13.2455 18.0893 13.0893C18.2455 12.933 18.3333 12.721 18.3333 12.5V10.8333C18.3333 10.6123 18.2455 10.4004 18.0893 10.2441C17.933 10.0878 17.721 10 17.5 10Z"
                            stroke="#6366f1"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M2.5 4.16656V15.8332C2.5 16.2753 2.67559 16.6992 2.98816 17.0117C3.30072 17.3243 3.72464 17.4999 4.16667 17.4999H16.6667C16.8877 17.4999 17.0996 17.4121 17.2559 17.2558C17.4122 17.0995 17.5 16.8876 17.5 16.6666V13.3332"
                            stroke="#6366f1"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col gap-0.5 py-2.5">
                      <p className="text-base text-black text-left leading-5">
                        Send to address
                      </p>
                      <p
                        className="text-[13px] text-left leading-4 truncate max-w-[200px]"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        {recipient}
                      </p>
                    </div>
                    <div className="pl-3 py-2 flex items-center justify-center h-10">
                      <ChevronIcon />
                    </div>
                  </button>
                )}
            </div>
          </div>

          {/* STEP 3: AMOUNT */}
          <div
            className="absolute inset-0 flex flex-col transition-all duration-300 ease-out"
            style={{
              transform: `translateX(${(3 - step) * 100}%)`,
              opacity: step === 3 ? 1 : 0,
              pointerEvents: step === 3 ? "auto" : "none",
            }}
            onKeyDownCapture={(e) => {
              if (e.key === "Backspace") {
                e.stopPropagation();
                if (!amountStr) {
                  e.preventDefault();
                }
              }
            }}
          >
            <div className="flex-1 flex flex-col px-4 pt-2 pb-4 gap-2.5 overflow-hidden">
              {/* Amount Input Section */}
              <div className="px-2 flex flex-col gap-1 relative">
                {/* Hidden input for keyboard */}
                <input
                  ref={amountInputRef}
                  type="text"
                  inputMode="decimal"
                  value={amountStr}
                  onFocus={(e) => {
                    const input = e.target;
                    const moveCursorToEnd = () => {
                      const len = input.value.length;
                      input.setSelectionRange(len, len);
                    };
                    setTimeout(moveCursorToEnd, 0);
                    setTimeout(moveCursorToEnd, 50);
                  }}
                  onClick={(e) => {
                    const input = e.target as HTMLInputElement;
                    setTimeout(() => {
                      const len = input.value.length;
                      input.setSelectionRange(len, len);
                    }, 50);
                  }}
                  onChange={(e) => {
                    const val = e.target.value.replace(",", ".");
                    if (/^[0-9]*\.?[0-9]*$/.test(val)) {
                      if (val.includes(".")) {
                        const [, decimals] = val.split(".");
                        if (
                          decimals &&
                          decimals.length > (currency === "SOL" ? 4 : 2)
                        ) {
                          return;
                        }
                      }
                      setAmountStr(val);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace") {
                      e.stopPropagation();
                      e.nativeEvent.stopImmediatePropagation();
                      if (!amountStr) {
                        e.preventDefault();
                      }
                    }
                  }}
                  className="absolute inset-0 opacity-0 z-10 cursor-text"
                  autoComplete="off"
                />
                {/* Amount Input Row with Switch Button */}
                <div className="flex gap-1 items-end h-[48px]">
                  <div className="flex-1 flex gap-2 items-baseline relative">
                    <p
                      ref={amountTextRef}
                      className="text-[40px] font-semibold leading-[48px]"
                      style={{
                        color: insufficientBalance ? "#f9363c" : "#000",
                      }}
                    >
                      {amountStr || "\u200B"}
                    </p>
                    <p
                      className="text-[28px] font-semibold leading-8 tracking-[0.4px]"
                      style={{
                        color: insufficientBalance
                          ? "#f9363c"
                          : "rgba(60, 60, 67, 0.6)",
                      }}
                    >
                      {currency === "SOL" ? tokenSymbol : currency}
                    </p>
                    {/* Caret */}
                    <div
                      className="absolute w-[1.5px] h-[44px] top-1/2 -translate-y-1/2"
                      style={{
                        left: `${caretLeft}px`,
                        background: "#f9363c",
                        animation: "blink 1s step-end infinite",
                      }}
                    />
                  </div>
                  {/* Currency Switch Button */}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!solPriceUsd) return;
                      if (hapticFeedback.selectionChanged.isAvailable()) {
                        hapticFeedback.selectionChanged();
                      }
                      if (amountStr) {
                        const val = parseFloat(amountStr);
                        if (!isNaN(val)) {
                          if (currency === "SOL") {
                            setAmountStr((val * solPriceUsd).toFixed(2));
                          } else {
                            setAmountStr((val / solPriceUsd).toFixed(4));
                          }
                        }
                      }
                      setCurrency(currency === "SOL" ? "USD" : "SOL");
                    }}
                    disabled={isSolPriceLoading || !solPriceUsd}
                    className="z-20 shrink-0 mb-1 disabled:opacity-20 disabled:pointer-events-none"
                    style={{ color: "rgba(60, 60, 67, 0.4)" }}
                  >
                    <ArrowUpDownIcon />
                  </button>
                </div>
                {/* Secondary display */}
                <p
                  className="text-base leading-5 h-[22px]"
                  style={{
                    color: insufficientBalance
                      ? "#f9363c"
                      : "rgba(60, 60, 67, 0.6)",
                  }}
                >
                  {insufficientBalance
                    ? "Not enough coins"
                    : `1 ${currency === "SOL" ? tokenSymbol : currency} ≈ ${
                        currency === "SOL"
                          ? solPriceUsd
                            ? `$${solPriceUsd.toFixed(2)}`
                            : "$—"
                          : solPriceUsd
                          ? `${(1 / solPriceUsd).toFixed(6)} ${tokenSymbol}`
                          : `— ${tokenSymbol}`
                      }`}
                </p>
              </div>

              {/* Quick Amount Presets */}
              <div className="flex gap-2 w-full">
                {[0.1, 0.2, 0.5, 1].map((val) => (
                  <button
                    key={val}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handlePresetAmount(val)}
                    className="flex-1 min-w-[48px] px-3 py-2 rounded-[40px] text-sm font-normal leading-5 text-center transition-all active:opacity-70"
                    style={{
                      background: "rgba(249, 54, 60, 0.14)",
                      color: "#f9363c",
                    }}
                  >
                    {val}
                  </button>
                ))}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (currency === "SOL") {
                      const maxVal = truncateDecimals(
                        Math.max(0, maxSendAmountInSol),
                        4
                      ).replace(/\.?0+$/, "");
                      handlePresetAmount(maxVal || "0");
                    } else {
                      const maxVal = truncateDecimals(
                        Math.max(0, maxSendAmountInUsd),
                        2
                      ).replace(/\.?0+$/, "");
                      handlePresetAmount(maxVal || "0");
                    }
                  }}
                  className="flex-1 min-w-[48px] px-3 py-2 rounded-[40px] text-sm font-normal leading-5 text-center transition-all active:opacity-70"
                  style={{
                    background: "rgba(249, 54, 60, 0.14)",
                    color: "#f9363c",
                  }}
                >
                  Max
                </button>
              </div>

              {/* Balance Card */}
              <div className="flex items-center pl-3 pr-4 py-1 overflow-hidden">
                <div className="py-1.5 pr-3">
                  <div className="w-12 h-12 relative">
                    <div className="w-12 h-12 overflow-hidden flex items-center justify-center">
                      <Image
                        src="/tokens/solana-sol-logo.png"
                        alt="Solana"
                        width={48}
                        height={48}
                      />
                    </div>
                    {selectedToken?.isSecured && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-[20px] h-[20px]">
                        <Image
                          src="/Shield.svg"
                          alt="Secured"
                          width={20}
                          height={20}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex-1 flex flex-col gap-0.5 py-2.5">
                  <p className="text-base leading-5 text-black">Balance</p>
                  <p
                    className="text-[13px] leading-4"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    {abbreviatedAddress}
                  </p>
                </div>
                <div className="flex flex-col gap-0.5 items-end py-2.5 pl-3">
                  <p className="text-base leading-5 text-black text-right">
                    {truncateDecimals(balanceInSol, 4)} {tokenSymbol}
                  </p>
                  <p
                    className="text-[13px] leading-4 text-right"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    ~
                    {balanceInUsd !== null
                      ? `$${truncateDecimals(balanceInUsd, 2)}`
                      : "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* STEP 4: CONFIRMATION */}
          <div
            className="absolute inset-0 flex flex-col overflow-y-auto transition-all duration-300 ease-out"
            style={{
              transform: `translateX(${(4 - step) * 100}%)`,
              opacity: step === 4 ? 1 : 0,
              pointerEvents: step === 4 ? "auto" : "none",
            }}
          >
            {/* Amount Display */}
            <div className="px-4 pt-2 pb-4">
              <div className="px-2 flex flex-col gap-1">
                <div className="flex gap-2 items-baseline h-[48px]">
                  <p className="text-[40px] font-semibold leading-[48px] text-black">
                    {(() => {
                      const val = parseFloat(amountStr);
                      if (isNaN(val)) return "0";
                      if (currency === "USD") {
                        if (!solPriceUsd) return "0";
                        return (
                          (val / solPriceUsd)
                            .toFixed(4)
                            .replace(/\.?0+$/, "") || "0"
                        );
                      }
                      return amountStr || "0";
                    })()}
                  </p>
                  <p
                    className="text-[28px] font-semibold leading-8 tracking-[0.4px]"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    {tokenSymbol}
                  </p>
                </div>
                <p
                  className="text-base leading-[22px]"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                >
                  {(() => {
                    const val = parseFloat(amountStr);
                    if (isNaN(val)) return "≈$0.00";
                    const usdVal =
                      currency === "SOL"
                        ? solPriceUsd
                          ? val * solPriceUsd
                          : null
                        : val;
                    if (usdVal === null) return "≈$—";
                    return `≈$${usdVal.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`;
                  })()}
                </p>
                {recipient.startsWith("@") && (
                  <p
                    className="text-[11px] leading-[14px] mt-1"
                    style={{ color: "#eab308" }}
                  >
                    ⚠️ Usernames are case-sensitive. Double-check spelling.
                  </p>
                )}
              </div>
            </div>

            {/* Payment Details */}
            <div className="px-4 pt-3 flex flex-col gap-2">
              {/* Transfer Fee */}
              <div
                className="flex items-center pl-3 pr-4 py-1 rounded-[20px]"
                style={{ background: "#f2f2f7" }}
              >
                <div className="flex-1 flex flex-col gap-0.5 py-2.5">
                  <p
                    className="text-[13px] leading-4"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    Transfer fee
                  </p>
                  <div className="flex items-baseline text-base leading-5">
                    <span className="text-black">
                      {sendFeeReserveSol.toFixed(6).replace(/\.?0+$/, "")} SOL
                    </span>
                    <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>
                      {sendFeeUsd !== null
                        ? ` ≈ $${sendFeeUsd.toFixed(2)}`
                        : " ≈ $—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Total Amount */}
              <div
                className="flex items-center pl-3 pr-4 py-1 rounded-[20px]"
                style={{ background: "#f2f2f7" }}
              >
                <div className="flex-1 flex flex-col gap-0.5 py-2.5">
                  <p
                    className="text-[13px] leading-4"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    Total amount
                  </p>
                  <div className="flex items-baseline text-base leading-5">
                    <span className="text-black">
                      {(() => {
                        const val = parseFloat(amountStr);
                        const feeStr = sendFeeReserveSol.toFixed(6).replace(
                          /\.?0+$/,
                          ""
                        );
                        if (isNaN(val)) {
                          return sendFlow === "direct-sol-send"
                            ? `${feeStr} ${tokenSymbol}`
                            : `${feeStr} SOL`;
                        }
                        const solVal =
                          currency === "SOL"
                            ? val
                            : solPriceUsd
                            ? val / solPriceUsd
                            : NaN;
                        if (sendFlow !== "direct-sol-send") {
                          if (isNaN(solVal)) return `${feeStr} SOL`;
                          const amountLabel =
                            currency === "SOL"
                              ? `${solVal.toFixed(6).replace(/\.?0+$/, "")} ${tokenSymbol}`
                              : `${val.toFixed(2).replace(/\.?0+$/, "")} USD`;
                          return `${amountLabel} + ${feeStr} SOL`;
                        }
                        const total = solVal + sendFeeReserveSol;
                        if (isNaN(total)) return `${feeStr} ${tokenSymbol}`;
                        return `${total.toFixed(6).replace(/\.?0+$/, "")} ${tokenSymbol}`;
                      })()}
                    </span>
                    <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>
                      {(() => {
                        const val = parseFloat(amountStr);
                        if (isNaN(val)) {
                          return sendFeeUsd !== null
                            ? ` ≈ $${sendFeeUsd.toFixed(2)}`
                            : " ≈ $—";
                        }
                        const usdVal =
                          currency === "SOL"
                            ? solPriceUsd
                              ? val * solPriceUsd
                              : null
                            : val;
                        if (usdVal === null) {
                          return " ≈ $—";
                        }
                        const totalUsd =
                          sendFeeUsd !== null
                            ? usdVal + sendFeeUsd
                            : usdVal;
                        return ` ≈ $${totalUsd.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`;
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* STEP 5: RESULT (in-progress / success / error) */}
          <div
            className="absolute inset-0 flex flex-col transition-all duration-300 ease-out"
            style={{
              transform: `translateX(${(5 - step) * 100}%)`,
              opacity: step === 5 ? 1 : 0,
              pointerEvents: step === 5 ? "auto" : "none",
            }}
          >
            {isSending ? (
              /* In Progress */
              <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
                <div className="relative w-[72px] h-[72px] mb-5">
                  <Image
                    src="/icons/Loader.png"
                    alt="Loading"
                    width={72}
                    height={72}
                    className="animate-spin"
                  />
                </div>
                <div className="flex flex-col gap-2 items-center text-center max-w-[280px]">
                  <h2 className="text-xl font-semibold text-black leading-6">
                    {tokenSymbol} is on its way
                  </h2>
                  <p
                    className="text-base leading-5"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    Your transaction is being processed and will be completed
                    shortly
                  </p>
                </div>
              </div>
            ) : sendError ? (
              /* Error */
              <ErrorResult error={sendError} />
            ) : (
              /* Success */
              <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
                <div className="relative mb-5">
                  <Image
                    src="/dogs/dog-green.png"
                    alt="Success"
                    width={96}
                    height={96}
                  />
                </div>
                <div className="flex flex-col gap-2 items-center text-center max-w-[280px]">
                  <h2 className="text-xl font-semibold text-black leading-6">
                    {tokenSymbol} sent
                  </h2>
                  <p
                    className="text-base leading-5"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    <span className="text-black">
                      {sentAmountSol?.toFixed(4).replace(/\.?0+$/, "") || "0"}{" "}
                      {tokenSymbol}
                    </span>{" "}
                    successfully sent to{" "}
                    <span className="text-black">{pillAddress}</span>
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
