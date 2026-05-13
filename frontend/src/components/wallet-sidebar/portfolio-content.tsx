"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useMemo, useRef, useState } from "react";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type {
  SmartAccountApprovalItem,
  SmartAccountSignerEntry,
  SmartAccountVaultEntry,
} from "@/hooks/use-smart-account-sidebar-data";
import type {
  WalletEarningsSummary,
  WalletPortfolioChange24h,
} from "@/hooks/use-wallet-desktop-data";
import { getTokenIconUrl } from "@/lib/token-icon";
import { getVaultIcon } from "./vault-icon";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

const skeletonBar = (width: string, height: string) => ({
  width,
  height,
  borderRadius: "6px",
  background: "rgba(0, 0, 0, 0.06)",
  animation: "skeleton-pulse 1.5s ease-in-out infinite",
});

const COLLAPSED_SIGNER_COUNT = 3;
const SIGNER_EXPAND_THRESHOLD = 5;
const rowHoverBackground = "rgba(0, 0, 0, 0.04)";

function getSmartAccountErrorCopy(error: string | null | undefined) {
  const isRateLimited = error?.toLowerCase().includes("rate limited") ?? false;

  return {
    body: isRateLimited
      ? "Smart-account reads are cooling down. Your wallet is still connected."
      : "We could not load smart-account data. Try again in a moment.",
    title: isRateLimited ? "Network limit reached" : "Could not load accounts",
  };
}

function SmartAccountInlineError({
  error,
  onRetry,
}: {
  error: string | null | undefined;
  onRetry?: () => void;
}) {
  const copy = getSmartAccountErrorCopy(error);

  return (
    <div
      style={{
        background: "#F5F5F5",
        borderRadius: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        margin: "8px",
        padding: "16px",
      }}
    >
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        <span
          style={{
            alignItems: "center",
            background: "#FDE8E9",
            borderRadius: "999px",
            color: "#F9363C",
            display: "inline-flex",
            flex: "0 0 auto",
            height: "36px",
            justifyContent: "center",
            width: "36px",
          }}
        >
          <RefreshCw size={18} strokeWidth={1.8} />
        </span>
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 600,
              lineHeight: "20px",
              margin: 0,
            }}
          >
            {copy.title}
          </p>
          <p
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "17px",
              margin: "4px 0 0",
            }}
          >
            {copy.body}
          </p>
        </div>
      </div>
      {onRetry ? (
        <button
          onClick={onRetry}
          style={{
            alignSelf: "flex-start",
            background: "#000",
            border: "none",
            borderRadius: "999px",
            color: "#fff",
            cursor: "pointer",
            fontFamily: font,
            fontSize: "14px",
            fontWeight: 500,
            lineHeight: "18px",
            padding: "8px 16px",
          }}
          type="button"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

function RowCopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const handleClick = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      void navigator.clipboard.writeText(address).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [address]
  );
  return (
    <span
      aria-label={`Copy address ${address}`}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          handleClick(event);
        }
      }}
      role="button"
      style={{
        alignItems: "center",
        color: copied ? "#34C759" : "rgba(60, 60, 67, 0.35)",
        cursor: "pointer",
        display: "inline-flex",
        flexShrink: 0,
        marginLeft: "4px",
        transition: "color 0.15s ease",
      }}
      tabIndex={0}
      title={address}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </span>
  );
}

