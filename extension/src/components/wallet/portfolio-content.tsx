import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Settings,
  Shield,
} from "lucide-react";
import { useCallback, useState } from "react";

import type {
  ActivityRow,
  SubView,
  TokenRow,
  TransactionDetail,
} from "@loyal-labs/wallet-core/types";

import { track } from "~/src/lib/analytics";
import { ActivityRowItem } from "~/src/components/wallet/activity-row-item";
import { TokenRowItem, type TokenRowActions } from "~/src/components/wallet/token-row-item";
import { PORTFOLIO_EVENTS } from "./portfolio-analytics";

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
  onSend,
  onReceive,
  onSwap,
  onShield,
  onSettings,
  tokenRows,
  transactionDetails,
  walletAddress,
  walletLabel,
  getTokenActions,
  onTokenDetail,
  totalTokenCount,
  totalActivityCount,
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
  onSend: () => void;
  onReceive: () => void;
  onSwap: () => void;
  onShield: () => void;
  onSettings: () => void;
  tokenRows: TokenRow[];
  transactionDetails: Record<string, TransactionDetail>;
  walletAddress: string | null;
  walletLabel: string;
  getTokenActions?: (token: TokenRow) => TokenRowActions | undefined;
  onTokenDetail?: (token: TokenRow) => void;
  totalTokenCount?: number;
  totalActivityCount?: number;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopyAddress = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!walletAddress) return;
      track(PORTFOLIO_EVENTS.copyAddress, { source: "portfolio" });
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
        <style>{`
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
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
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
          gap: "12px",
          alignItems: "flex-start",
          padding: "12px 12px 12px 20px",
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
          <img
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
              onClick={() => {
                track(PORTFOLIO_EVENTS.toggleBalanceVisibility, {
                  hidden: !isBalanceHidden,
                });
                onBalanceHiddenChange(!isBalanceHidden);
              }}
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
        <button
          onClick={onSettings}
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
            transition: "background 0.2s ease",
            color: "#3C3C43",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0, 0, 0, 0.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(0, 0, 0, 0.04)";
          }}
          type="button"
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Action buttons — matching app design */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 16px 12px",
        }}
      >
        {(
          [
            { label: "Send", Icon: ArrowUpRight, action: onSend },
            { label: "Receive", Icon: ArrowDownLeft, action: onReceive },
            { label: "Swap", Icon: ArrowLeftRight, action: onSwap },
            { label: "Shield", Icon: Shield, action: onShield },
          ] as const
        ).map(({ label, Icon, action }) => (
          <button
            key={label}
            type="button"
            onClick={action}
            onMouseEnter={(e) => {
              const circle = e.currentTarget.querySelector(
                "[data-action-circle]"
              ) as HTMLElement;
              if (circle) circle.style.background = "rgba(249, 54, 60, 0.22)";
            }}
            onMouseLeave={(e) => {
              const circle = e.currentTarget.querySelector(
                "[data-action-circle]"
              ) as HTMLElement;
              if (circle) circle.style.background = "rgba(249, 54, 60, 0.14)";
            }}
            onMouseDown={(e) => {
              const circle = e.currentTarget.querySelector(
                "[data-action-circle]"
              ) as HTMLElement;
              if (circle) circle.style.transform = "scale(0.93)";
            }}
            onMouseUp={(e) => {
              const circle = e.currentTarget.querySelector(
                "[data-action-circle]"
              ) as HTMLElement;
              if (circle) circle.style.transform = "scale(1)";
            }}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              minWidth: 0,
              overflow: "hidden",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <div
              data-action-circle
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "9999px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(249, 54, 60, 0.14)",
                transition: "background 0.15s ease, transform 0.15s ease",
              }}
            >
              <Icon size={24} strokeWidth={1.5} style={{ color: "#000" }} />
            </div>
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "13px",
                lineHeight: "16px",
                color: "rgba(60, 60, 67, 0.6)",
              }}
            >
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* Scrollable content area */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
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
            {(totalTokenCount ?? tokenRows.length) > 3 && (
              <button
                onClick={() => {
                  track(PORTFOLIO_EVENTS.viewAllTokens);
                  onNavigate("allTokens");
                }}
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
            )}
          </div>

          {tokenRows.map((token) => (
            <TokenRowItem
              actions={getTokenActions?.(token)}
              isBalanceHidden={isBalanceHidden}
              key={token.id ?? token.symbol}
              token={token}
              onDetail={onTokenDetail}
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
            {(totalActivityCount ?? activityRows.length) > 7 && (
              <button
                onClick={() => {
                  track(PORTFOLIO_EVENTS.viewAllActivity);
                  onNavigate("allActivity");
                }}
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
            )}
          </div>

          {activityRows.map((activity) => (
            <ActivityRowItem
              activity={activity}
              isBalanceHidden={isBalanceHidden}
              key={activity.id}
              onClick={() => {
                track(PORTFOLIO_EVENTS.viewTransactionDetails, {
                  tx_type: activity.type,
                });
                onNavigate({
                  type: "transaction",
                  detail: transactionDetails[activity.id],
                  from: "portfolio",
                });
              }}
            />
          ))}

          {!isLoading && activityRows.length === 0 && (
            <div
              style={{
                padding: "12px 20px",
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

      {/* Download CTA */}
      <div style={{ padding: "8px 16px 12px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() =>
            globalThis.open(
              "https://askloyal.com",
              "_blank",
              "noopener,noreferrer"
            )
          }
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "10px 16px",
            background: "#fff",
            border: "none",
            borderRadius: "16px",
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(249, 54, 60, 0.06)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#fff";
          }}
        >
          <svg
            width="28"
            height="22"
            viewBox="0 0 980 784"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ flexShrink: 0 }}
          >
            <path
              d="M147 686L0 343H441V0L637 343L686 0L980 784L147 686Z"
              fill="#F9363C"
            />
            <path
              d="M542.333 423.938C623.407 428.187 686.146 488.592 682.464 558.857L388.867 543.47C392.549 473.205 461.258 419.689 542.333 423.938Z"
              fill="white"
            />
            <path
              d="M542.532 435.643C586.259 437.935 619.849 475.241 617.557 518.967C616.87 532.087 613.028 544.293 606.809 554.892L466.142 547.52C461.065 536.329 458.522 523.788 459.209 510.669C461.501 466.942 498.805 433.352 542.532 435.643Z"
              fill="black"
            />
            <path
              d="M562.108 543.399C562.108 523.779 546.203 507.874 526.583 507.874C546.203 507.874 562.108 491.969 562.108 472.349C562.108 491.969 578.014 507.874 597.633 507.874C578.014 507.874 562.108 523.779 562.108 543.399Z"
              fill="white"
            />
            <circle cx="588.44" cy="477.861" r="9.1875" fill="white" />
          </svg>
          <span
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "14px",
              fontWeight: 500,
              lineHeight: "20px",
              color: "#000",
            }}
          >
            Explore the agentic finance
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(60,60,67,0.4)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginLeft: "auto", flexShrink: 0 }}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    </>
  );
}
