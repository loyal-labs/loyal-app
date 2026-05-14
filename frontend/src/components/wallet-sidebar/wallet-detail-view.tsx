"use client";

import type { SmartAccountSpendingLimitSnapshot } from "@loyal-labs/smart-account-vaults";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { useLoyalPriceUsd } from "@/hooks/use-loyal-price";
import { AccessLevelIcon, type AccessLevel } from "./agent-page-view";
import { ActivityRowItem } from "./activity-row-item";
import { buildLoyalPlaceholderRow } from "./loyal-placeholder";
import { SpendingLimitSection } from "./spending-limit-section";
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

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

const ACCESS_OPTIONS: {
  id: AccessLevel;
  label: string;
  description: string;
}[] = [
  {
    id: "suggest",
    label: "Suggest Transactions",
    description:
      "Can prepare transaction suggestions for your review and approval",
  },
  {
    id: "sign",
    label: "Sign Transactions",
    description:
      "Can sign transactions, but only within the permissions you allow.",
  },
  {
    id: "execute",
    label: "Execute Transactions",
    description:
      "Can sign and send transactions on your behalf without additional approval.",
  },
];

const ACCESS_DISPLAY: Record<AccessLevel, string> = {
  execute: "Can execute",
  sign: "Can sign",
  suggest: "Can suggest",
};

