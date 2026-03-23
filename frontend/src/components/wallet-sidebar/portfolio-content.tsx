"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";

import { ActivityRowItem } from "./activity-row-item";
import { TokenRowItem } from "./token-row-item";
import type {
  ActivityRow,
  SubView,
  TokenRow,
  TransactionDetail,
} from "./types";

const skeletonBar = (width: string, height: string) => ({
  width,
  height,
  borderRadius: "6px",
  background: "rgba(0, 0, 0, 0.06)",
  animation: "skeleton-pulse 1.5s ease-in-out infinite",
});

const skeletonCircle = (size: string) => ({
  width: size,
  height: size,
  borderRadius: "9999px",
  background: "rgba(0, 0, 0, 0.06)",
  flexShrink: 0 as const,
  animation: "skeleton-pulse 1.5s ease-in-out infinite",
});

function SkeletonTokenRow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 12px",
        width: "100%",
      }}
    >
      <div style={skeletonCircle("40px")} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column" as const,
          gap: "6px",
        }}
      >
        <div style={skeletonBar("80px", "14px")} />
        <div style={skeletonBar("50px", "12px")} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column" as const,
          alignItems: "flex-end" as const,
          gap: "6px",
        }}
      >
        <div style={skeletonBar("60px", "14px")} />
        <div style={skeletonBar("40px", "12px")} />
      </div>
    </div>
  );
}

function SkeletonActivityRow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 12px",
        width: "100%",
      }}
    >
      <div style={skeletonCircle("36px")} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column" as const,
          gap: "6px",
        }}
      >
        <div style={skeletonBar("100px", "14px")} />
        <div style={skeletonBar("60px", "12px")} />
      </div>
      <div style={skeletonBar("50px", "14px")} />
    </div>
  );
}

