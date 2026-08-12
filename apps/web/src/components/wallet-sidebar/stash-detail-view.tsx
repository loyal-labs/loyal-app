"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Copy,
  RefreshCw,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { useLoyalPriceUsd } from "@/hooks/use-loyal-price";
import { ActivityRowItem } from "./activity-row-item";
import { buildLoyalPlaceholderRow } from "./loyal-placeholder";
import {
  getTokenPairConnection,
  TokenRowItem,
  type TokenRowActions,
} from "./token-row-item";
import type {
  ActivityRow,
  SubView,
  TokenRow,
  TransactionDetail,
} from "./types";
import { getVaultIcon } from "./vault-icon";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

function formatAddressForDisplay(address: string): string {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function StashDetailView({
  accountIndex,
  address,
  label,
  balanceWhole,
  balanceFraction,
  isBalanceHidden,
  tokenRows,
  activityRows,
  transactionDetails,
  onNavigate,
  onOpenSend,
  onOpenReceive,
  onOpenSwap,
  getTokenActions,
  onTokenDetail,
  onActivityTabOpen,
  initialTab = "tokens",
}: {
  accountIndex: number;
  address: string | null;
  label: string;
  balanceWhole: string;
  balanceFraction: string;
  isBalanceHidden: boolean;
  tokenRows: TokenRow[];
  activityRows: ActivityRow[];
  transactionDetails: Record<string, TransactionDetail>;
  onNavigate: (view: Exclude<SubView, null>) => void;
  onOpenSend: () => void;
  onOpenReceive: () => void;
  onOpenSwap: () => void;
  getTokenActions?: (token: TokenRow) => TokenRowActions | undefined;
  onTokenDetail?: (token: TokenRow) => void;
  onActivityTabOpen?: () => void;
  initialTab?: "activity" | "tokens";
}) {
  const [activeTab, setActiveTab] =
    useState<"activity" | "tokens">(initialTab);
  const [isAddressCopied, setIsAddressCopied] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const loyalPriceUsd = useLoyalPriceUsd();
  const loyalPlaceholderRow = useMemo(
    () => buildLoyalPlaceholderRow(loyalPriceUsd),
    [loyalPriceUsd]
  );

  const copyAddress = async () => {
    if (!address) return;

    try {
      await navigator.clipboard.writeText(address);
      setIsAddressCopied(true);
      window.setTimeout(() => setIsAddressCopied(false), 1400);
    } catch {
      window.alert("Failed to copy address.");
    }
  };

  return (
    <div
      className="stash-detail-view"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <style jsx>{`
        .stash-detail-view {
          container-type: inline-size;
        }
        .stash-action-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .stash-address-btn:hover {
          opacity: 0.72 !important;
        }
        @container (max-width: 440px) {
          .stash-action-label {
            display: none;
          }
        }
      `}</style>

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
          <filter id="stash-pixelate" x="0" y="0" width="100%" height="100%">
            <feFlood x="4" y="4" height="2" width="2" />
            <feComposite width="10" height="10" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="5" />
          </filter>
          <filter id="stash-pixelate-sm" x="0" y="0" width="100%" height="100%">
            <feFlood x="3" y="3" height="2" width="2" />
            <feComposite width="8" height="8" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="4" />
          </filter>
        </defs>
      </svg>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            padding: "0 12px",
          }}
        >
          <span
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 600,
              lineHeight: "20px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
          {address && (
            <button
              aria-label={`Copy address ${address}`}
              className="stash-address-btn"
              onClick={copyAddress}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                maxWidth: "100%",
                padding: 0,
                background: "transparent",
                border: "none",
                color: secondary,
                cursor: "pointer",
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 400,
                lineHeight: "16px",
                transition: "opacity 0.15s ease",
              }}
              title={address}
              type="button"
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {formatAddressForDisplay(address)}
              </span>
              {isAddressCopied ? (
                <Check size={12} strokeWidth={1.8} />
              ) : (
                <Copy size={12} strokeWidth={1.8} />
              )}
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", padding: "8px 20px" }}
        >
          <Image
            alt={label}
            height={64}
            src={getVaultIcon(accountIndex)}
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              flexShrink: 0,
              marginRight: "12px",
            }}
            width={64}
          />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              minWidth: 0,
              padding: "9px 0",
            }}
          >
            <div style={{ borderRadius: "8px", overflow: "hidden" }}>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "40px",
                  fontWeight: 600,
                  lineHeight: "48px",
                  letterSpacing: "-0.44px",
                  color: isBalanceHidden ? "#BBBBC0" : "#000",
                  filter: isBalanceHidden ? "url(#stash-pixelate)" : "none",
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
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "10px",
            padding: "8px 20px",
          }}
        >
          <button
            className="stash-action-btn"
            onClick={onOpenSend}
            style={{
              display: "flex",
              gap: "6px",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 0,
              padding: "10px 8px",
              borderRadius: "9999px",
              background: "rgba(249, 54, 60, 0.14)",
              border: "none",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            type="button"
          >
            <ArrowUpRight size={22} style={{ color: "rgba(0, 0, 0, 0.6)" }} />
            <span
              className="stash-action-label"
              style={{
                fontFamily: font,
                fontSize: "15px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#000",
              }}
            >
              Send
            </span>
          </button>
          <button
            className="stash-action-btn"
            onClick={onOpenReceive}
            style={{
              display: "flex",
              gap: "6px",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 0,
              padding: "10px 8px",
              borderRadius: "9999px",
              background: "rgba(249, 54, 60, 0.14)",
              border: "none",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            type="button"
          >
            <ArrowDownLeft size={22} style={{ color: "rgba(0, 0, 0, 0.6)" }} />
            <span
              className="stash-action-label"
              style={{
                fontFamily: font,
                fontSize: "15px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#000",
              }}
            >
              Receive
            </span>
          </button>
          <button
            className="stash-action-btn"
            onClick={onOpenSwap}
            style={{
              display: "flex",
              gap: "6px",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 0,
              padding: "10px 8px",
              borderRadius: "9999px",
              background: "rgba(249, 54, 60, 0.14)",
              border: "none",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            type="button"
          >
            <RefreshCw size={22} style={{ color: "rgba(0, 0, 0, 0.6)" }} />
            <span
              className="stash-action-label"
              style={{
                fontFamily: font,
                fontSize: "15px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#000",
              }}
            >
              Swap
            </span>
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flex: 1,
            minHeight: 0,
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
              justifyContent: "flex-start",
              gap: "24px",
            }}
          >
            {(["tokens", "activity"] as const).map((tab) => {
              const isSelected = activeTab === tab;

              return (
                <button
                  key={tab}
                  onClick={() => {
                    if (tab === "activity") {
                      onActivityTabOpen?.();
                    }
                    setActiveTab(tab);
                  }}
                  style={{
                    position: "relative",
                    background: "transparent",
                    border: "none",
                    padding: "12px 0 8px",
                    cursor: "pointer",
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 500,
                    lineHeight: "20px",
                    color: isSelected ? "#000" : "rgba(0, 0, 0, 0.4)",
                    letterSpacing: "-0.176px",
                  }}
                  type="button"
                >
                  {tab === "tokens" ? "Tokens" : "Activity"}
                  {isSelected && (
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: "5px",
                        height: "1px",
                        background: "#000",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowX: "hidden",
              overflowY: "auto",
              width: "100%",
            }}
          >
            {activeTab === "tokens" &&
              tokenRows.map((token, index) => (
                <TokenRowItem
                  actions={getTokenActions?.(token)}
                  isBalanceHidden={isBalanceHidden}
                  key={token.id ?? token.symbol}
                  onDetail={onTokenDetail}
                  pairConnection={getTokenPairConnection(tokenRows, index)}
                  token={token}
                />
              ))}

            {activeTab === "tokens" && tokenRows.length === 0 && (
              <TokenRowItem
                isBalanceHidden={isBalanceHidden}
                onDetail={onTokenDetail}
                token={loyalPlaceholderRow}
              />
            )}

            {activeTab === "activity" &&
              activityRows.map((activity) => (
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

            {activeTab === "activity" && activityRows.length === 0 && (
              <div
                style={{
                  padding: "12px",
                  textAlign: "left",
                  fontFamily: font,
                  fontSize: "14px",
                  color: secondary,
                  width: "100%",
                }}
              >
                No activity yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
