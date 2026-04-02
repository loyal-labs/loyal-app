"use client";

import { ArrowDownUp, ChevronRight, Globe, Send, Share, Wallet, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { usePrivateSend } from "@/hooks/use-private-send";
import { useSend } from "@/hooks/use-send";
import {
  openTrackedLink,
  trackWalletSendPressed,
} from "@/lib/core/analytics";

import type { ActivityRow, SubView, SwapToken, TransactionDetail } from "./types";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";
const red = "#F9363C";

function isValidSolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

// Username must be between 5 and 32 characters.
// Username can only contain lowercase alphanumeric characters and underscores.
// We should allow mixed case usernames for UI but convert to lowercase before send.
// Source: https://limits.tginfo.me/en
// Source: https://telegram.org/faq#q-what-can-i-use-as-my-username
function isTelegramUsername(value: string): boolean {
  if (!value.startsWith("@")) {
    return false;
  }
  const trimmed = value.replace(/^@/, "");

  return (
    /^[a-zA-Z0-9_]+$/.test(trimmed) && trimmed.length >= 5 && trimmed.length <= 32
  );
}


function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

type SendPhase = "form" | "processing" | "success" | "error" | "details";

function SendStatusHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px" }}>
      <div style={{ flex: 1, paddingLeft: "12px", paddingTop: "4px", paddingBottom: "4px", minWidth: 0 }}>
        <span style={{ fontFamily: font, fontSize: "18px", fontWeight: 600, lineHeight: "28px", color: "#000", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </span>
      </div>
      <button
        className="send-status-close"
        onClick={onClose}
        style={{ width: "36px", height: "36px", display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0, 0, 0, 0.04)", border: "none", borderRadius: "9999px", cursor: "pointer", transition: "all 0.2s ease", color: "#3C3C43", flexShrink: 0 }}
        type="button"
      >
        <X size={24} />
      </button>
    </div>
  );
}

function SendProcessing({
  token,
  onClose,
}: {
  token: SwapToken;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .send-status-close:hover { background: rgba(0, 0, 0, 0.08) !important; }
        @keyframes sendSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      <SendStatusHeader onClose={onClose} title="Send" />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", alignItems: "center", padding: "24px 32px" }}>
          <div style={{ width: "80px", height: "80px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                border: "4px solid transparent",
                borderTopColor: red,
                borderRightColor: red,
                borderRadius: "9999px",
                animation: "sendSpin 1s linear infinite",
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center", textAlign: "center" }}>
            <span style={{ fontFamily: font, fontSize: "20px", fontWeight: 600, lineHeight: "24px", color: "#000" }}>
              {token.symbol} is on its way
            </span>
            <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: secondary, maxWidth: "285px" }}>
              Your transaction is being processed and will be completed shortly
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 20px" }}>
        <button
          disabled
          style={{ width: "100%", padding: "12px 16px", borderRadius: "9999px", background: "#CCCDCD", border: "none", cursor: "default", fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#fff", textAlign: "center" }}
          type="button"
        >
          In progress...
        </button>
      </div>
    </div>
  );
}

function SendResult({
  variant,
  token,
  amount,
  recipient,
  isTgRecipient,
  errorMessage,
  onClose,
  onDone,
  onDetails,
}: {
  variant: "success" | "error";
  token: SwapToken;
  amount: string;
  recipient: string;
  isTgRecipient: boolean;
  errorMessage?: string;
  onClose: () => void;
  onDone: () => void;
  onDetails: () => void;
}) {
  const isSuccess = variant === "success";
  const displayRecipient = isTgRecipient ? recipient : truncateAddress(recipient);
  const headerTitle = isSuccess ? `Send to ${displayRecipient}` : "Send";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .send-status-close:hover { background: rgba(0, 0, 0, 0.08) !important; }
        .send-done-btn:hover { background: #333 !important; }
        .send-done-secondary-btn:hover { background: rgba(0, 0, 0, 0.08) !important; }
        @keyframes mascotNod {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(4deg); }
          75% { transform: rotate(-4deg); }
        }
      `}</style>

      <SendStatusHeader onClose={onClose} title={headerTitle} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", alignItems: "center", padding: "24px 32px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={isSuccess ? "Success" : "Error"}
            src={isSuccess ? "/hero-new/success.svg" : "/hero-new/error.svg"}
            style={{ width: "100px", height: "80px", animation: "mascotNod 0.6s ease-in-out 2", transformOrigin: "center bottom" }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center", textAlign: "center" }}>
            <span style={{ fontFamily: font, fontSize: "20px", fontWeight: 600, lineHeight: "24px", color: "#000" }}>
              {isSuccess ? `${token.symbol} sent` : "Send failed"}
            </span>
            {isSuccess ? (
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: secondary, maxWidth: "255px" }}>
                <span style={{ color: "#000" }}>{amount} {token.symbol}</span>
                {" successfully sent to "}
                <span style={{ color: "#000" }}>{displayRecipient}</span>
              </span>
            ) : (
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: secondary, maxWidth: "255px" }}>
                {errorMessage || "Something went wrong. Please try again."}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "8px" }}>
        {isSuccess && (
          <button
            className="send-done-btn"
            onClick={onDetails}
            style={{ width: "100%", padding: "12px 16px", borderRadius: "9999px", background: "#000", border: "none", cursor: "pointer", fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#fff", textAlign: "center", transition: "background 0.15s ease" }}
            type="button"
          >
            Transaction Details
          </button>
        )}
        <button
          className={isSuccess ? "send-done-secondary-btn" : "send-done-btn"}
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

function SendTransactionDetail({
  token,
  amount,
  recipient,
  isTgRecipient,
  usdValue,
  signature,
  isPrivate,
  onClose,
  onDone,
}: {
  token: SwapToken;
  amount: string;
  recipient: string;
  isTgRecipient: boolean;
  usdValue: string;
  signature?: string;
  isPrivate?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const publicEnv = usePublicEnv();
  const displayRecipient = isTgRecipient ? recipient : truncateAddress(recipient);
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .send-status-close:hover { background: rgba(0, 0, 0, 0.08) !important; }
        .send-tx-action-btn:hover { background: rgba(249, 54, 60, 0.22) !important; }
        .send-tx-done-btn:hover { background: #333 !important; }
      `}</style>

      <SendStatusHeader onClose={onClose} title={`Send to ${displayRecipient}`} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px", overflowY: "auto" }}>
        {/* Amount hero */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 12px 24px", width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", fontFamily: font, fontWeight: 600, whiteSpace: "nowrap" }}>
              <span style={{ fontSize: "40px", lineHeight: "48px", color: red }}>−{amount}</span>
              <span style={{ fontSize: "28px", lineHeight: "32px", color: "rgba(60, 60, 67, 0.4)", letterSpacing: "0.4px" }}>{token.symbol}</span>
            </div>
            <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: secondary }}>≈{usdValue}</span>
            <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: secondary }}>{dateStr}, {timeStr}</span>
          </div>
        </div>

        {/* Details card */}
        <div style={{ width: "100%" }}>
          <div style={{ background: "rgba(0, 0, 0, 0.04)", borderRadius: "16px", padding: "4px 0", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "9px 12px" }}>
              <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary, display: "block" }}>Recipient</span>
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#000", display: "block", marginTop: "2px", wordBreak: "break-all" }}>{recipient}</span>
            </div>
            <div style={{ padding: "9px 12px" }}>
              <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary, display: "block" }}>Status</span>
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#000", display: "block", marginTop: "2px" }}>Completed</span>
            </div>
            <div style={{ padding: "9px 12px" }}>
              <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary, display: "block" }}>Network Fee</span>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "2px", fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px" }}>
                <span style={{ color: "#000" }}>0.00005 SOL</span>
                <span style={{ color: secondary }}>≈ $0.00</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", paddingTop: "20px", paddingBottom: "16px", width: "100%" }}>
          {!isPrivate && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <button
                className="send-tx-action-btn"
                onClick={() =>
                  signature &&
                  openTrackedLink(publicEnv, {
                    href: `https://explorer.solana.com/tx/${signature}`,
                    linkText: "View in explorer",
                    source: "send_transaction_detail",
                  })
                }
                style={{ width: "48px", height: "48px", borderRadius: "9999px", background: "rgba(249, 54, 60, 0.14)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: signature ? "pointer" : "default", opacity: signature ? 1 : 0.5, transition: "background-color 0.15s ease" }}
                type="button"
              >
                <Globe size={24} style={{ color: "#3C3C43" }} />
              </button>
              <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary, textAlign: "center" }}>View in explorer</span>
            </div>
          )}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <button
              className="send-tx-action-btn"
              onClick={() => {
                if (isPrivate) {
                  void navigator.clipboard.writeText(`Sent ${amount} ${token.symbol} to ${displayRecipient} (${usdValue})`);
                } else if (signature) {
                  void navigator.clipboard.writeText(`https://explorer.solana.com/tx/${signature}`);
                }
              }}
              style={{ width: "48px", height: "48px", borderRadius: "9999px", background: "rgba(249, 54, 60, 0.14)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: isPrivate || signature ? "pointer" : "default", opacity: isPrivate || signature ? 1 : 0.5, transition: "background-color 0.15s ease" }}
              type="button"
            >
              <Share size={24} style={{ color: "#3C3C43" }} />
            </button>
            <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary, textAlign: "center" }}>Share</span>
          </div>
        </div>
      </div>

      {/* Done button */}
      <div style={{ padding: "16px 20px" }}>
        <button
          className="send-tx-done-btn"
          onClick={onDone}
          style={{ width: "100%", padding: "12px 16px", borderRadius: "9999px", background: "#000", border: "none", cursor: "pointer", fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#fff", textAlign: "center", transition: "background 0.15s ease" }}
          type="button"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export function SendContent({
  onClose,
  onDone,
  onNavigate,
  token,
  addLocalActivity,
}: {
  onClose: () => void;
  onDone: () => void;
  onNavigate: (view: SubView) => void;
  token: SwapToken;
  addLocalActivity?: (row: ActivityRow, detail: TransactionDetail) => void;
}) {
  const publicEnv = usePublicEnv();
  const { executeSend } = useSend();
  const { executePrivateSend } = usePrivateSend();
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [phase, setPhase] = useState<SendPhase>("form");
  const [resultAmount, setResultAmount] = useState("");
  const [resultUsd, setResultUsd] = useState("");
  const [resultRecipient, setResultRecipient] = useState("");
  const [resultIsTg, setResultIsTg] = useState(false);
  const [resultSignature, setResultSignature] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const numericAmount = Number.parseFloat(amount) || 0;
  const hasAmount = numericAmount > 0;
  const insufficientFunds = numericAmount > token.balance;
  const amountColor = insufficientFunds && hasAmount ? red : "#000";

  const usdValue = useMemo(() => (numericAmount * token.price).toFixed(2), [numericAmount, token.price]);

  const recipientTrimmed = recipient.trim();
  const hasRecipient = recipientTrimmed.length > 0;
  const startsWithAt = recipientTrimmed.startsWith("@");
  const isTg = isTelegramUsername(recipientTrimmed);
  const isWallet = isValidSolanaAddress(recipientTrimmed);
  const isValidRecipient = isTg || isWallet;
  const showInvalidHint = hasRecipient && !isValidRecipient && !startsWithAt;
  const isTgNonSol = isTg && token.symbol.toUpperCase() !== "SOL";

  const buttonLabel = !hasAmount
    ? "Enter Amount"
    : insufficientFunds
      ? "Insufficient Funds"
      : !hasRecipient
        ? "Enter Recipient"
        : !isValidRecipient
          ? "Invalid Address"
          : isTgNonSol
            ? "Only SOL for Telegram"
            : "Send";
  const buttonDisabled = !hasAmount || insufficientFunds || !isValidRecipient || isTgNonSol;

  const handlePercentage = useCallback(
    (pct: number) => {
      const val = pct === 100 ? token.balance : token.balance * (pct / 100);
      setAmount(val > 0 ? String(Number(val.toFixed(6))) : "");
    },
    [token.balance],
  );

  const handleConfirm = useCallback(async () => {
    const currentAmount = hasAmount ? String(numericAmount) : "0";
    const currentUsd = `$${hasAmount ? (numericAmount * token.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0"}`;
    setResultAmount(currentAmount);
    setResultUsd(currentUsd);
    setResultRecipient(recipientTrimmed);
    setResultIsTg(isTg);
    setResultSignature(undefined);
    setErrorMessage(undefined);
    setPhase("processing");

    const destinationType = isTg ? "telegram" : "wallet";
    const cleanRecipient = isTg ? recipientTrimmed.replace(/^@/, "") : recipientTrimmed;

    trackWalletSendPressed(publicEnv, {
      source: "send_confirm",
      interaction: "confirm",
      token_symbol: token.symbol,
      token_mint: token.mint,
      amount: currentAmount,
      usd_value: currentUsd,
      destination_type: destinationType,
      is_private: isPrivate,
    });

    let result: { success: boolean; signature?: string; error?: string };

    if (isPrivate || isTg) {
      result = await executePrivateSend({
        tokenSymbol: token.symbol,
        amount: numericAmount,
        recipient: cleanRecipient,
        recipientType: destinationType,
        tokenMint: token.mint,
        successTrackingProperties: {
          token_symbol: token.symbol,
          token_mint: token.mint,
          amount: currentAmount,
          usd_value: currentUsd,
          destination_type: destinationType,
          is_private: isPrivate || isTg,
        },
      });
    } else {
      result = await executeSend(
        token.symbol,
        currentAmount,
        cleanRecipient,
        token.mint,
        undefined,
        {
          token_symbol: token.symbol,
          token_mint: token.mint,
          amount: currentAmount,
          usd_value: currentUsd,
          destination_type: destinationType,
          is_private: false,
        }
      );
    }

    if (result.success) {
      setResultSignature(result.signature);
      setPhase("success");
      setAmount("");
      setRecipient("");

      if (isPrivate && addLocalActivity) {
        const now = new Date();
        const syntheticRow: ActivityRow = {
          id: result.signature ?? `private-${Date.now()}`,
          type: "sent",
          counterparty: cleanRecipient,
          amount: `-${currentAmount} ${token.symbol}`,
          timestamp: now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
          date: now.toLocaleDateString("en-US", { month: "long", day: "numeric" }),
          icon: "/hero-new/Shield_40.svg",
          isPrivate: true,
          rawTimestamp: now.getTime(),
        };
        const syntheticDetail: TransactionDetail = {
          activity: syntheticRow,
          usdValue: currentUsd,
          status: "Completed",
          networkFee: "0.00005 SOL",
          networkFeeUsd: "$0.00",
          isPrivate: true,
        };
        addLocalActivity(syntheticRow, syntheticDetail);
      }
    } else {
      setErrorMessage(result.error);
      setPhase("error");
    }
  }, [addLocalActivity, executePrivateSend, executeSend, hasAmount, isPrivate, isTg, numericAmount, publicEnv, recipientTrimmed, token.mint, token.price, token.symbol]);

  // Cross-fade between phases
  const [phaseOpacity, setPhaseOpacity] = useState(1);
  const [displayPhase, setDisplayPhase] = useState<SendPhase>(phase);
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (phase !== prevPhase.current) {
      setPhaseOpacity(0);
      const t = setTimeout(() => {
        setDisplayPhase(phase);
        setPhaseOpacity(1);
        prevPhase.current = phase;
      }, 200);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const renderPhaseContent = (p: SendPhase) => {
    if (p === "processing") {
      return <SendProcessing onClose={onClose} token={token} />;
    }
    if (p === "success" || p === "error") {
      return (
        <SendResult
          amount={resultAmount}
          errorMessage={errorMessage}
          isTgRecipient={resultIsTg}
          onClose={onClose}
          onDetails={() => setPhase("details")}
          onDone={onDone}
          recipient={resultRecipient}
          token={token}
          variant={p}
        />
      );
    }
    if (p === "details") {
      return (
        <SendTransactionDetail
          amount={resultAmount}
          isPrivate={isPrivate}
          isTgRecipient={resultIsTg}
          onClose={onClose}
          onDone={onDone}
          recipient={resultRecipient}
          signature={resultSignature}
          token={token}
          usdValue={resultUsd}
        />
      );
    }

    // Form phase
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <style jsx>{`
          .send-close:hover { background: rgba(0, 0, 0, 0.08) !important; }
          .pct-btn:hover { opacity: 0.7; }
          .confirm-btn:not(:disabled):hover { background: #333 !important; }
          .private-card:hover { background: rgba(0, 0, 0, 0.06) !important; }
          .clear-btn:hover { opacity: 0.7; }
        `}</style>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px" }}>
          <div style={{ flex: 1, paddingLeft: "12px", paddingTop: "4px", paddingBottom: "4px" }}>
            <span style={{ fontFamily: font, fontSize: "18px", fontWeight: 600, lineHeight: "28px", color: "#000" }}>Send</span>
          </div>
          <button
            className="send-close"
            onClick={onClose}
            style={{ width: "36px", height: "36px", display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0, 0, 0, 0.04)", border: "none", borderRadius: "9999px", cursor: "pointer", transition: "all 0.2s ease", color: "#3C3C43" }}
            type="button"
          >
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px", overflow: "auto", padding: "8px 8px 16px" }}>
          {/* Amount card */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ background: "#fff", borderRadius: "16px", padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: font, fontWeight: 400, lineHeight: "20px", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: "16px", color: secondary }}>Amount</span>
                <div style={{ display: "flex", gap: "16px", alignItems: "center", fontSize: "14px", color: red }}>
                  <button className="pct-btn" onClick={() => handlePercentage(25)} style={{ background: "none", border: "none", cursor: "pointer", color: red, fontFamily: font, fontSize: "14px", fontWeight: 400, padding: 0 }} type="button">25%</button>
                  <button className="pct-btn" onClick={() => handlePercentage(50)} style={{ background: "none", border: "none", cursor: "pointer", color: red, fontFamily: font, fontSize: "14px", fontWeight: 400, padding: 0 }} type="button">50%</button>
                  <button className="pct-btn" onClick={() => handlePercentage(100)} style={{ background: "none", border: "none", cursor: "pointer", color: red, fontFamily: font, fontSize: "14px", fontWeight: 400, padding: 0 }} type="button">Max</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: "4px", height: "48px", alignItems: "center" }}>
                <input
                  inputMode="decimal"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
                  }}
                  placeholder="0"
                  style={{ flex: 1, fontFamily: font, fontSize: "32px", fontWeight: 600, lineHeight: "36px", color: amountColor, background: "none", border: "none", outline: "none", padding: 0, minWidth: 0 }}
                  type="text"
                  value={amount}
                />
                <button
                  onClick={() => onNavigate({ type: "sendTokenSelect" })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: "#F5F5F5",
                    borderRadius: "54px",
                    padding: "0 4px",
                    border: "none",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                  type="button"
                >
                  <div style={{ display: "flex", alignItems: "center", paddingRight: "6px", padding: "4px 6px 4px 4px" }}>
                    <div style={{ width: "28px", height: "28px", borderRadius: "9999px", overflow: "hidden" }}>
                      <Image alt={token.symbol} height={28} src={token.icon} style={{ width: "100%", height: "100%", objectFit: "cover" }} width={28} />
                    </div>
                  </div>
                  <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 500, lineHeight: "20px", color: "#000", letterSpacing: "-0.176px", whiteSpace: "nowrap", padding: "8px 0" }}>
                    {token.symbol}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "36px", padding: "8px 0" }}>
                    <ChevronRight size={16} style={{ color: "#3C3C43" }} />
                  </div>
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <div style={{ width: "20px", height: "20px", borderRadius: "9999px", background: "#F5F5F5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <ArrowDownUp size={12} style={{ color: secondary, opacity: 0.4 }} />
                  </div>
                  <span style={{ fontFamily: font, fontSize: "14px", fontWeight: 400, lineHeight: "20px", color: secondary }}>
                    {hasAmount ? `≈$${Number(usdValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `1 ${token.symbol} ≈ $${token.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`}
                  </span>
                </div>
                <span style={{ fontFamily: font, fontSize: "14px", fontWeight: 400, lineHeight: "20px", color: secondary }}>
                  Balance: {token.balance.toLocaleString()}{" "}
                </span>
              </div>
            </div>

            {/* Recipient section */}
            <div style={{ padding: "12px 12px 8px" }}>
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: secondary }}>Recipient</span>
            </div>
            <div style={{ background: "#fff", borderRadius: "16px", display: "flex", alignItems: "flex-start", padding: "0 12px", overflow: "hidden" }}>
              {hasRecipient && (
                <div style={{ display: "flex", alignItems: "center", paddingRight: "12px", flexShrink: 0, color: "#3C3C43", paddingTop: "15px" }}>
                  {startsWithAt ? <Send size={20} /> : <Wallet size={20} />}
                </div>
              )}
              <textarea
                onChange={(e) => setRecipient(e.target.value.replace(/\n/g, ""))}
                placeholder="Address or Telegram username"
                rows={1}
                style={{ flex: 1, fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#000", background: "none", border: "none", outline: "none", padding: "15px 0", minWidth: 0, resize: "none", overflow: "hidden", wordBreak: "break-all", fieldSizing: "content" } as React.CSSProperties}
                value={recipient}
              />
              {hasRecipient && (
                <button
                  className="clear-btn"
                  onClick={() => setRecipient("")}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "15px 0 15px 12px", background: "none", border: "none", cursor: "pointer", color: "#3C3C43", flexShrink: 0 }}
                  type="button"
                >
                  <X size={20} />
                </button>
              )}
            </div>
            {showInvalidHint && (
              <div style={{ padding: "4px 12px 0" }}>
                <span style={{ fontFamily: font, fontSize: "14px", fontWeight: 400, lineHeight: "20px", color: red }}>Invalid address</span>
              </div>
            )}
          </div>

          {/* Private Send card */}
          <div
            className="private-card"
            onClick={() => setIsPrivate(!isPrivate)}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 12px",
              borderRadius: "16px",
              cursor: "pointer",
              background: isPrivate ? "rgba(0, 0, 0, 0.04)" : "transparent",
              transition: "background 0.15s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", paddingRight: "12px", paddingTop: "4px", paddingBottom: "4px", flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Private" src="/hero-new/Shield_40.svg" style={{ width: "40px", height: "40px" }} />
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", padding: "10px 0", minWidth: 0 }}>
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#000" }}>Private Send</span>
              <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary }}>
                Prevents the recipient from seeing which wallet sent the funds
              </span>
            </div>
            <div style={{ paddingLeft: "12px", flexShrink: 0 }}>
              <div
                style={{
                  width: "51px",
                  height: "31px",
                  borderRadius: "100px",
                  background: isPrivate ? red : "rgba(0, 0, 0, 0.04)",
                  position: "relative",
                  transition: "background 0.2s ease",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    transform: "translateY(-50%)",
                    left: isPrivate ? "22px" : "2px",
                    width: "27px",
                    height: "27px",
                    borderRadius: "100px",
                    background: "#fff",
                    boxShadow: "0px 0px 0px 0px rgba(0,0,0,0.04), 0px 3px 8px 0px rgba(0,0,0,0.15), 0px 3px 1px 0px rgba(0,0,0,0.06)",
                    transition: "left 0.2s ease",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom button */}
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