export function PortfolioContent({
  activityRows,
  balanceFraction,
  balanceSolLabel,
  balanceWhole,
  isBalanceHidden,
  isLoading,
  onBalanceHiddenChange,
  onDisconnect,
  onNavigate,
  tokenRows,
  transactionDetails,
  walletAddress,
  walletLabel,
}: {
  activityRows: ActivityRow[];
  balanceFraction: string;
  balanceSolLabel: string;
  balanceWhole: string;
  isBalanceHidden: boolean;
  isLoading: boolean;
  onBalanceHiddenChange: (hidden: boolean) => void;
  onDisconnect?: () => void;
  onNavigate: (view: SubView) => void;
  tokenRows: TokenRow[];
  transactionDetails: Record<string, TransactionDetail>;
  walletAddress: string | null;
  walletLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopyAddress = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!walletAddress) return;
      void navigator.clipboard.writeText(walletAddress).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [walletAddress]
  );
  if (isLoading) {
    return (
      <>
        <style jsx>{`
          @keyframes skeleton-pulse {
            0%,
            100% {
              opacity: 1;
            }
            50% {
              opacity: 0.4;
            }
          }
        `}</style>

        {/* Balance skeleton */}
        <div
          style={{
            display: "flex",
            gap: "16px",
            alignItems: "flex-start",
            padding: "20px 20px 12px",
            width: "100%",
          }}
        >
          <div style={skeletonCircle("64px")} />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={skeletonBar("100px", "16px")} />
            <div style={skeletonBar("140px", "28px")} />
            <div style={skeletonBar("70px", "14px")} />
          </div>
        </div>

        {/* Tokens skeleton */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "8px",
              width: "100%",
            }}
          >
            <div style={{ padding: "12px 12px 8px" }}>
              <div style={skeletonBar("60px", "16px")} />
            </div>
            <SkeletonTokenRow />
            <SkeletonTokenRow />
            <SkeletonTokenRow />
          </div>

          {/* Activity skeleton */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "8px",
              width: "100%",
            }}
          >
            <div style={{ padding: "12px 12px 8px" }}>
              <div style={skeletonBar("70px", "16px")} />
            </div>
            <SkeletonActivityRow />
            <SkeletonActivityRow />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* SVG pixelation filters */}
      <svg
        aria-hidden="true"
        height="0"
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          overflow: "hidden",
        }}
        width="0"
      >
        <defs>
          <filter id="rs-pixelate-lg" x="0" y="0" width="100%" height="100%">
            <feFlood x="4" y="4" height="2" width="2" />
            <feComposite width="10" height="10" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="5" />
          </filter>
          <filter id="rs-pixelate-sm" x="0" y="0" width="100%" height="100%">
            <feFlood x="3" y="3" height="2" width="2" />
            <feComposite width="8" height="8" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="4" />
          </filter>
        </defs>
      </svg>

      {/* Balance section */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          alignItems: "flex-start",
          padding: "20px 20px 12px",
          borderRadius: "20px",
          width: "100%",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "9999px",
            border: "0.533px solid rgba(0, 0, 0, 0.08)",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <Image
            alt="Wallet"
            height={64}
            src="/hero-new/Wallet-Cover.png"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            width={64}
          />
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "14px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "rgba(60, 60, 67, 0.6)",
                display: "flex",
                alignItems: "center",
                gap: "3px",
              }}
            >
              {walletLabel}
              {walletAddress && (
                <button
                  onClick={handleCopyAddress}
                  style={{
                    background: "none",
                    border: "none",
                    padding: "1px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    color: copied ? "#34C759" : "rgba(60, 60, 67, 0.35)",
                    transition: "color 0.15s ease",
                    flexShrink: 0,
                  }}
                  type="button"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              )}
            </span>
            {onDisconnect && (
              <button
                onClick={onDisconnect}
                style={{
                  background: "rgba(60, 60, 67, 0.06)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "2px 8px",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "12px",
                  fontWeight: 500,
                  lineHeight: "18px",
                  color: "rgba(60, 60, 67, 0.45)",
                  cursor: "pointer",
                  transition: "background 0.15s ease, color 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(60, 60, 67, 0.1)";
                  e.currentTarget.style.color = "rgba(60, 60, 67, 0.6)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(60, 60, 67, 0.06)";
                  e.currentTarget.style.color = "rgba(60, 60, 67, 0.45)";
                }}
                type="button"
              >
                Disconnect
              </button>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div style={{ borderRadius: "8px", overflow: "hidden" }}>
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "28px",
                  fontWeight: 600,
                  lineHeight: "32px",
                  color: isBalanceHidden ? "#BBBBC0" : "#000",
                  filter: isBalanceHidden ? "url(#rs-pixelate-lg)" : "none",
                  transition: "filter 0.15s ease, color 0.15s ease",
                  userSelect: isBalanceHidden ? "none" : "auto",
                  display: "block",
                }}
              >
                {balanceWhole}
                <span
                  style={{
                    color: isBalanceHidden
                      ? "#BBBBC0"
                      : "rgba(60, 60, 67, 0.6)",
                    transition: "color 0.15s ease",
                  }}
                >
                  {balanceFraction}
                </span>
              </span>
            </div>
            <button
              onClick={() => onBalanceHiddenChange(!isBalanceHidden)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
              }}
              type="button"
            >
              {isBalanceHidden ? (
                <EyeOff
                  size={22}
                  strokeWidth={1.5}
                  style={{ color: "rgba(60, 60, 67, 0.5)" }}
                />
              ) : (
                <Eye
                  size={22}
                  strokeWidth={1.5}
                  style={{ color: "rgba(60, 60, 67, 0.5)" }}
                />
              )}
            </button>
          </div>
          <div style={{ borderRadius: "6px", overflow: "hidden" }}>
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "14px",
                fontWeight: 400,
                lineHeight: "20px",
                color: isBalanceHidden ? "#C8C8CC" : "rgba(60, 60, 67, 0.6)",
                filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                transition: "filter 0.15s ease, color 0.15s ease",
                userSelect: isBalanceHidden ? "none" : "auto",
                display: "block",
              }}
            >
              {balanceSolLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Scrollable content area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {/* Tokens section */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "8px",
            width: "100%",
          }}
        >
          <div
            style={{
              width: "100%",
              padding: "12px 12px 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "16px",
                fontWeight: 500,
                lineHeight: "20px",
                color: "#000",
                letterSpacing: "-0.176px",
              }}
            >
              Tokens
            </span>
            <button
              onClick={() => onNavigate("allTokens")}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.7";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#F9363C",
              }}
              type="button"
            >
              See All
            </button>
          </div>

          {tokenRows.map((token) => (
            <TokenRowItem
              isBalanceHidden={isBalanceHidden}
              key={token.id ?? token.symbol}
              token={token}
            />
          ))}
        </div>

        {/* Activity section */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "8px",
            width: "100%",
          }}
        >
          <div
            style={{
              width: "100%",
              padding: "12px 12px 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "16px",
                fontWeight: 500,
                lineHeight: "20px",
                color: "#000",
                letterSpacing: "-0.176px",
              }}
            >
              Activity
            </span>
            <button
              onClick={() => onNavigate("allActivity")}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.7";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#F9363C",
              }}
              type="button"
            >
              See All
            </button>
          </div>

          {activityRows.map((activity) => (
            <ActivityRowItem
              activity={activity}
              isBalanceHidden={isBalanceHidden}
              key={activity.id}
              onClick={() =>
                onNavigate({
                  type: "transaction",
                  detail: transactionDetails[activity.id],
                  from: "portfolio",
                })
              }
            />
          ))}

          {!isLoading && activityRows.length === 0 && (
            <div
              style={{
                padding: "12px 20px",
                textAlign: "center",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "14px",
                color: "rgba(60, 60, 67, 0.6)",
              }}
            >
              No activity yet
            </div>
          )}
        </div>
      </div>

      <p
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: "11px",
          fontWeight: 400,
          lineHeight: "16px",
          color: "rgba(60, 60, 67, 0.3)",
          textAlign: "center",
          padding: "8px 0 12px",
          flexShrink: 0,
        }}
      >
        Token logos by Logo.dev
      </p>
    </>
  );
}
