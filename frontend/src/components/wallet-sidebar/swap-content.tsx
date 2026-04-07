"use client";

import { ArrowDownUp, ArrowLeft, ChevronRight, Globe, Share, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { useSwap } from "@/hooks/use-swap";
import {
  openTrackedLink,
  trackWalletSwapPressed,
} from "@/lib/core/analytics";

import { SwapShieldTabs } from "./shield-content";
import type { FormButtonProps, SubView, SwapMode, SwapToken } from "./types";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";
const red = "#F9363C";

function TokenPill({
  token,
  variant,
  onClick,
}: {
  token: SwapToken;
  variant: "from" | "to";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        background: variant === "from" ? "rgba(0, 0, 0, 0.08)" : "#F5F5F5",
        borderRadius: "54px",
        padding: "0 4px",
        border: "none",
        cursor: "pointer",
        flexShrink: 0,
      }}
      type="button"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          paddingRight: "6px",
          padding: "4px 6px 4px 4px",
        }}
      >
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "9999px",
            overflow: "hidden",
          }}
        >
          <Image
            alt={token.symbol}
            height={28}
            src={token.icon}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            width={28}
          />
        </div>
      </div>
      <span
        style={{
          fontFamily: font,
          fontSize: "16px",
          fontWeight: 500,
          lineHeight: "20px",
          color: "#000",
          letterSpacing: "-0.176px",
          whiteSpace: "nowrap",
          padding: "8px 0",
        }}
      >
        {token.symbol}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "36px",
          padding: "8px 0",
        }}
      >
        <ChevronRight size={16} style={{ color: "#3C3C43" }} />
      </div>
    </button>
  );
}

type SwapPhase = "form" | "processing" | "success" | "error" | "details";

function SwapStatusHeader({
  fromToken,
  toToken,
  onClose,
  onBack,
}: {
  fromToken: SwapToken;
  toToken: SwapToken;
  onClose: () => void;
  onBack?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px",
        gap: "8px",
      }}
    >
      {onBack && (
        <button
          className="swap-status-close"
          onClick={onBack}
          style={{
            width: "36px",
            height: "36px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.04)",
            border: "none",
            borderRadius: "9999px",
            cursor: "pointer",
            transition: "all 0.2s ease",
            color: "#3C3C43",
            flexShrink: 0,
          }}
          type="button"
        >
          <ArrowLeft size={24} />
        </button>
      )}
      <div
        style={{
          flex: 1,
          paddingLeft: onBack ? "0" : "12px",
          paddingTop: "4px",
          paddingBottom: "4px",
          textAlign: onBack ? "center" : undefined,
        }}
      >
        <span
          style={{
            fontFamily: font,
            fontSize: "18px",
            fontWeight: 600,
            lineHeight: "28px",
            color: "#000",
          }}
        >
          Swap {fromToken.symbol} to {toToken.symbol}
        </span>
      </div>
      <button
        className="swap-status-close"
        onClick={onClose}
        style={{
          width: "36px",
          height: "36px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: "rgba(0, 0, 0, 0.04)",
          border: "none",
          borderRadius: "9999px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          color: "#3C3C43",
          flexShrink: 0,
        }}
        type="button"
      >
        <X size={24} />
      </button>
    </div>
  );
}