function SignerTreeRow({
  isFirst,
  isLast,
  isBalanceHidden,
  isSelected,
  onOpen,
  signer,
}: {
  isFirst: boolean;
  isLast: boolean;
  isBalanceHidden: boolean;
  isSelected: boolean;
  onOpen: (signer: SmartAccountSignerEntry) => void;
  signer: SmartAccountSignerEntry;
}) {
  return (
    <button
      className="portfolio-account-row"
      onClick={() => onOpen(signer)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        minHeight: "56px",
        marginTop: isFirst ? "12px" : 0,
        padding: "0 12px",
        borderRadius: "16px",
        background: isSelected ? rowHoverBackground : "transparent",
        border: "none",
        cursor: "pointer",
        width: "100%",
        transition: "background 0.15s ease",
        textAlign: "left",
      }}
      title={signer.address}
      type="button"
    >
      <div
        style={{
          position: "absolute",
          left: "36px",
          top: isFirst ? "-12px" : 0,
          bottom: isLast ? "28px" : 0,
          width: "1px",
          background: "rgba(60, 60, 67, 0.16)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "36px",
          top: "28px",
          width: "12px",
          height: "1px",
          background: "rgba(60, 60, 67, 0.16)",
        }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={signer.label}
        src={signer.icon}
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "12px",
          flexShrink: 0,
          marginLeft: "36px",
          marginRight: "12px",
        }}
      />
      <div
        style={{
          flex: 1,
          minWidth: 0,
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
            {signer.balanceWhole}
            <span
              style={{
                color: isBalanceHidden
                  ? "#BBBBC0"
                  : "rgba(60, 60, 67, 0.4)",
              }}
            >
              {signer.balanceFraction}
            </span>
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: font,
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
              color: secondary,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {signer.label} · {signer.shortAddress}
          </span>
          <RowCopyAddress address={signer.address} />
        </div>
      </div>
    </button>
  );
}

function AddSignerTreeRow({
  isFirst,
  onOpen,
}: {
  isFirst: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      className="portfolio-account-row"
      onClick={onOpen}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        minHeight: "56px",
        marginTop: isFirst ? "12px" : 0,
        padding: "0 12px",
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
          position: "absolute",
          left: "36px",
          top: isFirst ? "-12px" : 0,
          bottom: "28px",
          width: "1px",
          background: "rgba(60, 60, 67, 0.16)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "36px",
          top: "28px",
          width: "12px",
          height: "1px",
          background: "rgba(60, 60, 67, 0.16)",
        }}
      />
      <span
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "12px",
          flexShrink: 0,
          marginLeft: "36px",
          marginRight: "12px",
          background: "rgba(249, 54, 60, 0.14)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(60, 60, 67, 0.6)",
        }}
      >
        <Plus size={28} strokeWidth={1.5} />
      </span>
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
    </button>
  );
}

