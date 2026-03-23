"use client";

import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Eye, EyeOff, RefreshCw, X } from "lucide-react";
import Image from "next/image";

import { ActivityRowItem } from "./activity-row-item";
import { TokenRowItem } from "./token-row-item";
import type {
  ActivityRow,
  RightSidebarTab,
  SubView,
  TokenRow,
  TransactionDetail,
} from "./types";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

export function AccountPageView({
  accountLabel,
  accountIcon,
  balanceWhole,
  balanceFraction,
  isBalanceHidden,
  onBalanceHiddenChange,
  tokenRows,
  activityRows,
  transactionDetails,
  onBack,
  onClose,
  onNavigate,
  onTabChange,
}: {
  accountLabel: string;
  accountIcon: string;
  balanceWhole: string;
  balanceFraction: string;
  isBalanceHidden: boolean;
  onBalanceHiddenChange: (hidden: boolean) => void;
  tokenRows: TokenRow[];
  activityRows: ActivityRow[];
  transactionDetails: Record<string, TransactionDetail>;
  onBack: () => void;
  onClose: () => void;
  onNavigate: (view: Exclude<SubView, null>) => void;
  onTabChange: (tab: RightSidebarTab) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .acct-back-btn:hover, .acct-close-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .acct-action-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .acct-shield-btn:hover {
          background: #222 !important;
        }
        .acct-link-btn:hover {
          opacity: 0.7;
        }
      `}</style>

      {/* SVG pixelation filters */}
      <svg aria-hidden="true" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} width="0">
        <defs>
          <filter id="acct-pixelate" x="0" y="0" width="100%" height="100%">
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

      {/* Header: back + close */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px" }}>
        <button
          className="acct-back-btn"
          onClick={onBack}
          style={{ width: "36px", height: "36px", display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0, 0, 0, 0.04)", border: "none", borderRadius: "9999px", cursor: "pointer", transition: "all 0.2s ease", color: "#3C3C43" }}
          type="button"
        >
          <ArrowLeft size={24} />
        </button>
        <button
          className="acct-close-btn"
          onClick={onClose}
          style={{ width: "36px", height: "36px", display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0, 0, 0, 0.04)", border: "none", borderRadius: "9999px", cursor: "pointer", transition: "all 0.2s ease", color: "#3C3C43" }}
          type="button"
        >
          <X size={24} />
        </button>
      </div>

      {/* Account info: icon + label + balance */}
      <div style={{ display: "flex", alignItems: "center", padding: "8px 20px" }}>
        <Image
          alt={accountLabel}
          height={64}
          src={accountIcon}
          style={{ borderRadius: "16px", flexShrink: 0, marginRight: "12px" }}
          width={64}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", padding: "9px 0" }}>
          <span style={{ fontFamily: font, fontSize: "15px", fontWeight: 400, lineHeight: "20px", color: secondary }}>
            {accountLabel}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ borderRadius: "8px", overflow: "hidden" }}>
              <span
                style={{
                  fontFamily: font, fontSize: "32px", fontWeight: 600, lineHeight: "40px", letterSpacing: "-0.352px",
                  color: isBalanceHidden ? "#BBBBC0" : "#000",
                  filter: isBalanceHidden ? "url(#acct-pixelate)" : "none",
                  transition: "filter 0.15s ease, color 0.15s ease",
                  userSelect: isBalanceHidden ? "none" : "auto",
                  display: "block",
                }}
              >
                {balanceWhole}
                <span style={{ color: isBalanceHidden ? "#BBBBC0" : "rgba(60, 60, 67, 0.4)", transition: "color 0.15s ease" }}>
                  {balanceFraction}
                </span>
              </span>
            </div>
            <button
              onClick={() => onBalanceHiddenChange(!isBalanceHidden)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", flexShrink: 0 }}
              type="button"
            >
              {isBalanceHidden ? (
                <EyeOff size={22} strokeWidth={1.5} style={{ color: "rgba(60, 60, 67, 0.5)" }} />
              ) : (
                <Eye size={22} strokeWidth={1.5} style={{ color: "rgba(60, 60, 67, 0.5)" }} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "16px", alignItems: "center", padding: "8px 20px" }}>
        <button
          className="acct-action-btn"
          onClick={() => onTabChange("receive")}
          style={{ width: "44px", height: "44px", borderRadius: "9999px", background: "rgba(249, 54, 60, 0.14)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background 0.15s ease", flexShrink: 0 }}
          type="button"
        >
          <ArrowDownLeft size={24} style={{ color: "rgba(60, 60, 67, 0.6)" }} />
        </button>
        <button
          className="acct-action-btn"
          onClick={() => onTabChange("send")}
          style={{ width: "44px", height: "44px", borderRadius: "9999px", background: "rgba(249, 54, 60, 0.14)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background 0.15s ease", flexShrink: 0 }}
          type="button"
        >
          <ArrowUpRight size={24} style={{ color: "rgba(60, 60, 67, 0.6)" }} />
        </button>
        <button
          className="acct-action-btn"
          onClick={() => onTabChange("swap")}
          style={{ width: "44px", height: "44px", borderRadius: "9999px", background: "rgba(249, 54, 60, 0.14)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background 0.15s ease", flexShrink: 0 }}
          type="button"
        >
          <RefreshCw size={24} style={{ color: "rgba(60, 60, 67, 0.6)" }} />
        </button>
        <button
          className="acct-shield-btn"
          onClick={() => onTabChange("swap")}
          style={{ flex: 1, display: "flex", gap: "6px", alignItems: "center", justifyContent: "center", padding: "10px 16px 10px 8px", borderRadius: "9999px", background: "#000", border: "none", cursor: "pointer", transition: "background 0.15s ease" }}
          type="button"
        >
          <Image alt="Shield" height={20} src="/Shield.svg" width={20} />
          <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#fff" }}>Shield</span>
        </button>
      </div>

      {/* Scrollable content: Tokens + Activity */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {/* Tokens section */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px", width: "100%" }}>
          <div style={{ width: "100%", padding: "12px 12px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 500, lineHeight: "20px", color: "#000", letterSpacing: "-0.176px" }}>
              Tokens
            </span>
            <button
              className="acct-link-btn"
              onClick={() => onNavigate("allTokens")}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#F9363C", transition: "opacity 0.15s ease" }}
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px", width: "100%" }}>
          <div style={{ width: "100%", padding: "12px 12px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 500, lineHeight: "20px", color: "#000", letterSpacing: "-0.176px" }}>
              Activity
            </span>
            <button
              className="acct-link-btn"
              onClick={() => onNavigate("allActivity")}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#F9363C", transition: "opacity 0.15s ease" }}
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
          {activityRows.length === 0 && (
            <div style={{ padding: "12px 20px", textAlign: "center", fontFamily: font, fontSize: "14px", color: secondary }}>
              No activity yet
            </div>
          )}
        </div>
      </div>

      <p style={{ fontFamily: font, fontSize: "11px", fontWeight: 400, lineHeight: "16px", color: "rgba(60, 60, 67, 0.3)", textAlign: "center", padding: "8px 0 12px", flexShrink: 0 }}>
        Token logos by Logo.dev
      </p>
    </div>
  );
}