function SwapProcessing({
  fromToken,
  toToken,
  onClose,
  onBack,
}: {
  fromToken: SwapToken;
  toToken: SwapToken;
  onClose: () => void;
  onBack?: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .swap-status-close:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        @keyframes chevronBounce {
          0%,
          100% {
            transform: translateX(0);
          }
          50% {
            transform: translateX(4px);
          }
        }
      `}</style>

      <SwapStatusHeader
        fromToken={fromToken}
        onBack={onBack}
        onClose={onClose}
        toToken={toToken}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            alignItems: "center",
            padding: "24px 32px",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "16px",
              alignItems: "center",
              padding: "8px 0",
            }}
          >
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "9999px",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <Image
                alt={fromToken.symbol}
                height={64}
                src={fromToken.icon}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                width={64}
              />
            </div>
            <ChevronRight
              size={16}
              style={{
                color: secondary,
                animation: "chevronBounce 1s ease-in-out infinite",
              }}
            />
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "9999px",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <Image
                alt={toToken.symbol}
                height={64}
                src={toToken.icon}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                width={64}
              />
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <span
              style={{
                fontFamily: font,
                fontSize: "20px",
                fontWeight: 600,
                lineHeight: "24px",
                color: "#000",
              }}
            >
              Swapping...
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 20px" }}>
        <button
          disabled
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: "9999px",
            background: "#CCCDCD",
            border: "none",
            cursor: "default",
            fontFamily: font,
            fontSize: "16px",
            fontWeight: 400,
            lineHeight: "20px",
            color: "#fff",
            textAlign: "center",
          }}
          type="button"
        >
          In progress...
        </button>
      </div>
    </div>
  );
}

function SwapResult({
  variant,
  fromToken,
  toToken,
  receivedAmount,
  errorMessage,
  onClose,
  onDone,
  onDetails,
  onBack,
}: {
  variant: "success" | "error";
  fromToken: SwapToken;
  toToken: SwapToken;
  receivedAmount: string;
  errorMessage?: string;
  onClose: () => void;
  onDone: () => void;
  onDetails: () => void;
  onBack?: () => void;
}) {
  const isSuccess = variant === "success";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .swap-status-close:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .done-btn:hover {
          background: #333 !important;
        }
        .done-secondary-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        @keyframes mascotNod {
          0%,
          100% {
            transform: rotate(0deg);
          }
          25% {
            transform: rotate(4deg);
          }
          75% {
            transform: rotate(-4deg);
          }
        }
      `}</style>

      <SwapStatusHeader
        fromToken={fromToken}
        onBack={onBack}
        onClose={onClose}
        toToken={toToken}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            alignItems: "center",
            padding: "24px 32px",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={isSuccess ? "Success" : "Error"}
            src={isSuccess ? "/hero-new/success.svg" : "/hero-new/error.svg"}
            style={{
              width: "100px",
              height: "80px",
              animation: "mascotNod 0.6s ease-in-out 2",
              transformOrigin: "center bottom",
            }}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <span
              style={{
                fontFamily: font,
                fontSize: "20px",
                fontWeight: 600,
                lineHeight: "24px",
                color: "#000",
              }}
            >
              {isSuccess ? "Swap Completed" : "Swap Failed"}
            </span>
            {isSuccess ? (
              <span
                style={{
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: secondary,
                  maxWidth: "255px",
                }}
              >
                <span style={{ color: "#000" }}>
                  {receivedAmount} {toToken.symbol}
                </span>
                {" has been deposited to your wallet"}
              </span>
            ) : (
              <span
                style={{
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: secondary,
                  maxWidth: "255px",
                }}
              >
                {errorMessage || "Something went wrong. Please try again."}
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {isSuccess && (
          <button
            className="done-btn"
            onClick={onDetails}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: "9999px",
              background: "#000",
              border: "none",
              cursor: "pointer",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "#fff",
              textAlign: "center",
              transition: "background 0.15s ease",
            }}
            type="button"
          >
            Transaction Details
          </button>
        )}
        <button
          className={isSuccess ? "done-secondary-btn" : "done-btn"}
          onClick={onDone}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: "9999px",
            background: isSuccess ? "rgba(0, 0, 0, 0.04)" : "#000",
            border: "none",
            cursor: "pointer",
            fontFamily: font,
            fontSize: "16px",
            fontWeight: 400,
            lineHeight: "20px",
            color: isSuccess ? "#000" : "#fff",
            textAlign: "center",
            transition: "background 0.15s ease",
          }}
          type="button"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function SwapTransactionDetail({
  fromToken,
  toToken,
  receivedAmount,
  usdValue,
  signature,
  onClose,
  onDone,
  onBack,
}: {
  fromToken: SwapToken;
  toToken: SwapToken;
  receivedAmount: string;
  usdValue: string;
  signature?: string;
  onClose: () => void;
  onDone: () => void;
  onBack?: () => void;
}) {
  const publicEnv = usePublicEnv();
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .swap-status-close:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .swap-tx-action-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .swap-tx-done-btn:hover {
          background: #333 !important;
        }
      `}</style>

      <SwapStatusHeader
        fromToken={fromToken}
        onBack={onBack}
        onClose={onClose}
        toToken={toToken}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "8px",
          overflowY: "auto",
        }}
      >
        {/* Amount hero */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px 12px 24px",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
                fontFamily: font,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  fontSize: "40px",
                  lineHeight: "48px",
                  color: "#34C759",
                }}
              >
                +{receivedAmount}
              </span>
              <span
                style={{
                  fontSize: "28px",
                  lineHeight: "32px",
                  color: "rgba(60, 60, 67, 0.4)",
                  letterSpacing: "0.4px",
                }}
              >
                {toToken.symbol}
              </span>
            </div>
            <span
              style={{
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: secondary,
              }}
            >
              ≈{usdValue}
            </span>
            <span
              style={{
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: secondary,
              }}
            >
              {dateStr}, {timeStr}
            </span>
          </div>
        </div>

        {/* Details card */}
        <div style={{ width: "100%" }}>
          <div
            style={{
              background: "rgba(0, 0, 0, 0.04)",
              borderRadius: "16px",
              padding: "4px 0",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "9px 12px" }}>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  color: secondary,
                  display: "block",
                }}
              >
                Status
              </span>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: "#000",
                  display: "block",
                  marginTop: "2px",
                }}
              >
                Completed
              </span>
            </div>
            <div style={{ padding: "9px 12px" }}>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  color: secondary,
                  display: "block",
                }}
              >
                Network Fee
              </span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  marginTop: "2px",
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                }}
              >
                <span style={{ color: "#000" }}>0.00005 SOL</span>
                <span style={{ color: secondary }}>≈ $0.00</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            paddingTop: "20px",
            paddingBottom: "16px",
            width: "100%",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <button
              className="swap-tx-action-btn"
              onClick={() =>
                signature &&
                openTrackedLink(publicEnv, {
                  href: `https://explorer.solana.com/tx/${signature}`,
                  linkText: "View in explorer",
                  source: "swap_transaction_detail",
                })
              }
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "9999px",
                background: "rgba(249, 54, 60, 0.14)",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: signature ? "pointer" : "default",
                opacity: signature ? 1 : 0.5,
                transition: "background-color 0.15s ease",
              }}
              type="button"
            >
              <Globe size={24} style={{ color: "#3C3C43" }} />
            </button>
            <span
              style={{
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 400,
                lineHeight: "16px",
                color: secondary,
                textAlign: "center",
              }}
            >
              View in explorer
            </span>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <button
              className="swap-tx-action-btn"
              onClick={() =>
                signature &&
                void navigator.clipboard.writeText(
                  `https://explorer.solana.com/tx/${signature}`
                )
              }
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "9999px",
                background: "rgba(249, 54, 60, 0.14)",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: signature ? "pointer" : "default",
                opacity: signature ? 1 : 0.5,
                transition: "background-color 0.15s ease",
              }}
              type="button"
            >
              <Share size={24} style={{ color: "#3C3C43" }} />
            </button>
            <span
              style={{
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 400,
                lineHeight: "16px",
                color: secondary,
                textAlign: "center",
              }}
            >
              Share
            </span>
          </div>
        </div>
      </div>

      {/* Done button */}
      <div style={{ padding: "16px 20px" }}>
        <button
          className="swap-tx-done-btn"
          onClick={onDone}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: "9999px",
            background: "#000",
            border: "none",
            cursor: "pointer",
            fontFamily: font,
            fontSize: "16px",
            fontWeight: 400,
            lineHeight: "20px",
            color: "#fff",
            textAlign: "center",
            transition: "background 0.15s ease",
          }}
          type="button"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export function SwapContent({
  onClose,
  onDone,
  onNavigate,
  onBack,
  fromToken: fromTokenProp,
  toToken: toTokenProp,
  onFromTokenChange,
  onToTokenChange,
  swapMode,
  onSwapModeChange,
  hideFormChrome,
  onFormActiveChange,
  onFormButtonChange,
}: {
  onClose: () => void;
  onDone: () => void;
  onNavigate: (view: Exclude<SubView, null>) => void;
  onBack?: () => void;
  fromToken: SwapToken;
  toToken: SwapToken;
  onFromTokenChange: (t: SwapToken) => void;
  onToTokenChange: (t: SwapToken) => void;
  swapMode: SwapMode;
  onSwapModeChange: (mode: SwapMode) => void;
  hideFormChrome?: boolean;
  onFormActiveChange?: (isForm: boolean) => void;
  onFormButtonChange?: (props: FormButtonProps | null) => void;
}) {
  const publicEnv = usePublicEnv();
  const {
    getQuote,
    executeSwap,
    resetQuote,
    quote,
    isAvailable,
    unavailableReason,
    error: swapError,
  } = useSwap();
  const [fromAmount, setFromAmount] = useState("");
  const [phase, setPhase] = useState<SwapPhase>("form");
  const [resultAmount, setResultAmount] = useState("");
  const [resultUsd, setResultUsd] = useState("");
  const [resultSignature, setResultSignature] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isQuoting, setIsQuoting] = useState(false);
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onFormActiveChange?.(phase === "form");
  }, [phase, onFormActiveChange]);

  const fromToken = fromTokenProp;
  const toToken = toTokenProp;

  const numericFrom = Number.parseFloat(fromAmount) || 0;

  // Use quote output amount when available, fall back to price ratio estimate
  const toAmount = useMemo(() => {
    if (numericFrom <= 0) return 0;
    if (quote?.outputAmount) return Number.parseFloat(quote.outputAmount);
    if (toToken.price <= 0) return 0;
    return (numericFrom * fromToken.price) / toToken.price;
  }, [numericFrom, fromToken.price, toToken.price, quote]);

  const toUsd = useMemo(() => {
    const val = toAmount * toToken.price;
    return Number.isFinite(val) ? val.toFixed(2) : "0.00";
  }, [toAmount, toToken.price]);
  const hasAmount = numericFrom > 0;
  const insufficientFunds = numericFrom > fromToken.balance;

  // Debounced quote fetching
  useEffect(() => {
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    if (!hasAmount || insufficientFunds || phase !== "form") {
      resetQuote();
      setIsQuoting(false);
      return;
    }
    setIsQuoting(true);
    quoteTimerRef.current = setTimeout(() => {
      void getQuote(
        fromToken.symbol,
        toToken.symbol,
        String(numericFrom),
        fromToken.mint,
        undefined,
        undefined,
        toToken.mint
      ).finally(() => setIsQuoting(false));
    }, 500);
    return () => {
      if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    };
  }, [
    fromAmount,
    fromToken.symbol,
    fromToken.mint,
    toToken.symbol,
    toToken.mint,
    hasAmount,
    insufficientFunds,
    phase,
    getQuote,
    resetQuote,
    numericFrom,
  ]);

  const buttonLabel = !isAvailable
    ? unavailableReason ?? "Swap unavailable"
    : !hasAmount
    ? "Enter Amount"
    : insufficientFunds
    ? "Insufficient Funds"
    : isQuoting
    ? "Getting quote..."
    : !quote
    ? "Enter Amount"
    : "Confirm and Swap";
  const buttonDisabled =
    !isAvailable || !hasAmount || insufficientFunds || isQuoting || !quote;
  const amountColor = insufficientFunds && hasAmount ? red : "#000";

  const handleSwapTokens = useCallback(() => {
    const prevFrom = fromToken;
    const prevTo = toToken;
    onFromTokenChange(prevTo);
    onToTokenChange(prevFrom);
    if (numericFrom > 0 && prevTo.price > 0) {
      const usdValue = numericFrom * prevFrom.price;
      const converted = usdValue / prevTo.price;
      setFromAmount(String(Number(converted.toFixed(6))));
    } else if (numericFrom > 0) {
      setFromAmount("");
    }
  }, [fromToken, toToken, onFromTokenChange, onToTokenChange, numericFrom]);

  const handleConfirm = useCallback(async () => {
    if (!quote) return;
    const completedAmount = hasAmount ? Number(toAmount.toFixed(6)).toString() : "0";
    const completedUsd = `$${
      hasAmount
        ? (toAmount * toToken.price).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : "0"
    }`;

    trackWalletSwapPressed(publicEnv, {
      source: "swap_confirm",
      interaction: "confirm",
      from_symbol: fromToken.symbol,
      from_mint: fromToken.mint,
      to_symbol: toToken.symbol,
      to_mint: toToken.mint,
      from_amount: fromAmount,
      to_amount: completedAmount,
      usd_value: completedUsd,
    });

    setResultAmount(completedAmount);
    setResultUsd(completedUsd);
    setResultSignature(undefined);
    setErrorMessage(undefined);
    setPhase("processing");

    const result = await executeSwap({
      from_symbol: fromToken.symbol,
      from_mint: fromToken.mint,
      to_symbol: toToken.symbol,
      to_mint: toToken.mint,
      from_amount: fromAmount,
      to_amount: completedAmount,
      usd_value: completedUsd,
    });

    if (result.success) {
      setResultSignature(result.signature);
      setPhase("success");
      setFromAmount("");
      resetQuote();
    } else {
      setErrorMessage(result.error);
      setPhase("error");
    }
  }, [executeSwap, fromAmount, fromToken.mint, fromToken.symbol, hasAmount, publicEnv, quote, resetQuote, toAmount, toToken.mint, toToken.price, toToken.symbol]);

  // Report form button props to parent when chrome is managed externally
  useEffect(() => {
    if (!hideFormChrome || !onFormButtonChange) return;
    if (phase !== "form") {
      onFormButtonChange(null);
      return;
    }
    onFormButtonChange({
      label: buttonLabel,
      disabled: buttonDisabled,
      onClick: handleConfirm,
    });
  }, [hideFormChrome, onFormButtonChange, phase, buttonLabel, buttonDisabled, handleConfirm]);

  // Cross-fade between phases
  const [phaseOpacity, setPhaseOpacity] = useState(1);
  const [displayPhase, setDisplayPhase] = useState<SwapPhase>(phase);
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (phase !== prevPhase.current) {
      setPhaseOpacity(0); // fade out
      const t = setTimeout(() => {
        setDisplayPhase(phase); // swap content while near-invisible
        setPhaseOpacity(1); // fade in
        prevPhase.current = phase;
      }, 200);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const handlePercentage = useCallback(
    (pct: number) => {
      let val =
        pct === 100 ? fromToken.balance : fromToken.balance * (pct / 100);
      if (fromToken.symbol.toUpperCase() === "SOL" && fromToken.balance - val < 0.00005) {
        val = Math.max(0, fromToken.balance - 0.00005);
      }
      setFromAmount(val > 0 ? String(Number(val.toFixed(6))) : "");
    },
    [fromToken.balance, fromToken.symbol]
  );

  const renderPhaseContent = (p: SwapPhase) => {
    if (p === "processing") {
      return (
        <SwapProcessing
          fromToken={fromToken}
          onBack={onBack}
          onClose={onClose}
          toToken={toToken}
        />
      );
    }
    if (p === "success" || p === "error") {
      return (
        <SwapResult
          errorMessage={errorMessage}
          fromToken={fromToken}
          onBack={onBack}
          onClose={onClose}
          onDetails={() => setPhase("details")}
          onDone={onDone}
          receivedAmount={resultAmount}
          toToken={toToken}
          variant={p}
        />
      );
    }
    if (p === "details") {
      return (
        <SwapTransactionDetail
          fromToken={fromToken}
          onBack={onBack}
          onClose={onClose}
          onDone={onDone}
          receivedAmount={resultAmount}
          signature={resultSignature}
          toToken={toToken}
          usdValue={resultUsd}
        />
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <style jsx>{`
          .swap-close:hover {
            background: rgba(0, 0, 0, 0.08) !important;
          }
          .pct-btn:hover {
            opacity: 0.7;
          }
          .swap-circle:hover {
            background: #333 !important;
          }
          .confirm-btn:not(:disabled):hover {
            background: #333 !important;
          }
        `}</style>

        {/* Header with tabs — hidden when parent owns chrome */}
        {!hideFormChrome && (
          <SwapShieldTabs
            mode={swapMode}
            onClose={onClose}
            onModeChange={onSwapModeChange}
          />
        )}

        {/* Body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            overflow: "auto",
            padding: "8px 8px 16px",
          }}
        >
          {/* Swap inputs container */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              position: "relative",
              isolation: "isolate",
              overflow: "visible",
            }}
          >
            {/* From card */}
            <div
              style={{
                border: "1px solid rgba(0, 0, 0, 0.08)",
                borderRadius: "16px",
                padding: "10px 12px",
                position: "relative",
                zIndex: 2,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontFamily: font,
                  fontWeight: 400,
                  lineHeight: "20px",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ fontSize: "16px", color: secondary }}>
                  You swap
                </span>
                <div
                  style={{
                    display: "flex",
                    gap: "16px",
                    alignItems: "center",
                    fontSize: "14px",
                    color: red,
                  }}
                >
                  <button
                    className="pct-btn"
                    onClick={() => handlePercentage(25)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: red,
                      fontFamily: font,
                      fontSize: "14px",
                      fontWeight: 400,
                      padding: 0,
                    }}
                    type="button"
                  >
                    25%
                  </button>
                  <button
                    className="pct-btn"
                    onClick={() => handlePercentage(50)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: red,
                      fontFamily: font,
                      fontSize: "14px",
                      fontWeight: 400,
                      padding: 0,
                    }}
                    type="button"
                  >
                    50%
                  </button>
                  <button
                    className="pct-btn"
                    onClick={() => handlePercentage(100)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: red,
                      fontFamily: font,
                      fontSize: "14px",
                      fontWeight: 400,
                      padding: 0,
                    }}
                    type="button"
                  >
                    Max
                  </button>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  height: "48px",
                  alignItems: "center",
                }}
              >
                <input
                  inputMode="decimal"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d*\.?\d*$/.test(v)) setFromAmount(v);
                  }}
                  placeholder="0"
                  style={{
                    flex: 1,
                    fontFamily: font,
                    fontSize: "32px",
                    fontWeight: 600,
                    lineHeight: "36px",
                    color: amountColor,
                    background: "none",
                    border: "none",
                    outline: "none",
                    padding: 0,
                    minWidth: 0,
                  }}
                  type="text"
                  value={fromAmount}
                />
                <TokenPill
                  onClick={() =>
                    onNavigate({ type: "tokenSelect", field: "from" })
                  }
                  token={fromToken}
                  variant="from"
                />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{ display: "flex", gap: "6px", alignItems: "center" }}
                >
                  <div
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "9999px",
                      background: "#F5F5F5",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ArrowDownUp
                      size={12}
                      style={{ color: secondary, opacity: 0.4 }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: font,
                      fontSize: "14px",
                      fontWeight: 400,
                      lineHeight: "20px",
                      color: secondary,
                    }}
                  >
                    1 {fromToken.symbol} ≈ $
                    {fromToken.price.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    })}
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "14px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: secondary,
                  }}
                >
                  Balance: {fromToken.balance.toLocaleString()}{" "}
                </span>
              </div>

              {/* Swap circle */}
              <button
                className="swap-circle"
                onClick={handleSwapTokens}
                style={{
                  position: "absolute",
                  bottom: "-18px",
                  left: "calc(50% + 4px)",
                  transform: "translateX(-50%)",
                  width: "28px",
                  height: "28px",
                  borderRadius: "9999px",
                  background: "#000",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  zIndex: 3,
                  transition: "background 0.15s ease",
                }}
                type="button"
              >
                <ArrowDownUp size={16} style={{ color: "#fff" }} />
              </button>
            </div>

            {/* To card */}
            <div
              style={{
                border: "1px solid rgba(0, 0, 0, 0.08)",
                borderRadius: "16px",
                padding: "12px",
                zIndex: 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: secondary,
                  }}
                >
                  You receive
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  height: "48px",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontFamily: font,
                    fontSize: "32px",
                    fontWeight: 600,
                    lineHeight: "36px",
                    color:
                      insufficientFunds && hasAmount
                        ? red
                        : hasAmount
                        ? "#000"
                        : secondary,
                    minWidth: 0,
                  }}
                >
                  {hasAmount ? Number(toAmount.toFixed(6)).toString() : "0"}
                </span>
                <TokenPill
                  onClick={() =>
                    onNavigate({ type: "tokenSelect", field: "to" })
                  }
                  token={toToken}
                  variant="to"
                />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "14px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: secondary,
                  }}
                >
                  $
                  {hasAmount
                    ? Number(toUsd).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : "0"}
                </span>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "14px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: secondary,
                  }}
                >
                  Balance: {toToken.balance.toLocaleString()}{" "}
                </span>
              </div>
            </div>
          </div>

          {/* Details card (only when amount entered) */}
          {hasAmount && (
            <div
              style={{
                background: "rgba(0, 0, 0, 0.04)",
                borderRadius: "16px",
                padding: "4px 0",
              }}
            >
              <div style={{ padding: "10px 12px" }}>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 400,
                    lineHeight: "16px",
                    color: secondary,
                    display: "block",
                  }}
                >
                  Rate
                </span>
                <div
                  style={{
                    display: "flex",
                    gap: "4px",
                    alignItems: "center",
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    marginTop: "2px",
                  }}
                >
                  <span style={{ color: "#000" }}>1 {toToken.symbol}</span>
                  <span style={{ color: secondary }}>
                    ≈{" "}
                    {fromToken.price > 0
                      ? (toToken.price / fromToken.price).toFixed(2)
                      : "—"}
                  </span>
                </div>
              </div>
              <div style={{ padding: "10px 12px" }}>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 400,
                    lineHeight: "16px",
                    color: secondary,
                    display: "block",
                  }}
                >
                  Slippage
                </span>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: "#000",
                    display: "block",
                    marginTop: "2px",
                  }}
                >
                  1%
                </span>
              </div>
              <div style={{ padding: "10px 12px" }}>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 400,
                    lineHeight: "16px",
                    color: secondary,
                    display: "block",
                  }}
                >
                  Network Fee
                </span>
                <div
                  style={{
                    display: "flex",
                    gap: "4px",
                    alignItems: "center",
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    marginTop: "2px",
                  }}
                >
                  <span style={{ color: "#000" }}>0.00005 SOL</span>
                  <span style={{ color: secondary }}>≈ $0.00</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom button — hidden when parent owns chrome */}
        {!hideFormChrome && (
          <div style={{ padding: "16px 20px" }}>
            <button
              className="confirm-btn"
              disabled={buttonDisabled}
              onClick={handleConfirm}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "9999px",
                background: buttonDisabled ? "#CCCDCD" : "#000",
                border: "none",
                cursor: buttonDisabled ? "default" : "pointer",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#fff",
                textAlign: "center",
                transition: "background 0.15s ease",
              }}
              type="button"
            >
              {buttonLabel}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        opacity: phaseOpacity,
        transition: "opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {renderPhaseContent(displayPhase)}
    </div>
  );
}