export function PortfolioContent({
  balanceFraction,
  balanceWhole,
  isBalanceHidden,
  isLoading,
  smartAccountError,
  onBalanceHiddenChange,
  onClose,
  onDisconnect,
  hasVaultAccount,
  approvals,
  vaultEntries,
  onReviewApproval,
  onSeeAllApprovals,
  onOpenReceive,
  onOpenSend,
  onOpenSwap,
  onOpenShield,
  onOpenCommandMenu,
  onOpenWallet,
  onOpenVault,
  onOpenAgent,
  onOpenAddSigner,
  onSmartAccountRetry,
  walletAddress,
  walletLabel,
  portfolioChange24h = null,
  earningsSummary = null,
  selectedSignerId = null,
  selectedVaultIndex = null,
  isWalletSelected = false,
  showActionButtons = true,
  showApprovals = true,
  showHeaderControls = true,
}: {
  balanceFraction: string;
  balanceWhole: string;
  isBalanceHidden: boolean;
  isLoading: boolean;
  smartAccountError?: string | null;
  onBalanceHiddenChange: (hidden: boolean) => void;
  onClose: () => void;
  onDisconnect?: () => void;
  hasVaultAccount: boolean;
  approvals: SmartAccountApprovalItem[];
  vaultEntries: SmartAccountVaultEntry[];
  onReviewApproval: (approval: SmartAccountApprovalItem) => void;
  onSeeAllApprovals: () => void;
  onOpenReceive: () => void;
  onOpenSend: () => void;
  onOpenSwap: () => void;
  onOpenShield: () => void;
  onOpenCommandMenu?: () => void;
  onOpenWallet?: () => void;
  onOpenVault: (accountIndex: number) => void;
  onOpenAgent: (agent: SmartAccountSignerEntry) => void;
  onOpenAddSigner?: (accountIndex: number) => void;
  onSmartAccountRetry?: () => void;
  walletAddress: string | null;
  walletLabel: string;
  portfolioChange24h?: WalletPortfolioChange24h | null;
  earningsSummary?: WalletEarningsSummary | null;
  selectedSignerId?: string | null;
  selectedVaultIndex?: number | null;
  isWalletSelected?: boolean;
  showActionButtons?: boolean;
  showApprovals?: boolean;
  showHeaderControls?: boolean;
}) {
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [expandedSignerVaults, setExpandedSignerVaults] = useState<Set<number>>(
    () => new Set()
  );
  const sortedVaultEntries = useMemo(
    () =>
      [...vaultEntries].sort(
        (left, right) => left.accountIndex - right.accountIndex
      ),
    [vaultEntries]
  );
  const expandVaultSigners = useCallback((accountIndex: number) => {
    setExpandedSignerVaults((current) => {
      const next = new Set(current);
      next.add(accountIndex);
      return next;
    });
  }, []);
  const shortRowAddress = useCallback((address: string | null | undefined) => {
    if (!address) return null;
    return `${address.slice(0, 4)}…${address.slice(-4)}`;
  }, []);
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: 0,
            padding: "0 8px 8px",
          }}
        >
          <div style={{ padding: "12px 12px 18px" }}>
            <div style={skeletonBar("148px", "24px")} />
            <div style={{ height: "8px" }} />
            <div style={skeletonBar("190px", "20px")} />
          </div>

          <div style={{ padding: "8px 12px 28px" }}>
            <div style={skeletonBar("220px", "64px")} />
            <div style={{ height: "14px" }} />
            <div style={skeletonBar("168px", "20px")} />
          </div>

          {showActionButtons && (
            <div style={{ padding: "0 12px 24px", display: "flex", gap: "12px" }}>
              <div style={skeletonBar("74px", "44px")} />
              <div style={skeletonBar("74px", "44px")} />
              <div style={skeletonBar("74px", "44px")} />
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "28px",
              background: "rgba(0, 0, 0, 0.04)",
            }}
          >
            <div style={{ ...skeletonBar("64px", "64px"), borderRadius: "20px" }} />
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column" as const,
                gap: "8px",
                paddingTop: "6px",
              }}
            >
              <div style={skeletonBar("120px", "28px")} />
              <div style={skeletonBar("178px", "18px")} />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "64px 1fr",
              gap: "12px",
              padding: "12px 16px 0 40px",
            }}
          >
            <div
              style={{
                width: "1px",
                height: "52px",
                justifySelf: "center",
                background: "rgba(0, 0, 0, 0.08)",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div style={{ ...skeletonBar("56px", "56px"), borderRadius: "18px" }} />
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column" as const,
                  gap: "8px",
                }}
              >
                <div style={skeletonBar("92px", "24px")} />
                <div style={skeletonBar("154px", "16px")} />
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .portfolio-close-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .portfolio-action-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .portfolio-shield-btn:hover {
          background: rgba(60, 60, 67, 0.06) !important;
        }
        .portfolio-link-btn:hover {
          opacity: 0.7;
        }
        .portfolio-review-btn:hover {
          background: rgba(0, 0, 0, 0.12) !important;
        }
        .portfolio-account-row:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .portfolio-disconnect-btn:hover {
          background: rgba(60, 60, 67, 0.1) !important;
          color: rgba(60, 60, 67, 0.6) !important;
        }
        .portfolio-command-btn:hover {
          background: rgba(0, 0, 0, 0.06) !important;
        }
        .portfolio-address-btn:hover {
          opacity: 0.72;
        }
        .portfolio-scroll::-webkit-scrollbar {
          display: none;
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

      {/* Header: My Wallet + disconnect + settings + close */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", flex: 1 }}>
          <div
            style={{
              padding: "0 12px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span
              style={{
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 600,
                lineHeight: "20px",
                color: "#000",
              }}
            >
              My Wallet
            </span>
            {walletAddress ? (
              <button
                aria-label={`Copy address ${walletAddress}`}
                className="portfolio-address-btn"
                onClick={handleCopyAddress}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  color: secondary,
                  transition: "opacity 0.15s ease",
                }}
                title={walletAddress}
                type="button"
              >
                <span>{walletLabel}</span>
                <span
                  style={{
                    color: copied ? "#34C759" : "rgba(60, 60, 67, 0.35)",
                    display: "inline-flex",
                    alignItems: "center",
                    transition: "color 0.15s ease",
                    flexShrink: 0,
                  }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </span>
              </button>
            ) : (
              <span
                style={{
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  color: secondary,
                }}
              >
                {walletLabel}
              </span>
            )}
          </div>
        </div>
        {/* Cmd+K command menu trigger temporarily hidden.
        {onOpenCommandMenu ? (
          <button
            className="portfolio-command-btn"
            onClick={onOpenCommandMenu}
            style={{
              alignItems: "center",
              background: "transparent",
              border: "none",
              borderRadius: "999px",
              color: "rgba(60, 60, 67, 0.6)",
              cursor: "pointer",
              display: "inline-flex",
              flexShrink: 0,
              fontFamily: font,
              fontSize: "12px",
              fontWeight: 500,
              gap: "6px",
              lineHeight: "18px",
              padding: "5px 7px",
              transition: "background 0.15s ease",
            }}
            type="button"
          >
            <span>Try</span>
            <KbdGroup>
              <Kbd>Cmd</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </button>
        ) : null}
        */}
        {showHeaderControls && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
            paddingLeft: "12px",
          }}
        >
          {onDisconnect && (
            <button
              className="portfolio-disconnect-btn"
              onClick={onDisconnect}
              style={{
                background: "rgba(60, 60, 67, 0.06)",
                border: "none",
                borderRadius: "6px",
                padding: "2px 8px",
                fontFamily: font,
                fontSize: "12px",
                fontWeight: 500,
                lineHeight: "18px",
                color: "rgba(60, 60, 67, 0.45)",
                cursor: "pointer",
                transition: "background 0.15s ease, color 0.15s ease",
                flexShrink: 0,
              }}
              type="button"
            >
              Disconnect
            </button>
          )}
          <button
            className="portfolio-close-btn"
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
        )}
      </div>

      {/* Balance */}
      <div
        className="portfolio-account-row"
        onClick={onOpenWallet}
        onKeyDown={(event) => {
          if (!onOpenWallet) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenWallet();
          }
        }}
        role={onOpenWallet ? "button" : undefined}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          width: "calc(100% - 16px)",
          margin: "0 8px",
          padding: "8px 12px",
          borderRadius: "16px",
          background: isWalletSelected ? rowHoverBackground : "transparent",
          border: "none",
          cursor: onOpenWallet ? "pointer" : "default",
          textAlign: "left",
          transition: "background 0.15s ease",
        }}
        tabIndex={onOpenWallet ? 0 : undefined}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ borderRadius: "8px", overflow: "hidden" }}>
            <span
              style={{
                fontFamily: font,
                fontSize: "40px",
                fontWeight: 600,
                lineHeight: "48px",
                letterSpacing: "-0.44px",
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
                  color: isBalanceHidden ? "#BBBBC0" : "rgba(60, 60, 67, 0.4)",
                  transition: "color 0.15s ease",
                }}
              >
                {balanceFraction}
              </span>
            </span>
          </div>
          <button
            onClick={(event) => {
              event.stopPropagation();
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
        {(() => {
          const hasChange = portfolioChange24h !== null;
          const earnedUsd = earningsSummary?.totalEarnedUsd ?? 0;
          const hasEarned =
            typeof earnedUsd === "number" &&
            Number.isFinite(earnedUsd) &&
            earnedUsd > 0;

          if (!hasChange && !hasEarned) {
            return null;
          }

          const changeColor = hasChange
            ? portfolioChange24h.percent >= 0
              ? "#34C759"
              : "#F9363C"
            : secondary;
          const sign = (value: number) => (value >= 0 ? "+" : "");
          const formatUsd = (value: number) => {
            const abs = Math.abs(value).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
            return `${value < 0 ? "-" : ""}$${abs}`;
          };

          return (
            <span
              style={{
                fontFamily: font,
                fontSize: "14px",
                fontWeight: 400,
                lineHeight: "20px",
                color: secondary,
              }}
            >
              {hasChange && (
                <>
                  <span style={{ color: changeColor }}>
                    {`${sign(portfolioChange24h.percent)}${portfolioChange24h.percent.toFixed(2)}% (${sign(portfolioChange24h.usdAmount)}${formatUsd(portfolioChange24h.usdAmount)})`}
                  </span>
                  {" · 24h"}
                </>
              )}
              {hasChange && hasEarned ? " · " : null}
              {hasEarned && (
                <span style={{ color: "#34C759" }}>
                  {`+${formatUsd(earnedUsd)} earned`}
                </span>
              )}
            </span>
          );
        })()}
      </div>

      {/* Action buttons: receive, send, swap + Shield pill */}
      {showActionButtons && (
      <div
        style={{
          display: "flex",
          gap: "16px",
          alignItems: "center",
          padding: "8px 20px",
        }}
      >
        <button
          className="portfolio-action-btn"
          onClick={onOpenReceive}
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "9999px",
            background: "rgba(249, 54, 60, 0.14)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "background 0.15s ease",
            flexShrink: 0,
          }}
          type="button"
        >
          <ArrowDownLeft size={24} style={{ color: "rgba(60, 60, 67, 0.6)" }} />
        </button>
        <button
          className="portfolio-action-btn"
          onClick={onOpenSend}
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "9999px",
            background: "rgba(249, 54, 60, 0.14)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "background 0.15s ease",
            flexShrink: 0,
          }}
          type="button"
        >
          <ArrowUpRight size={24} style={{ color: "rgba(60, 60, 67, 0.6)" }} />
        </button>
        <button
          className="portfolio-action-btn"
          onClick={onOpenSwap}
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "9999px",
            background: "rgba(249, 54, 60, 0.14)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "background 0.15s ease",
            flexShrink: 0,
          }}
          type="button"
        >
          <RefreshCw size={24} style={{ color: "rgba(60, 60, 67, 0.6)" }} />
        </button>
        <button
          className="portfolio-shield-btn"
          onClick={onOpenShield}
          style={{
            flex: 1,
            display: "flex",
            gap: "6px",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px 16px 10px 8px",
            borderRadius: "9999px",
            background: "transparent",
            border: "2px solid rgba(60, 60, 67, 0.18)",
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
          type="button"
        >
          <Image alt="Shield" height={20} src="/Shield.svg" width={20} />
          <span
            style={{
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "#000",
            }}
          >
            Shield
          </span>
        </button>
      </div>
      )}

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        className="portfolio-scroll"
        onScroll={() => {
          const top = scrollRef.current?.scrollTop ?? 0;
          setIsScrolled(top > 0);
        }}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          scrollbarWidth: "none",
          borderTop: isScrolled ? "1px solid rgba(0, 0, 0, 0.08)" : "1px solid transparent",
          boxShadow: isScrolled ? "inset 0 6px 6px -6px rgba(0, 0, 0, 0.08)" : "none",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        }}
      >
        {/* Vault section */}
        <div
          style={{ display: "flex", flexDirection: "column", padding: "8px" }}
        >
          {smartAccountError ? (
            <SmartAccountInlineError
              error={smartAccountError}
              onRetry={onSmartAccountRetry}
            />
          ) : hasVaultAccount ? (
            <>
              {sortedVaultEntries.map((vault) => {
                const signersExpanded = expandedSignerVaults.has(
                  vault.accountIndex
                );
                const needsSignerExpand =
                  vault.signers.length > SIGNER_EXPAND_THRESHOLD;
                const visibleSigners =
                  needsSignerExpand && !signersExpanded
                    ? vault.signers.slice(0, COLLAPSED_SIGNER_COUNT)
                    : vault.signers;
                const vaultAddressLabel = shortRowAddress(vault.address);
                const isVaultSelected =
                  selectedVaultIndex === vault.accountIndex &&
                  selectedSignerId === null &&
                  !isWalletSelected;

                return (
                  <div
                    key={vault.address}
                    style={{ display: "flex", flexDirection: "column" }}
                  >
                    <button
                      className="portfolio-account-row"
                      onClick={() => onOpenVault(vault.accountIndex)}
                      style={{
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        minHeight: "68px",
                        padding: "4px 12px",
                        borderRadius: "16px",
                        background: isVaultSelected
                          ? rowHoverBackground
                          : "transparent",
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
                          position: "absolute",
                          left: "36px",
                          top: "50%",
                          bottom: "-12px",
                          width: "1px",
                          background: "rgba(60, 60, 67, 0.16)",
                        }}
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={vault.label}
                        src={getVaultIcon(vault.accountIndex)}
                        style={{
                          width: "48px",
                          height: "48px",
                          borderRadius: "12px",
                          flexShrink: 0,
                          marginRight: "12px",
                        }}
                      />
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: "2px",
                          padding: "9px 0",
                        }}
                      >
                        <div
                          style={{ borderRadius: "6px", overflow: "hidden" }}
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
                                ? "url(#rs-pixelate-sm)"
                                : "none",
                              transition: "filter 0.15s ease, color 0.15s ease",
                              userSelect: isBalanceHidden ? "none" : "auto",
                              display: "block",
                            }}
                          >
                            {vault.balanceWhole}
                            <span
                              style={{
                                color: isBalanceHidden
                                  ? "#BBBBC0"
                                  : "rgba(60, 60, 67, 0.4)",
                              }}
                            >
                              {vault.balanceFraction}
                            </span>
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: font,
                              fontSize: "13px",
                              fontWeight: 400,
                              lineHeight: "16px",
                              color: secondary,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {vaultAddressLabel
                              ? `${vault.label} · ${vaultAddressLabel}`
                              : vault.label}
                          </span>
                          {vault.address ? (
                            <RowCopyAddress address={vault.address} />
                          ) : null}
                        </div>
                      </div>
                    </button>

                    {visibleSigners.map((signer, signerIndex) => (
                      <SignerTreeRow
                        isFirst={signerIndex === 0}
                        isLast={false}
                        isBalanceHidden={isBalanceHidden}
                        isSelected={selectedSignerId === signer.id}
                        key={signer.id}
                        onOpen={onOpenAgent}
                        signer={signer}
                      />
                    ))}

                    {needsSignerExpand && !signersExpanded && (
                      <button
                        className="portfolio-account-row"
                        onClick={() => expandVaultSigners(vault.accountIndex)}
                        style={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minHeight: "44px",
                          padding: "0 12px",
                          borderRadius: "16px",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          width: "100%",
                          transition: "background 0.15s ease",
                        }}
                        type="button"
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: "36px",
                            top: 0,
                            bottom: 0,
                            width: "1px",
                            background: "rgba(60, 60, 67, 0.16)",
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            left: "36px",
                            top: "22px",
                            width: "12px",
                            height: "1px",
                            background: "rgba(60, 60, 67, 0.16)",
                          }}
                        />
                        <div
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "8px 0",
                            marginLeft: "36px",
                          }}
                        >
                          <div
                            style={{
                              flex: 1,
                              height: "1px",
                              background: "rgba(60, 60, 67, 0.12)",
                            }}
                          />
                          <span
                            style={{
                              fontFamily: font,
                              fontSize: "13px",
                              fontWeight: 500,
                              lineHeight: "16px",
                              color: secondary,
                              whiteSpace: "nowrap",
                            }}
                          >
                            View all signers ({vault.signers.length})
                          </span>
                          <div
                            style={{
                              flex: 1,
                              height: "1px",
                              background: "rgba(60, 60, 67, 0.12)",
                            }}
                          />
                        </div>
                      </button>
                    )}

                    <AddSignerTreeRow
                      isFirst={visibleSigners.length === 0}
                      onOpen={() => onOpenAddSigner?.(vault.accountIndex)}
                    />
                  </div>
                );
              })}
            </>
          ) : (
            <div
              style={{
                padding: "12px 20px",
                textAlign: "center",
                fontFamily: font,
                fontSize: "14px",
                color: secondary,
              }}
            >
              No vaults found.
            </div>
          )}
        </div>

        {/* Approvals section */}
        {showApprovals && (
        <div
          style={{ display: "flex", flexDirection: "column", padding: "8px" }}
        >
          {/* Section header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "3px 12px 1px",
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
                padding: "12px 0 8px",
              }}
            >
              Approvals
            </span>
            {approvals.length > 0 && (
              <button
                className="portfolio-link-btn"
                onClick={onSeeAllApprovals}
                style={{
                  background: "none",
                  border: "none",
                  padding: "12px 0 8px",
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
            )}
          </div>

          {/* Approval rows */}
          {smartAccountError ? (
            <SmartAccountInlineError
              error={smartAccountError}
              onRetry={onSmartAccountRetry}
            />
          ) : approvals.length === 0 && (
            <div
              style={{
                padding: "32px 20px",
                textAlign: "center",
                fontFamily: font,
                fontSize: "14px",
                color: "rgba(60, 60, 67, 0.6)",
              }}
            >
              No smart-account proposals yet.
            </div>
          )}
          {approvals.slice(0, 3).map((approval) => (
            <div
              key={approval.id}
              style={{
                display: "flex",
                padding: "0 12px",
                borderRadius: "16px",
                background: "transparent",
              }}
            >
                {/* Stacked icon: token (40px) + account badge (24px) */}
                <div
                  style={{
                    position: "relative",
                    width: "48px",
                    height: "50px",
                    flexShrink: 0,
                    marginRight: "12px",
                    marginTop: "6px",
                    marginBottom: "6px",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={approval.symbol}
                    src={getTokenIconUrl(approval.symbol)}
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "9999px",
                      objectFit: "cover",
                      position: "absolute",
                      top: 0,
                      left: 0,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      right: 0,
                      width: "24px",
                      height: "24px",
                      borderRadius: "9999px",
                      background: "#E8E8E8",
                      border: "2px solid #fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Send size={12} style={{ color: "#3C3C43" }} />
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    paddingBottom: "2px",
                  }}
                >
                  {/* Top row: action + amount */}
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
                        {approval.title}
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
                        {approval.status.charAt(0).toUpperCase() + approval.status.slice(1)} · to{" "}
                        {approval.destinationLabel}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                        alignItems: "flex-end",
                        padding: "10px 0",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: font,
                          fontSize: "16px",
                          fontWeight: 400,
                          lineHeight: "20px",
                          color: isBalanceHidden ? "#BBBBC0" : "#000",
                          filter: isBalanceHidden
                            ? "url(#rs-pixelate-sm)"
                            : "none",
                          transition: "filter 0.15s ease, color 0.15s ease",
                          userSelect: isBalanceHidden ? "none" : "auto",
                        }}
                      >
                        {approval.amount} {approval.symbol}
                      </span>
                      <div
                        style={{
                          display: "flex",
                          gap: "4px",
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: font,
                            fontSize: "13px",
                            fontWeight: 400,
                            lineHeight: "16px",
                            color: secondary,
                          }}
                        >
                          from
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt={approval.sourceLabel}
                          src={getVaultIcon(approval.sourceAccountIndex)}
                          style={{
                            width: "16px",
                            height: "16px",
                            borderRadius: "4px",
                            objectFit: "cover",
                          }}
                        />
                        <span
                          style={{
                            fontFamily: font,
                            fontSize: "13px",
                            fontWeight: 400,
                            lineHeight: "16px",
                            color: secondary,
                          }}
                        >
                          {approval.sourceLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                  {(() => {
                    const pillLabel =
                      approval.status === "active"
                        ? "Review & Respond"
                        : approval.status === "approved" &&
                          approval.canExecute
                        ? "Execute"
                        : null;
                    if (!pillLabel) return null;
                    return (
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          paddingBottom: "11px",
                        }}
                      >
                        <button
                          className="portfolio-review-btn"
                          onClick={() => onReviewApproval(approval)}
                          style={{
                            padding: "6px 16px",
                            borderRadius: "9999px",
                            background: "rgba(0, 0, 0, 0.04)",
                            border: "none",
                            cursor: "pointer",
                            fontFamily: font,
                            fontSize: "14px",
                            fontWeight: 400,
                            lineHeight: "20px",
                            color: "#000",
                            transition: "background 0.15s ease",
                          }}
                          type="button"
                        >
                          {pillLabel}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))}
        </div>
        )}
      </div>
    </div>
  );
}
