"use client";

import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Plus,
  Vault,
  X,
} from "lucide-react";
import Image from "next/image";

import { AccessLevelIcon } from "./agent-page-view";
import type { AccessLevel } from "./agent-page-view";
import { ActivityRowItem } from "./activity-row-item";
import { TokenRowItem } from "./token-row-item";
import type {
  ActivityRow,
  SubView,
  TokenRow,
  TransactionDetail,
} from "./types";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

// Mock sub-accounts inside the vault
const MOCK_VAULT_ENTRIES = [
  {
    id: "vault",
    label: "Wallet stash",
    balanceWhole: "$6,750",
    balanceFraction: ".00",
    icon: "lock" as const,
  },
  {
    id: "agent-1",
    label: "Agent 1",
    balanceWhole: "$250",
    balanceFraction: ".00",
    icon: "initials" as const,
    initials: "A1",
    accessLabel: "Can sign",
    accessLevel: "sign" as AccessLevel,
  },
  {
    id: "agent-2",
    label: "Agent 47",
    balanceWhole: "$0",
    balanceFraction: ".00",
    icon: "initials" as const,
    initials: "A2",
    accessLabel: "Can execute",
    accessLevel: "execute" as AccessLevel,
  },
];

export function VaultAccountPageView({
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
}: {
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
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .vault-back-btn:hover,
        .vault-close-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
.vault-link-btn:hover {
          opacity: 0.7;
        }
        .vault-entry-row:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
      `}</style>

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
          <filter id="vault-pixelate" x="0" y="0" width="100%" height="100%">
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px",
        }}
      >
        <button
          className="vault-back-btn"
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
          }}
          type="button"
        >
          <ArrowRight size={24} />
        </button>
        <button
          className="vault-close-btn"
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
          }}
          type="button"
        >
          <X size={24} />
        </button>
      </div>

      {/* Account info: icon + label + balance */}
      <div
        style={{ display: "flex", alignItems: "center", padding: "8px 20px" }}
      >
        <Image
          alt="Stash"
          height={64}
          src="/redbg.png"
          style={{ borderRadius: "16px", flexShrink: 0, marginRight: "12px" }}
          width={64}
        />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            padding: "9px 0",
          }}
        >
          <span
            style={{
              fontFamily: font,
              fontSize: "15px",
              fontWeight: 400,
              lineHeight: "20px",
              color: secondary,
            }}
          >
            Stash
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ borderRadius: "8px", overflow: "hidden" }}>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "32px",
                  fontWeight: 600,
                  lineHeight: "40px",
                  letterSpacing: "-0.352px",
                  color: isBalanceHidden ? "#BBBBC0" : "#000",
                  filter: isBalanceHidden ? "url(#vault-pixelate)" : "none",
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
                      : "rgba(60, 60, 67, 0.4)",
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
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {/* "In this vault" section */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "8px",
            width: "100%",
          }}
        >
          {/* Sub-account rows */}
          {MOCK_VAULT_ENTRIES.map((entry) => (
            <button
              className="vault-entry-row"
              key={entry.id}
              onClick={() => {
                if (entry.icon === "initials") {
                  onNavigate({
                    type: "agentPage",
                    agentId: entry.id,
                    label: entry.label,
                    initials: entry.initials ?? "",
                    balanceWhole: entry.balanceWhole,
                    balanceFraction: entry.balanceFraction,
                  });
                } else if (entry.icon === "lock") {
                  onNavigate({
                    type: "stashPage",
                    label: entry.label,
                    balanceWhole: entry.balanceWhole,
                    balanceFraction: entry.balanceFraction,
                  });
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "6px 12px",
                borderRadius: "16px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                width: "100%",
                transition: "background 0.15s ease",
                textAlign: "left",
              }}
              type="button"
            >
              {/* Icon */}
              {entry.icon === "lock" ? (
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "12px",
                    background: "#F5F5F5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginRight: "12px",
                  }}
                >
                  <Vault size={24} style={{ color: "rgba(60, 60, 67, 0.4)" }} />
                </div>
              ) : (
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "12px",
                    background: "#F5F5F5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginRight: "12px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: font,
                      fontSize: "15px",
                      fontWeight: 600,
                      lineHeight: "15px",
                      color: secondary,
                    }}
                  >
                    {entry.initials}
                  </span>
                </div>
              )}
              {/* Text */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  padding: "9px 0",
                }}
              >
                <div style={{ borderRadius: "6px", overflow: "hidden" }}>
                  <span
                    style={{
                      fontFamily: font,
                      fontSize: "20px",
                      fontWeight: 600,
                      lineHeight: "24px",
                      color: isBalanceHidden ? "#BBBBC0" : "#000",
                      letterSpacing: "-0.22px",
                      filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                      transition: "filter 0.15s ease, color 0.15s ease",
                      userSelect: isBalanceHidden ? "none" : "auto",
                      display: "block",
                    }}
                  >
                    {entry.balanceWhole}
                    <span
                      style={{
                        color: isBalanceHidden
                          ? "#BBBBC0"
                          : "rgba(60, 60, 67, 0.4)",
                      }}
                    >
                      {entry.balanceFraction}
                    </span>
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      fontFamily: font,
                      fontSize: "13px",
                      fontWeight: 400,
                      lineHeight: "16px",
                      color: secondary,
                    }}
                  >
                    {entry.label}
                  </span>
                  {"accessLabel" in entry && entry.accessLabel && (
                    <span
                      style={{
                        fontFamily: font,
                        fontSize: "11px",
                        fontWeight: 500,
                        lineHeight: "14px",
                        color: "#000",
                        background: "rgba(249, 54, 60, 0.14)",
                        borderRadius: "9999px",
                        padding: "2px 10px 2px 4px",
                        whiteSpace: "nowrap",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "2px",
                      }}
                    >
                      {"accessLevel" in entry && entry.accessLevel && (
                        <AccessLevelIcon level={entry.accessLevel} size={14} />
                      )}
                      {entry.accessLabel}
                    </span>
                  )}
                </div>
              </div>
              {/* Chevron */}
              <ChevronLeft
                size={24}
                style={{
                  color: "rgba(60, 60, 67, 0.3)",
                  flexShrink: 0,
                  marginLeft: "12px",
                }}
              />
            </button>
          ))}

          {/* Add Agent row */}
          <button
            className="vault-entry-row"
            style={{
              display: "flex",
              alignItems: "center",
              padding: "6px 12px",
              borderRadius: "16px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              width: "100%",
              transition: "background 0.15s ease",
              textAlign: "left",
            }}
            type="button"
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                background: "rgba(249, 54, 60, 0.14)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginRight: "12px",
              }}
            >
              <Plus size={24} style={{ color: "#000" }} />
            </div>
            <div style={{ flex: 1, padding: "9px 0" }}>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 500,
                  lineHeight: "20px",
                  color: "#000",
                  letterSpacing: "-0.176px",
                }}
              >
                Add
              </span>
            </div>
          </button>
        </div>

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
                fontFamily: font,
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
              className="vault-link-btn"
              onClick={() => onNavigate("allTokens")}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#F9363C",
                transition: "opacity 0.15s ease",
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
                fontFamily: font,
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
              className="vault-link-btn"
              onClick={() => onNavigate("allActivity")}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#F9363C",
                transition: "opacity 0.15s ease",
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
          {activityRows.length === 0 && (
            <div
              style={{
                padding: "12px 20px",
                textAlign: "center",
                fontFamily: font,
                fontSize: "14px",
                color: secondary,
              }}
            >
              No activity yet
            </div>
          )}
        </div>
      </div>

      <p
        style={{
          fontFamily: font,
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
    </div>
  );
}
