"use client";

import { Check, Globe, Share } from "lucide-react";
import { useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { openTrackedLink } from "@/lib/core/analytics";
import { SubViewHeader } from "./shared";
import type { TransactionDetail } from "./types";

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function TransactionDetailView({
  detail,
  onBack,
  onClose,
}: {
  detail: TransactionDetail;
  onBack: () => void;
  onClose: () => void;
}) {
  const publicEnv = usePublicEnv();
  const [copied, setCopied] = useState(false);
  const isSent = detail.activity.type === "sent";
  const isShielded = detail.activity.type === "shielded";
  const isUnshielded = detail.activity.type === "unshielded";
  const isPrivate = detail.isPrivate || detail.activity.isPrivate;
  const isShieldType = isShielded || isUnshielded;
  const title = isShielded ? "Shielded" : isUnshielded ? "Unshielded" : isSent ? "Sent" : "Received";
  // Strip the +/− prefix for the large display
  const rawAmount = detail.activity.amount.replace(/^[+\u2212-]/, "");
  const parts = rawAmount.split(" ");
  const amountNum = parts[0];
  const amountToken = parts[1] || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .tx-action-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .tx-back-btn:hover,
        .tx-close-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
      `}</style>

      {/* Header */}
      <SubViewHeader onBack={onBack} onClose={onClose} title={title} />

      {/* Content */}
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
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  fontSize: "40px",
                  lineHeight: "48px",
                  color: isSent || isShieldType ? "#000" : "#34C759",
                }}
              >
                {isShieldType ? "" : isSent ? "\u2212" : "+"}{amountNum}
              </span>
              <span
                style={{
                  fontSize: "28px",
                  lineHeight: "32px",
                  color: "rgba(60, 60, 67, 0.4)",
                  letterSpacing: "0.4px",
                }}
              >
                {amountToken}
              </span>
            </div>
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "rgba(60, 60, 67, 0.6)",
              }}
            >
              ≈{detail.usdValue}
            </span>
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "rgba(60, 60, 67, 0.6)",
              }}
            >
              {detail.activity.date}, {detail.activity.timestamp}
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
            {/* Status */}
            <div style={{ padding: "9px 12px" }}>
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  color: "rgba(60, 60, 67, 0.6)",
                  display: "block",
                }}
              >
                Status
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: "#000",
                  display: "block",
                  marginTop: "2px",
                }}
              >
                {detail.status}
              </span>
            </div>

            {/* Sender / Recipient */}
            <div style={{ padding: "9px 12px" }}>
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  color: "rgba(60, 60, 67, 0.6)",
                  display: "block",
                }}
              >
                {isShielded ? "Moved to" : isUnshielded ? "Moved from" : isSent ? "Recipient" : "Sender"}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: "#000",
                  display: "block",
                  marginTop: "2px",
                }}
              >
                {isShielded ? "Secure balance" : isUnshielded ? "Secure balance" : truncateAddress(detail.activity.counterparty)}
              </span>
            </div>

            {/* Network Fee */}
            <div style={{ padding: "9px 12px" }}>
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  color: "rgba(60, 60, 67, 0.6)",
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
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                }}
              >
                <span style={{ color: "#000" }}>{detail.networkFee}</span>
                <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>
                  ≈ {detail.networkFeeUsd}
                </span>
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
          {/* View in explorer */}
          {!isPrivate && (
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
                className="tx-action-btn"
                onClick={() =>
                  openTrackedLink(publicEnv, {
                    href: `https://explorer.solana.com/tx/${detail.activity.id}`,
                    linkText: "View in explorer",
                    source: "transaction_detail",
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
                  cursor: "pointer",
                  transition: "background-color 0.15s ease",
                }}
                type="button"
              >
                <Globe size={24} style={{ color: "#3C3C43" }} />
              </button>
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  color: "rgba(60, 60, 67, 0.6)",
                  textAlign: "center",
                }}
              >
                View in explorer
              </span>
            </div>
          )}

          {/* Share */}
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
              className="tx-action-btn"
              onClick={() => {
                const text = isPrivate
                  ? `Sent ${rawAmount} ${amountToken} (${detail.usdValue}) to ${truncateAddress(detail.activity.counterparty)}`
                  : isShieldType
                    ? `${title} ${rawAmount} ${amountToken} (${detail.usdValue})\nhttps://explorer.solana.com/tx/${detail.activity.id}`
                    : `${title} ${rawAmount} ${amountToken} (${detail.usdValue}) ${isSent ? "to" : "from"} ${truncateAddress(detail.activity.counterparty)}\nhttps://explorer.solana.com/tx/${detail.activity.id}`;
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "9999px",
                background: "rgba(249, 54, 60, 0.14)",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "background-color 0.15s ease",
              }}
              type="button"
            >
              {copied ? (
                <Check size={24} style={{ color: "#34C759" }} />
              ) : (
                <Share size={24} style={{ color: "#3C3C43" }} />
              )}
            </button>
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "13px",
                fontWeight: 400,
                lineHeight: "16px",
                color: copied ? "#34C759" : "rgba(60, 60, 67, 0.6)",
                textAlign: "center",
                transition: "color 0.15s ease",
              }}
            >
              {copied ? "Copied" : "Share"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
