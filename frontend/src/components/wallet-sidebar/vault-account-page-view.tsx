"use client";

import {
  ArrowRight,
  ChevronLeft,
  Copy,
  Eye,
  EyeOff,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useMemo, useState } from "react";

import type { SmartAccountVaultEntry } from "@/hooks/use-smart-account-sidebar-data";
import { ActivityRowItem } from "./activity-row-item";
import { TokenRowItem, type TokenRowActions } from "./token-row-item";
import { getVaultIcon } from "./vault-icon";
import type {
  ActivityRow,
  SubView,
  TokenRow,
  TransactionDetail,
} from "./types";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function AddressRow({
  label,
  value,
  copiedKey,
  onCopy,
}: {
  label: string;
  value: string;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        gap: "10px",
        padding: "9px 12px",
      }}
    >
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          gap: "2px",
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: secondary,
            display: "block",
            fontFamily: font,
            fontSize: "13px",
            fontWeight: 400,
            lineHeight: "16px",
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: "#000",
            display: "block",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: "12px",
            fontWeight: 400,
            lineHeight: "16px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={value}
        >
          {value}
        </span>
      </div>
      <button
        className="vault-copy-btn"
        onClick={() => onCopy(label, value)}
        style={{
          alignItems: "center",
          background: "rgba(0, 0, 0, 0.04)",
          border: "none",
          borderRadius: "9999px",
          color: "#3C3C43",
          cursor: "pointer",
          display: "flex",
          flexShrink: 0,
          fontFamily: font,
          fontSize: "12px",
          gap: "4px",
          height: "32px",
          justifyContent: "center",
          lineHeight: "16px",
          padding: "0 10px",
          transition: "background 0.15s ease",
        }}
        type="button"
      >
        <Copy size={14} />
        {copiedKey === label ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function VaultAccountPageView({
  currentVaultAccountIndex,
  currentVaultAddress,
  vaultLabel,
  balanceWhole,
  balanceFraction,
  isBalanceHidden,
  onBalanceHiddenChange,
  tokenRows,
  activityRows,
  transactionDetails,
  vaultEntries,
  settingsPda,
  programId,
  userAddress,
  onSelectVault,
  onBack,
  onClose,
  onNavigate,
  getTokenActions,
}: {
  currentVaultAccountIndex: number;
  currentVaultAddress: string | null;
  vaultLabel: string;
  balanceWhole: string;
  balanceFraction: string;
  isBalanceHidden: boolean;
  onBalanceHiddenChange: (hidden: boolean) => void;
  tokenRows: TokenRow[];
  activityRows: ActivityRow[];
  transactionDetails: Record<string, TransactionDetail>;
  vaultEntries: SmartAccountVaultEntry[];
  settingsPda?: string | null;
  programId?: string | null;
  userAddress?: string | null;
  onSelectVault: (accountIndex: number) => void;
  onBack: () => void;
  onClose: () => void;
  onNavigate: (view: Exclude<SubView, null>) => void;
  getTokenActions?: (token: TokenRow) => TokenRowActions | undefined;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const addressRows = useMemo(
    () =>
      [
        currentVaultAddress
          ? { label: "Stash address", value: currentVaultAddress }
          : null,
        settingsPda ? { label: "Settings PDA", value: settingsPda } : null,
        userAddress ? { label: "User wallet", value: userAddress } : null,
        programId ? { label: "Program ID", value: programId } : null,
      ].filter(
        (row): row is { label: string; value: string } => row !== null
      ),
    [currentVaultAddress, programId, settingsPda, userAddress]
  );
  const copyAddress = useCallback((key: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .vault-back-btn:hover,
        .vault-close-btn:hover,
        .vault-copy-btn:hover {
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
          alt={vaultLabel}
          height={64}
          src={getVaultIcon(currentVaultAccountIndex)}
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
            Total balance
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
        {addressRows.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "8px",
              width: "100%",
            }}
          >
            <div
              style={{
                padding: "12px 12px 8px",
                width: "100%",
              }}
            >
              <span
                style={{
                  color: "#000",
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 500,
                  letterSpacing: "-0.176px",
                  lineHeight: "20px",
                }}
              >
                Addresses
              </span>
            </div>
            <div
              style={{
                background: "rgba(0, 0, 0, 0.04)",
                borderRadius: "16px",
                display: "flex",
                flexDirection: "column",
                padding: "4px 0",
                width: "100%",
              }}
            >
              {addressRows.map((row) => (
                <AddressRow
                  copiedKey={copiedKey}
                  key={row.label}
                  label={row.label}
                  onCopy={copyAddress}
                  value={row.value}
                />
              ))}
            </div>
          </div>
        )}

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
          {vaultEntries.length === 0 ? (
            <div
              style={{
                padding: "20px",
                fontFamily: font,
                fontSize: "14px",
                color: secondary,
              }}
            >
              No vaults found.
            </div>
          ) : (
            vaultEntries.map((entry) => (
              <div
                className="vault-entry-row"
                key={entry.address}
                style={{
                  alignItems: "center",
                  background: "transparent",
                  borderRadius: "16px",
                  display: "flex",
                  padding: "6px 12px",
                  transition: "background 0.15s ease",
                  width: "100%",
                }}
              >
                <button
                  className="vault-entry-select-btn"
                  onClick={() => onSelectVault(entry.accountIndex)}
                  style={{
                    alignItems: "center",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    flex: 1,
                    minWidth: 0,
                    padding: 0,
                    textAlign: "left",
                  }}
                  type="button"
                >
                  <div
                    style={{
                      alignItems: "center",
                      background: "#F5F5F5",
                      borderRadius: "12px",
                      display: "flex",
                      flexShrink: 0,
                      height: "48px",
                      justifyContent: "center",
                      marginRight: "12px",
                      width: "48px",
                    }}
                  >
                    <span
                      style={{
                        color: secondary,
                        fontFamily: font,
                        fontSize: "15px",
                        fontWeight: 600,
                        lineHeight: "15px",
                      }}
                    >
                      V{entry.accountIndex}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flex: 1,
                      flexDirection: "column",
                      gap: "2px",
                      padding: "9px 0",
                    }}
                  >
                    <span
                      style={{
                        color: "#000",
                        fontFamily: font,
                        fontSize: "16px",
                        fontWeight: 500,
                        letterSpacing: "-0.176px",
                        lineHeight: "20px",
                      }}
                    >
                      {entry.label}
                    </span>
                    <span
                      style={{
                        color: secondary,
                        fontFamily: font,
                        fontSize: "13px",
                        fontWeight: 400,
                        lineHeight: "16px",
                      }}
                    >
                      {shortAddress(entry.address)}
                    </span>
                  </div>
                  <div
                    style={{
                      alignItems: "flex-end",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                      padding: "9px 0",
                    }}
                  >
                    <span
                      style={{
                        color: isBalanceHidden ? "#BBBBC0" : "#000",
                        filter: isBalanceHidden
                          ? "url(#rs-pixelate-sm)"
                          : "none",
                        fontFamily: font,
                        fontSize: "16px",
                        fontWeight: 400,
                        lineHeight: "20px",
                        transition: "filter 0.15s ease, color 0.15s ease",
                        userSelect: isBalanceHidden ? "none" : "auto",
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
                </button>
                <button
                  className="vault-copy-btn"
                  onClick={() => {
                    copyAddress(`Stash ${entry.accountIndex}`, entry.address);
                  }}
                  style={{
                    alignItems: "center",
                    background: "rgba(0, 0, 0, 0.04)",
                    border: "none",
                    borderRadius: "9999px",
                    color: "#3C3C43",
                    cursor: "pointer",
                    display: "flex",
                    flexShrink: 0,
                    height: "32px",
                    justifyContent: "center",
                    marginLeft: "10px",
                    width: "32px",
                  }}
                  title={`Copy ${entry.label} address`}
                  type="button"
                >
                  <Copy size={14} />
                </button>
                <button
                  aria-label={`Open ${entry.label}`}
                  onClick={() => onSelectVault(entry.accountIndex)}
                  style={{
                    alignItems: "center",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    flexShrink: 0,
                    justifyContent: "center",
                    marginLeft: "12px",
                    padding: 0,
                  }}
                  type="button"
                >
                  <ChevronLeft
                    size={24}
                    style={{
                      color: "rgba(60, 60, 67, 0.3)",
                    }}
                  />
                </button>
              </div>
            ))
          )}
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
              actions={getTokenActions?.(token)}
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
