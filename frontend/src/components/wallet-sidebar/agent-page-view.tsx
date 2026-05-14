"use client";

import type { SmartAccountSpendingLimitSnapshot } from "@loyal-labs/smart-account-vaults";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useLoyalPriceUsd } from "@/hooks/use-loyal-price";
import { ActivityRowItem } from "./activity-row-item";
import { buildLoyalPlaceholderRow } from "./loyal-placeholder";
import { TokenRowItem, type TokenRowActions } from "./token-row-item";
import type {
  ActivityRow,
  SubView,
  TokenRow,
  TransactionDetail,
} from "./types";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "$0.00";
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function splitCurrency(value: string): { fraction: string; whole: string } {
  const [whole, fraction] = value.split(".");

  return {
    whole: whole ?? "$0",
    fraction: fraction ? `.${fraction}` : ".00",
  };
}

function formatAddressForDisplay(address: string): string {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatLimitAmount(spendingLimit: SmartAccountSpendingLimitSnapshot) {
  if (
    typeof spendingLimit.amountUsd === "number" &&
    typeof spendingLimit.remainingAmountUsd === "number"
  ) {
    return {
      total: formatUsd(spendingLimit.amountUsd),
      remaining: formatUsd(spendingLimit.remainingAmountUsd),
    };
  }

  return {
    total: `${spendingLimit.amountUi} ${spendingLimit.symbol}`,
    remaining: `${spendingLimit.remainingAmountUi} ${spendingLimit.symbol}`,
  };
}

function getLimitResetLabel(
  spendingLimit: SmartAccountSpendingLimitSnapshot
): string {
  if (spendingLimit.isExpired) {
    return "expired";
  }

  if (spendingLimit.period === "one_time") {
    return "one-time limit";
  }

  if (!spendingLimit.nextReset) {
    return `resets next ${spendingLimit.periodLabel}`;
  }

  return `resets ${new Date(spendingLimit.nextReset * 1000).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric" }
  )}`;
}

function getLimitProgress(spendingLimit: SmartAccountSpendingLimitSnapshot) {
  const total = Number(spendingLimit.amountRaw);
  const remaining = Number(spendingLimit.effectiveRemainingAmountRaw);

  if (!(total > 0) || !Number.isFinite(total) || !Number.isFinite(remaining)) {
    return 0;
  }

  return Math.min(100, Math.max(0, (remaining / total) * 100));
}

export type AccessLevel = "suggest" | "sign" | "execute";

export const ACCESS_OPTIONS: {
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

export const ACCESS_DISPLAY: Record<AccessLevel, string> = {
  suggest: "Can suggest",
  sign: "Can sign",
  execute: "Can execute",
};

export function AccessLevelIcon({
  level,
  size = 28,
  color: colorProp,
}: {
  level: AccessLevel;
  size?: number;
  color?: string;
}) {
  const color = colorProp ?? "rgba(60, 60, 67, 0.6)";
  const scale = size / 28;
  const c = size / 2;

  if (level === "execute") {
    return (
      <svg
        fill="none"
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        width={size}
      >
        <circle
          cx={c}
          cy={c}
          r={11.67 * scale}
          stroke={color}
          strokeWidth={1.5 * scale}
        />
        <circle cx={c} cy={c} fill={color} r={2.33 * scale} />
      </svg>
    );
  }

  const radius = 10.5 * scale;
  const dots = [0, 45, 90, 135, 180, 225, 270, 315].map((angle) => ({
    cx: c + radius * Math.cos(((angle - 90) * Math.PI) / 180),
    cy: c + radius * Math.sin(((angle - 90) * Math.PI) / 180),
  }));

  return (
    <svg fill="none" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
      {dots.map((d, i) => (
        <circle cx={d.cx} cy={d.cy} fill={color} key={i} r={1.2 * scale} />
      ))}
      {level === "sign" && (
        <circle cx={c} cy={c} fill={color} r={2.33 * scale} />
      )}
    </svg>
  );
}

export function AgentPageView({
  label,
  agentIcon,
  balanceWhole,
  balanceFraction,
  isBalanceHidden,
  onBalanceHiddenChange,
  tokenRows,
  activityRows,
  transactionDetails,
  vaultAccountIndex,
  signerAddress,
  spendingLimit,
  isSpendingLimitPending = false,
  canDeleteSigner = true,
  isSignerDeletePending = false,
  onBack,
  onNavigate,
  onDeleteSigner,
  onSetSpendingLimit,
  onDeleteSpendingLimit,
  onTopUpWithSpendingLimit,
  onTopUp,
  getTokenActions,
  onTokenDetail,
  onActivityTabOpen,
  initialAccessLevel = "suggest",
  initialTab = "tokens",
  variant = "sidebar",
  showSpendingLimit = false,
  showTopUpAction = true,
  onAccessLevelChange,
  isAccessLevelPending = false,
}: {
  label: string;
  agentIcon: string;
  balanceWhole: string;
  balanceFraction: string;
  isBalanceHidden: boolean;
  onBalanceHiddenChange: (hidden: boolean) => void;
  tokenRows: TokenRow[];
  activityRows: ActivityRow[];
  transactionDetails: Record<string, TransactionDetail>;
  vaultAccountIndex: number;
  signerAddress: string;
  spendingLimit: SmartAccountSpendingLimitSnapshot | null;
  isSpendingLimitPending?: boolean;
  canDeleteSigner?: boolean;
  isSignerDeletePending?: boolean;
  onBack: () => void;
  onNavigate: (view: Exclude<SubView, null>) => void;
  onDeleteSigner: (args: {
    accountIndex: number;
    signerAddress: string;
  }) => Promise<void>;
  onSetSpendingLimit: (args: {
    accountIndex: number;
    amountUsd: number;
    existingSpendingLimitAddress?: string | null;
    signerAddress: string;
  }) => Promise<void>;
  onDeleteSpendingLimit: (args: {
    accountIndex: number;
    spendingLimitAddress: string;
    signerAddress: string;
  }) => Promise<void>;
  onTopUpWithSpendingLimit: (args: {
    accountIndex: number;
    amountUsd: number;
    signerAddress: string;
    spendingLimitAddress: string;
  }) => Promise<void>;
  onTopUp?: () => void;
  getTokenActions?: (token: TokenRow) => TokenRowActions | undefined;
  onTokenDetail?: (token: TokenRow) => void;
  onActivityTabOpen?: () => void;
  initialAccessLevel?: AccessLevel;
  initialTab?: "activity" | "tokens";
  variant?: "sidebar" | "workspace";
  showSpendingLimit?: boolean;
  showTopUpAction?: boolean;
  /**
   * Persist a new access level for this signer. Triggers a multisig
   * settings change (1 sign at threshold-1, more for higher thresholds).
   * When omitted, the radio is read-only.
   */
  onAccessLevelChange?: (level: AccessLevel) => Promise<void>;
  isAccessLevelPending?: boolean;
}) {
  const isWorkspace = variant === "workspace";
  // `accessLevel` here is the *draft* level the user has picked in the
  // radio. It only diverges from `initialAccessLevel` while the user is
  // mid-edit. Successful save → parent re-renders with new
  // `initialAccessLevel` → effect below resyncs the draft.
  const [accessLevel, setAccessLevel] =
    useState<AccessLevel>(initialAccessLevel);
  const [isAccessExpanded, setIsAccessExpanded] = useState(false);
  const [isLimitExpanded, setIsLimitExpanded] = useState(isWorkspace);
  const [isAddressCopied, setIsAddressCopied] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [limitDraftAmount, setLimitDraftAmount] = useState("");
  const [limitDraftError, setLimitDraftError] = useState<string | null>(null);
  const [isLimitEditing, setIsLimitEditing] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"activity" | "tokens">(
    initialTab
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasLimit = spendingLimit !== null;
  const limitAmounts = spendingLimit ? formatLimitAmount(spendingLimit) : null;
  const isLimitCurrency = limitAmounts?.remaining.startsWith("$") ?? true;
  const remainingParts = limitAmounts
    ? splitCurrency(limitAmounts.remaining)
    : { whole: "$0", fraction: ".00" };
  const totalParts = limitAmounts
    ? splitCurrency(limitAmounts.total)
    : { whole: "$0", fraction: ".00" };
  const limitProgress = spendingLimit ? getLimitProgress(spendingLimit) : 0;
  const displayedSignerAddress = formatAddressForDisplay(signerAddress);
  const isTopUpDisabled = onTopUp
    ? isSpendingLimitPending
    : !spendingLimit || spendingLimit.isExpired || isSpendingLimitPending;

  const loyalPriceUsd = useLoyalPriceUsd();
  const loyalPlaceholderRow = useMemo(
    () => buildLoyalPlaceholderRow(loyalPriceUsd),
    [loyalPriceUsd]
  );

  useEffect(() => {
    setAccessLevel(initialAccessLevel);
  }, [initialAccessLevel, signerAddress]);

  useEffect(() => {
    setWorkspaceTab(initialTab);
  }, [initialTab, signerAddress]);

  useEffect(() => {
    if (isWorkspace) {
      setIsLimitExpanded(true);
    }
  }, [isWorkspace, signerAddress]);

  useEffect(() => {
    if (!isLimitEditing) {
      setLimitDraftError(null);
      setLimitDraftAmount(
        typeof spendingLimit?.amountUsd === "number"
          ? spendingLimit.amountUsd.toFixed(2)
          : ""
      );
    }
  }, [isLimitEditing, spendingLimit?.amountUsd]);

  const copySignerAddress = async () => {
    try {
      await navigator.clipboard.writeText(signerAddress);
      setIsAddressCopied(true);
      window.setTimeout(() => setIsAddressCopied(false), 1400);
    } catch {
      window.alert("Failed to copy address.");
    }
  };

  const startLimitEdit = () => {
    setLimitDraftAmount(
      typeof spendingLimit?.amountUsd === "number"
        ? spendingLimit.amountUsd.toFixed(2)
        : ""
    );
    setLimitDraftError(null);
    setIsLimitEditing(true);
    setIsLimitExpanded(true);
  };

  const saveLimitAmount = async () => {
    const amountUsd = Number.parseFloat(limitDraftAmount.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      setLimitDraftError("Enter an amount greater than $0.");
      return;
    }

    setLimitDraftError(null);

    try {
      await onSetSpendingLimit({
        accountIndex: vaultAccountIndex,
        amountUsd,
        existingSpendingLimitAddress: spendingLimit?.address ?? null,
        signerAddress,
      });
      setIsLimitEditing(false);
    } catch (error) {
      setLimitDraftError(
        error instanceof Error
          ? error.message
          : "Failed to save spending limit."
      );
    }
  };

  const requestLimitDelete = async () => {
    if (!spendingLimit) {
      return;
    }

    try {
      await onDeleteSpendingLimit({
        accountIndex: vaultAccountIndex,
        spendingLimitAddress: spendingLimit.address,
        signerAddress,
      });
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Failed to delete spending limit."
      );
    }
  };

  const requestSignerDelete = async () => {
    const confirmed = window.confirm(`Remove ${label} from this vault?`);
    if (!confirmed) {
      return;
    }

    try {
      await onDeleteSigner({
        accountIndex: vaultAccountIndex,
        signerAddress,
      });
      onBack();
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Failed to remove signer."
      );
    }
  };

  const requestTopUpAmount = async () => {
    if (onTopUp) {
      onTopUp();
      return;
    }

    if (!spendingLimit) {
      window.alert("Set a spending limit before topping up.");
      return;
    }

    if (spendingLimit.isExpired) {
      window.alert("This spending limit is expired.");
      return;
    }

    const nextValue = window.prompt("Top up amount in USD", "");

    if (nextValue === null) {
      return;
    }

    const amountUsd = Number.parseFloat(nextValue.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      window.alert("Enter a top-up amount greater than $0.");
      return;
    }

    try {
      await onTopUpWithSpendingLimit({
        accountIndex: vaultAccountIndex,
        amountUsd,
        signerAddress,
        spendingLimitAddress: spendingLimit.address,
      });
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Failed to top up."
      );
    }
  };

  return (
    <div
      className="agent-detail-view"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <style jsx>{`
        .agent-detail-view {
          container-type: inline-size;
        }
        .agent-back-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .agent-transfer-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .agent-topup-btn:hover {
          background: #222 !important;
        }
        .agent-access-header:hover {
          background: rgba(0, 0, 0, 0.06) !important;
        }
        .agent-radio-row:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .agent-remove-btn:hover {
          opacity: 0.7 !important;
        }
        .agent-limit-header:hover {
          background: rgba(0, 0, 0, 0.06) !important;
        }
        .agent-limit-card:hover {
          background: #ededf0 !important;
        }
        .agent-set-limit-btn:hover {
          background: #222 !important;
        }
        .agent-link-btn:hover {
          opacity: 0.7 !important;
        }
        .agent-workflow-link:hover {
          background: rgba(0, 0, 0, 0.06) !important;
        }
        .agent-address-btn:hover {
          opacity: 0.72 !important;
        }
        .agent-limit-input:focus {
          border-color: rgba(0, 0, 0, 0.2) !important;
          box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.04) !important;
        }
        .agent-scroll::-webkit-scrollbar {
          display: none;
        }
        @container (max-width: 360px) {
          .agent-action-label {
            display: none;
          }
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
          <filter id="agent-pixelate" x="0" y="0" width="100%" height="100%">
            <feFlood x="4" y="4" height="2" width="2" />
            <feComposite width="10" height="10" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="5" />
          </filter>
          <filter id="agent-pixelate-sm" x="0" y="0" width="100%" height="100%">
            <feFlood x="3" y="3" height="2" width="2" />
            <feComposite width="8" height="8" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="4" />
          </filter>
        </defs>
      </svg>

      {isWorkspace ? (
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
            <button
              aria-label={`Copy address ${signerAddress}`}
              className="agent-address-btn"
              onClick={copySignerAddress}
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
              title={signerAddress}
              type="button"
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayedSignerAddress}
              </span>
              {isAddressCopied ? (
                <Check size={12} strokeWidth={1.8} />
              ) : (
                <Copy size={12} strokeWidth={1.8} />
              )}
            </button>
          </div>
          {canDeleteSigner && (
            <button
              aria-busy={isSignerDeletePending}
              aria-label={`Remove ${label}`}
              className="agent-remove-btn"
              disabled={isSignerDeletePending}
              onClick={requestSignerDelete}
              style={{
                background: "none",
                border: "none",
                cursor: isSignerDeletePending ? "not-allowed" : "pointer",
                padding: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                opacity: isSignerDeletePending ? 0.45 : 1,
                transition: "opacity 0.15s ease",
              }}
              title={`Remove ${label}`}
              type="button"
            >
              <Trash2 size={20} style={{ color: "#F9363C" }} />
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            padding: "8px",
          }}
        >
          <button
            className="agent-back-btn"
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
        </div>
      )}

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        className="agent-scroll"
        onScroll={() => {
          const top = scrollRef.current?.scrollTop ?? 0;
          setIsScrolled(top > 0);
        }}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflowY: isWorkspace ? "hidden" : "auto",
          overflowX: "hidden",
          scrollbarWidth: "none",
          borderTop:
            !isWorkspace && isScrolled
              ? "1px solid rgba(0, 0, 0, 0.08)"
              : "1px solid transparent",
          boxShadow: isScrolled
            ? "inset 0 6px 6px -6px rgba(0, 0, 0, 0.08)"
            : "none",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", padding: "8px 20px" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={label}
            src={agentIcon}
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
              padding: "9px 0",
            }}
          >
            {!isWorkspace && (
              <>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "15px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: secondary,
                  }}
                >
                  {label}
                </span>
                <button
                  aria-label={`Copy address ${signerAddress}`}
                  className="agent-address-btn"
                  onClick={copySignerAddress}
                  style={{
                    alignSelf: "flex-start",
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
                  title={signerAddress}
                  type="button"
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {displayedSignerAddress}
                  </span>
                  {isAddressCopied ? (
                    <Check size={14} strokeWidth={1.8} />
                  ) : (
                    <Copy size={14} strokeWidth={1.8} />
                  )}
                </button>
              </>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ borderRadius: "8px", overflow: "hidden" }}>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: isWorkspace ? "40px" : "32px",
                    fontWeight: 600,
                    lineHeight: isWorkspace ? "48px" : "40px",
                    letterSpacing: isWorkspace ? "-0.44px" : "-0.352px",
                    color: isBalanceHidden ? "#BBBBC0" : "#000",
                    filter: isBalanceHidden ? "url(#agent-pixelate)" : "none",
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
              {!isWorkspace && (
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
              )}
            </div>
          </div>
          {!isWorkspace && canDeleteSigner && (
            <button
              aria-busy={isSignerDeletePending}
              aria-label={`Remove ${label}`}
              className="agent-remove-btn"
              disabled={isSignerDeletePending}
              onClick={requestSignerDelete}
              style={{
                background: "none",
                border: "none",
                cursor: isSignerDeletePending ? "not-allowed" : "pointer",
                padding: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                opacity: isSignerDeletePending ? 0.45 : 1,
                transition: "opacity 0.15s ease",
              }}
              title={`Remove ${label}`}
              type="button"
            >
              <Trash2 size={20} style={{ color: "#F9363C" }} />
            </button>
          )}
        </div>

        {showTopUpAction && (
          <div
            style={{
              display: "flex",
              gap: "16px",
              alignItems: "start",
              padding: "8px 20px",
            }}
          >
            <button
              className="agent-topup-btn"
              disabled={isTopUpDisabled}
              onClick={requestTopUpAmount}
              style={{
                width: "100%",
                display: "flex",
                gap: "6px",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 16px 10px 8px",
                borderRadius: "9999px",
                background: "#000",
                border: "none",
                cursor: isTopUpDisabled ? "default" : "pointer",
                opacity: isTopUpDisabled ? 0.45 : 1,
                transition: "background 0.15s ease",
              }}
              type="button"
            >
              <Plus size={24} style={{ color: "#fff" }} />
              <span
                className="agent-action-label"
                style={{
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: "#fff",
                }}
              >
                {isSpendingLimitPending ? "Saving" : "Top Up"}
              </span>
            </button>
          </div>
        )}

        {/* Agent Access section — collapsible */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            alignItems: "center",
            padding: "8px",
            width: "100%",
          }}
        >
          <button
            className="agent-access-header"
            onClick={() => setIsAccessExpanded((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              background: isWorkspace ? "transparent" : "rgba(0, 0, 0, 0.04)",
              borderRadius: "16px",
              padding: "14px 12px",
              border: "none",
              cursor: "pointer",
              transition: "background 0.15s ease",
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
              Access level
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
              {ACCESS_DISPLAY[accessLevel]}
            </span>
            <ChevronRight
              size={16}
              style={{
                color: "rgba(60, 60, 67, 0.3)",
                marginLeft: "6px",
                transform: isAccessExpanded
                  ? "rotate(-90deg)"
                  : "rotate(90deg)",
                transition: "transform 0.2s ease",
                flexShrink: 0,
              }}
            />
          </button>

          {/* Options list (collapsible) */}
          <div
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              maxHeight: isAccessExpanded ? "300px" : "0px",
              overflow: "hidden",
              transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            {ACCESS_OPTIONS.map((option) => {
              const selected = accessLevel === option.id;
              const isPersisted = initialAccessLevel === option.id;
              const showConfirm =
                selected && !isPersisted && Boolean(onAccessLevelChange);
              const isReadOnly = !onAccessLevelChange;
              return (
                <div
                  className="agent-radio-row"
                  key={option.id}
                  onClick={() => {
                    if (isReadOnly || isAccessLevelPending) return;
                    setAccessLevel(option.id);
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
                  {/* Icon */}
                  <div
                    style={{
                      padding: "10px 0",
                      paddingRight: "12px",
                      flexShrink: 0,
                    }}
                  >
                    <AccessLevelIcon level={option.id} />
                  </div>
                  {/* Text */}
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
                  {/* Confirm button (only on the row whose draft differs
                      from persisted state) */}
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
                        cursor: isAccessLevelPending ? "default" : "pointer",
                        opacity: isAccessLevelPending ? 0.5 : 1,
                        transition: "opacity 0.15s ease",
                        flexShrink: 0,
                      }}
                      type="button"
                    >
                      {isAccessLevelPending ? "Confirming…" : "Confirm"}
                    </button>
                  )}
                  {/* Radio */}
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

          {showSpendingLimit && (
            <>
              {/* Spending Limit — collapsible */}
              <button
                className="agent-limit-header"
                onClick={() => setIsLimitExpanded((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  background: isWorkspace
                    ? "transparent"
                    : "rgba(0, 0, 0, 0.04)",
                  borderRadius: "16px",
                  padding: "14px 12px",
                  border: "none",
                  cursor: "pointer",
                  transition: "background 0.15s ease",
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
                  Spending Limit
                </span>
                {hasLimit && !isLimitExpanded && (
                  <span
                    style={{
                      fontFamily: font,
                      fontSize: "16px",
                      fontWeight: 400,
                      lineHeight: "20px",
                      color: secondary,
                      paddingLeft: "12px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 500,
                        color: isBalanceHidden ? "#BBBBC0" : "#000",
                      }}
                    >
                      {limitAmounts?.remaining ?? "$0.00"}
                    </span>
                    <span
                      style={{ color: isBalanceHidden ? "#C8C8CC" : secondary }}
                    >
                      /{limitAmounts?.total ?? "$0.00"}
                    </span>
                  </span>
                )}
                {!hasLimit && !isLimitExpanded && (
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
                    Not set
                  </span>
                )}
                <ChevronRight
                  size={16}
                  style={{
                    color: "rgba(60, 60, 67, 0.3)",
                    marginLeft: "6px",
                    transform: isLimitExpanded
                      ? "rotate(-90deg)"
                      : "rotate(90deg)",
                    transition: "transform 0.2s ease",
                    flexShrink: 0,
                  }}
                />
              </button>

              {/* Expanded limit content */}
              <div
                style={{
                  width: "100%",
                  maxHeight: isLimitExpanded ? "270px" : "0px",
                  overflow: "hidden",
                  transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {isLimitEditing ? (
                  <div
                    style={{
                      width: "100%",
                      background: "#F5F5F5",
                      borderRadius: "16px",
                      padding: "12px",
                    }}
                  >
                    <label
                      style={{
                        color: "#000",
                        display: "block",
                        fontFamily: font,
                        fontSize: "16px",
                        fontWeight: 500,
                        letterSpacing: "-0.176px",
                        lineHeight: "20px",
                        marginBottom: "8px",
                      }}
                    >
                      Monthly limit
                    </label>
                    <div
                      style={{
                        alignItems: "center",
                        display: "flex",
                        gap: "8px",
                        width: "100%",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                        <span
                          style={{
                            color: secondary,
                            fontFamily: font,
                            fontSize: "18px",
                            left: "14px",
                            lineHeight: "24px",
                            pointerEvents: "none",
                            position: "absolute",
                            top: "10px",
                          }}
                        >
                          $
                        </span>
                        <input
                          autoFocus
                          className="agent-limit-input"
                          disabled={isSpendingLimitPending}
                          inputMode="decimal"
                          onChange={(event) => {
                            setLimitDraftAmount(event.target.value);
                            setLimitDraftError(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveLimitAmount();
                            }
                            if (event.key === "Escape") {
                              setIsLimitEditing(false);
                            }
                          }}
                          placeholder="0.00"
                          style={{
                            background: "#fff",
                            border: "1px solid rgba(0, 0, 0, 0.08)",
                            borderRadius: "9999px",
                            color: "#000",
                            fontFamily: font,
                            fontSize: "18px",
                            fontWeight: 500,
                            height: "44px",
                            lineHeight: "24px",
                            outline: "none",
                            padding: "0 14px 0 30px",
                            transition:
                              "border-color 0.15s ease, box-shadow 0.15s ease",
                            width: "100%",
                          }}
                          type="text"
                          value={limitDraftAmount}
                        />
                      </div>
                      <button
                        aria-label="Save spending limit"
                        className="agent-set-limit-btn"
                        disabled={isSpendingLimitPending}
                        onClick={() => void saveLimitAmount()}
                        style={{
                          alignItems: "center",
                          background: "#000",
                          border: "none",
                          borderRadius: "9999px",
                          color: "#fff",
                          cursor: isSpendingLimitPending ? "default" : "pointer",
                          display: "flex",
                          height: "44px",
                          justifyContent: "center",
                          opacity: isSpendingLimitPending ? 0.6 : 1,
                          transition: "background 0.15s ease",
                          width: "44px",
                        }}
                        type="button"
                      >
                        <Check size={20} />
                      </button>
                      <button
                        aria-label="Cancel spending limit edit"
                        className="agent-link-btn"
                        disabled={isSpendingLimitPending}
                        onClick={() => setIsLimitEditing(false)}
                        style={{
                          alignItems: "center",
                          background: "rgba(0, 0, 0, 0.04)",
                          border: "none",
                          borderRadius: "9999px",
                          color: secondary,
                          cursor: isSpendingLimitPending ? "default" : "pointer",
                          display: "flex",
                          height: "44px",
                          justifyContent: "center",
                          opacity: isSpendingLimitPending ? 0.6 : 1,
                          width: "44px",
                        }}
                        type="button"
                      >
                        <X size={20} />
                      </button>
                    </div>
                    <div
                      style={{
                        color: limitDraftError ? "#F9363C" : secondary,
                        fontFamily: font,
                        fontSize: "13px",
                        fontWeight: 400,
                        lineHeight: "16px",
                        minHeight: "16px",
                        paddingTop: "8px",
                      }}
                    >
                      {limitDraftError ??
                        "Applies to this agent for the current period."}
                    </div>
                  </div>
                ) : hasLimit ? (
                  <div
                    className="agent-limit-card"
                    style={{
                      width: "100%",
                      background: "#F5F5F5",
                      borderRadius: "16px",
                      padding: "0 12px",
                      transition: "background 0.15s ease",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        paddingTop: "1px",
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                          gap: "2px",
                          padding: "10px 0",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            overflow: "hidden",
                            borderRadius: "6px",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: font,
                              fontSize: "20px",
                              fontWeight: 600,
                              lineHeight: "24px",
                              color: isBalanceHidden ? "#BBBBC0" : "#000",
                              letterSpacing: "-0.22px",
                              filter: isBalanceHidden
                                ? "url(#agent-pixelate-sm)"
                                : "none",
                              transition: "filter 0.15s ease, color 0.15s ease",
                              userSelect: isBalanceHidden ? "none" : "auto",
                            }}
                          >
                            {isLimitCurrency ? (
                              <>
                                {remainingParts.whole}
                                <span
                                  style={{
                                    color: isBalanceHidden
                                      ? "#BBBBC0"
                                      : undefined,
                                  }}
                                >
                                  {remainingParts.fraction}
                                </span>
                              </>
                            ) : (
                              limitAmounts?.remaining
                            )}
                          </span>
                          <span
                            style={{
                              fontFamily: font,
                              fontSize: "16px",
                              fontWeight: 400,
                              lineHeight: "20px",
                              color: isBalanceHidden ? "#C8C8CC" : secondary,
                              letterSpacing: "-0.176px",
                              filter: isBalanceHidden
                                ? "url(#agent-pixelate-sm)"
                                : "none",
                              transition: "filter 0.15s ease, color 0.15s ease",
                              userSelect: isBalanceHidden ? "none" : "auto",
                            }}
                          >
                            /
                            {isLimitCurrency ? (
                              <>
                                {totalParts.whole}
                                <span>{totalParts.fraction}</span>
                              </>
                            ) : (
                              limitAmounts?.total
                            )}
                          </span>
                          <button
                            disabled
                            style={{
                              background: "#000",
                              border: "none",
                              borderRadius: "9999px",
                              color: "#fff",
                              cursor: "default",
                              flexShrink: 0,
                              fontFamily: font,
                              fontSize: "13px",
                              fontWeight: 500,
                              lineHeight: "16px",
                              opacity: 1,
                              padding: "7px 12px",
                              whiteSpace: "nowrap",
                            }}
                            type="button"
                          >
                            Use spending limit
                          </button>
                        </div>
                        <span
                          style={{
                            fontFamily: font,
                            fontSize: "13px",
                            fontWeight: 400,
                            lineHeight: "16px",
                            color: secondary,
                          }}
                        >
                          {spendingLimit
                            ? getLimitResetLabel(spendingLimit)
                            : ""}
                        </span>
                      </div>
                      <button
                        className="agent-link-btn"
                        disabled={isSpendingLimitPending}
                        onClick={startLimitEdit}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          paddingLeft: "12px",
                          cursor: isSpendingLimitPending
                            ? "default"
                            : "pointer",
                          background: "transparent",
                          border: "none",
                          opacity: isSpendingLimitPending ? 0.6 : 1,
                        }}
                        type="button"
                      >
                        <span
                          style={{
                            fontFamily: font,
                            fontSize: "16px",
                            fontWeight: 400,
                            lineHeight: "20px",
                            color: secondary,
                          }}
                        >
                          {isSpendingLimitPending ? "Saving" : "Change"}
                        </span>
                        <ChevronRight
                          size={24}
                          style={{
                            color: "rgba(60, 60, 67, 0.3)",
                            marginLeft: "6px",
                          }}
                        />
                      </button>
                      <button
                        aria-label="Delete spending limit"
                        className="agent-link-btn"
                        disabled={isSpendingLimitPending}
                        onClick={requestLimitDelete}
                        style={{
                          width: "36px",
                          height: "36px",
                          marginLeft: "4px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: isSpendingLimitPending
                            ? "default"
                            : "pointer",
                          background: "transparent",
                          border: "none",
                          color: "#EF4444",
                          opacity: isSpendingLimitPending ? 0.6 : 1,
                        }}
                        title="Delete spending limit"
                        type="button"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    {/* Progress bar */}
                    <div style={{ padding: "8px 0 11px" }}>
                      <div
                        style={{
                          width: "100%",
                          height: "9px",
                          borderRadius: "9999px",
                          background: "rgba(0, 0, 0, 0.04)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${limitProgress}%`,
                            height: "9px",
                            borderRadius: "9999px",
                            background: "#F9363C",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      alignItems: "center",
                      background: "#F5F5F5",
                      borderRadius: "16px",
                      display: "flex",
                      padding: "10px 12px",
                      width: "100%",
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
                          color: "#000",
                          fontFamily: font,
                          fontSize: "16px",
                          fontWeight: 500,
                          letterSpacing: "-0.176px",
                          lineHeight: "20px",
                        }}
                      >
                        Spending limit is not set
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
                        Entire balance is available
                      </span>
                    </div>
                    <div style={{ display: "flex", paddingLeft: "12px" }}>
                      <button
                        className="agent-set-limit-btn"
                        disabled={isSpendingLimitPending}
                        onClick={startLimitEdit}
                        style={{
                          background: "#000",
                          border: "none",
                          borderRadius: "9999px",
                          color: "#fff",
                          cursor: isSpendingLimitPending
                            ? "default"
                            : "pointer",
                          fontFamily: font,
                          fontSize: "14px",
                          fontWeight: 400,
                          lineHeight: "20px",
                          opacity: isSpendingLimitPending ? 0.6 : 1,
                          padding: "8px 16px",
                          transition: "background 0.15s ease",
                          whiteSpace: "nowrap",
                        }}
                        type="button"
                      >
                        {isSpendingLimitPending ? "Saving" : "Set Limit"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Tokens section */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flex: isWorkspace ? 1 : undefined,
            minHeight: isWorkspace ? 0 : undefined,
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
            {isWorkspace ? (
              <div style={{ display: "flex", gap: "24px", width: "100%" }}>
                {(["tokens", "activity"] as const).map((tab) => {
                  const isSelected = workspaceTab === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => {
                        if (tab === "activity") {
                          onActivityTabOpen?.();
                        }
                        setWorkspaceTab(tab);
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
            ) : (
              <>
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
                  className="agent-link-btn"
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
              </>
            )}
          </div>

          {isWorkspace ? (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowX: "hidden",
                overflowY: "auto",
                width: "100%",
              }}
            >
              {workspaceTab === "tokens" &&
                tokenRows.map((token) => (
                  <TokenRowItem
                    actions={getTokenActions?.(token)}
                    isBalanceHidden={isBalanceHidden}
                    key={token.id ?? token.symbol}
                    onDetail={onTokenDetail}
                    token={token}
                  />
                ))}
              {workspaceTab === "tokens" && tokenRows.length === 0 && (
                <TokenRowItem
                  isBalanceHidden={isBalanceHidden}
                  onDetail={onTokenDetail}
                  token={loyalPlaceholderRow}
                />
              )}
              {workspaceTab === "activity" &&
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
              {workspaceTab === "activity" && activityRows.length === 0 && (
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
          ) : (
            tokenRows.map((token) => (
              <TokenRowItem
                actions={getTokenActions?.(token)}
                isBalanceHidden={isBalanceHidden}
                key={token.id ?? token.symbol}
                onDetail={onTokenDetail}
                token={token}
              />
            ))
          )}
          {!isWorkspace && tokenRows.length === 0 && (
            <TokenRowItem
              isBalanceHidden={isBalanceHidden}
              onDetail={onTokenDetail}
              token={loyalPlaceholderRow}
            />
          )}
        </div>
        {!isWorkspace && (
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
                className="agent-link-btn"
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
        )}
      </div>
    </div>
  );
}