function formatAddressForDisplay(address: string): string {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function WalletDetailView({
  address,
  label,
  icon,
  balanceWhole,
  balanceFraction,
  isBalanceHidden,
  tokenRows,
  activityRows,
  transactionDetails,
  onNavigate,
  onOpenSend,
  onOpenReceive,
  onOpenShield,
  getTokenActions,
  onTokenDetail,
  onActivityTabOpen,
  accessLevel,
  accessTitle = "User Access",
  initialTab = "tokens",
  receiveLabel = "Receive",
  onAccessLevelChange,
  isAccessLevelPending = false,
  spendingLimit,
  isSpendingLimitPending = false,
  onSetSpendingLimit,
  onDeleteSpendingLimit,
}: {
  address: string | null;
  label: string;
  icon: string;
  balanceWhole: string;
  balanceFraction: string;
  isBalanceHidden: boolean;
  tokenRows: TokenRow[];
  activityRows: ActivityRow[];
  transactionDetails: Record<string, TransactionDetail>;
  onNavigate: (view: Exclude<SubView, null>) => void;
  onOpenSend: () => void;
  onOpenReceive: () => void;
  onOpenShield: () => void;
  getTokenActions?: (token: TokenRow) => TokenRowActions | undefined;
  onTokenDetail?: (token: TokenRow) => void;
  onActivityTabOpen?: () => void;
  accessLevel?: AccessLevel;
  accessTitle?: string;
  initialTab?: "activity" | "tokens";
  receiveLabel?: string;
  onAccessLevelChange?: (level: AccessLevel) => Promise<void>;
  isAccessLevelPending?: boolean;
  spendingLimit?: SmartAccountSpendingLimitSnapshot | null;
  isSpendingLimitPending?: boolean;
  onSetSpendingLimit?: (amountUsd: number) => Promise<void>;
  onDeleteSpendingLimit?: (
    spendingLimit: SmartAccountSpendingLimitSnapshot
  ) => Promise<void>;
}) {
  const [activeTab, setActiveTab] =
    useState<"activity" | "tokens">(initialTab);
  const [displayAccessLevel, setDisplayAccessLevel] = useState<AccessLevel>(
    accessLevel ?? "suggest"
  );
  const [isAccessExpanded, setIsAccessExpanded] = useState(false);
  const [isAddressCopied, setIsAddressCopied] = useState(false);

  useEffect(() => {
    if (accessLevel) {
      setDisplayAccessLevel(accessLevel);
    }
  }, [accessLevel]);

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
      className="wallet-detail-view"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <style jsx>{`
        .wallet-detail-view {
          container-type: inline-size;
        }
        .wallet-detail-action:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .wallet-detail-primary:hover {
          background: #222 !important;
        }
        .wallet-detail-address-btn:hover {
          opacity: 0.72 !important;
        }
        .wallet-detail-access-header:hover,
        .wallet-detail-access-row:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        @container (max-width: 560px) {
          .wallet-detail-action-label {
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
          <filter id="stash-pixelate-sm" x="0" y="0" width="100%" height="100%">
            <feFlood x="3" y="3" height="2" width="2" />
            <feComposite width="8" height="8" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="4" />
          </filter>
          <filter
            id="wallet-detail-pixelate"
            x="0"
            y="0"
            width="100%"
            height="100%"
          >
            <feFlood x="4" y="4" height="2" width="2" />
            <feComposite width="10" height="10" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="5" />
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
              className="wallet-detail-address-btn"
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={label}
            src={icon}
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              flexShrink: 0,
              marginRight: "12px",
            }}
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
                  filter: isBalanceHidden
                    ? "url(#wallet-detail-pixelate)"
                    : "none",
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
            className="wallet-detail-action"
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
              className="wallet-detail-action-label"
              style={{ fontFamily: font, fontSize: "15px", lineHeight: "20px" }}
            >
              Send
            </span>
          </button>
          <button
            className="wallet-detail-action"
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
              className="wallet-detail-action-label"
              style={{
                fontFamily: font,
                fontSize: "15px",
                lineHeight: "20px",
              }}
            >
              {receiveLabel}
            </span>
          </button>
          <button
            className="wallet-detail-primary"
            onClick={onOpenShield}
            style={{
              display: "flex",
              gap: "6px",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 0,
              padding: "10px 8px",
              borderRadius: "9999px",
              background: "#000",
              border: "none",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            type="button"
          >
            <Image
              alt=""
              height={22}
              src="/hero-new/Shield_40.svg"
              style={{
                display: "block",
                height: "22px",
                width: "22px",
              }}
              width={22}
            />
            <span
              className="wallet-detail-action-label"
              style={{
                color: "#fff",
                fontFamily: font,
                fontSize: "15px",
                lineHeight: "20px",
              }}
            >
              Shield
            </span>
          </button>
        </div>

        {accessLevel && (
          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              padding: "8px",
              width: "100%",
            }}
          >
            <button
              className="wallet-detail-access-header"
              onClick={() => setIsAccessExpanded((value) => !value)}
              style={{
                alignItems: "center",
                background: "transparent",
                border: "none",
                borderRadius: "16px",
                cursor: "pointer",
                display: "flex",
                padding: "14px 12px",
                transition: "background 0.15s ease",
                width: "100%",
              }}
              type="button"
            >
              <span
                style={{
                  flex: 1,
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 500,
                  lineHeight: "20px",
                  color: "#000",
                  letterSpacing: "-0.176px",
                  textAlign: "left",
                }}
              >
                {accessTitle}
              </span>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: secondary,
                  paddingLeft: "12px",
                }}
              >
                {ACCESS_DISPLAY[displayAccessLevel]}
              </span>
              <ChevronRight
                size={16}
                style={{
                  color: "rgba(60, 60, 67, 0.3)",
                  flexShrink: 0,
                  marginLeft: "6px",
                  transform: isAccessExpanded
                    ? "rotate(-90deg)"
                    : "rotate(90deg)",
                  transition: "transform 0.2s ease",
                }}
              />
            </button>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                maxHeight: isAccessExpanded ? "300px" : "0px",
                overflow: "hidden",
                transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                width: "100%",
              }}
            >
              {ACCESS_OPTIONS.map((option) => {
                const selected = displayAccessLevel === option.id;
                const isPersisted = (accessLevel ?? "suggest") === option.id;
                const showConfirm =
                  selected && !isPersisted && Boolean(onAccessLevelChange);
                const isReadOnly = !onAccessLevelChange;

                return (
                  <div
                    className="wallet-detail-access-row"
                    key={option.id}
                    onClick={() => {
                      if (isReadOnly || isAccessLevelPending) return;
                      setDisplayAccessLevel(option.id);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "6px 12px",
                      borderRadius: "16px",
                      background: "transparent",
                      border: "none",
                      cursor:
                        isReadOnly || isAccessLevelPending
                          ? "default"
                          : "pointer",
                      width: "100%",
                      transition: "background 0.15s ease",
                      textAlign: "left",
                    }}
                    role="button"
                    tabIndex={isReadOnly ? -1 : 0}
                  >
                    <div
                      style={{
                        padding: "10px 0",
                        paddingRight: "12px",
                        flexShrink: 0,
                      }}
                    >
                      <AccessLevelIcon level={option.id} />
                    </div>
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                        padding: "10px 0",
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
                        {option.label}
                      </span>
                      <span
                        style={{
                          fontFamily: font,
                          fontSize: "13px",
                          fontWeight: 400,
                          lineHeight: "16px",
                          color: secondary,
                        }}
                      >
                        {option.description}
                      </span>
                    </div>
                    {showConfirm && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!onAccessLevelChange || isAccessLevelPending) {
                            return;
                          }
                          void onAccessLevelChange(option.id);
                        }}
                        disabled={isAccessLevelPending}
                        style={{
                          marginRight: "12px",
                          padding: "6px 14px",
                          borderRadius: "9999px",
                          border: "none",
                          background: "#000",
                          color: "#fff",
                          fontFamily: font,
                          fontSize: "13px",
                          fontWeight: 500,
                          lineHeight: "16px",
                          cursor: isAccessLevelPending
                            ? "default"
                            : "pointer",
                          opacity: isAccessLevelPending ? 0.5 : 1,
                          transition: "opacity 0.15s ease",
                          flexShrink: 0,
                        }}
                        type="button"
                      >
                        {isAccessLevelPending ? "Confirming…" : "Confirm"}
                      </button>
                    )}
                    <div style={{ paddingLeft: "12px", flexShrink: 0 }}>
                      <div
                        style={{
                          width: "24px",
                          height: "24px",
                          borderRadius: "9999px",
                          border: selected
                            ? "7px solid #F9363C"
                            : "2px solid rgba(60, 60, 67, 0.3)",
                          background: "#fff",
                          boxSizing: "border-box",
                          transition: "border 0.15s ease",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(onSetSpendingLimit || onDeleteSpendingLimit) && (
          <SpendingLimitSection
            isBalanceHidden={isBalanceHidden}
            isPending={isSpendingLimitPending}
            onDelete={async (nextSpendingLimit) => {
              if (!onDeleteSpendingLimit) return;
              await onDeleteSpendingLimit(nextSpendingLimit);
            }}
            onSet={async (amountUsd) => {
              if (!onSetSpendingLimit) return;
              await onSetSpendingLimit(amountUsd);
            }}
            spendingLimit={spendingLimit ?? null}
          />
        )}

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

            {activeTab === "tokens" && tokenRows.length === 0 && (
              <TokenRowItem
                isBalanceHidden={isBalanceHidden}
                onDetail={onTokenDetail}
                token={loyalPlaceholderRow}
              />
            )}

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
