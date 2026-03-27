"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
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

import { getTokenIconUrl } from "@/lib/token-icon";

import { AccessLevelIcon } from "./agent-page-view";
import type { AccessLevel } from "./agent-page-view";
import type { RightSidebarTab } from "./types";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

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

// Account icon mapping
const ACCOUNT_ICONS: Record<string, string> = {
  Main: "/purplebg.png",
  Shielded: "/redbg.png",
};

// Agent icon pool — shuffled per mount for random avatars
const AGENT_ICONS = Array.from(
  { length: 26 },
  (_, i) => `/agents/Agent-${String(i + 1).padStart(2, "0")}.svg`
);

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Mock stash agents
const MOCK_STASH_AGENTS = [
  {
    id: "agent-1",
    label: "Agent 1",
    balanceWhole: "$250",
    balanceFraction: ".00",
    accessLabel: "Can sign",
    accessLevel: "sign" as AccessLevel,
  },
  {
    id: "agent-2",
    label: "Agent 47",
    balanceWhole: "$0",
    balanceFraction: ".00",
    accessLabel: "Can execute",
    accessLevel: "execute" as AccessLevel,
  },
  {
    id: "agent-3",
    label: "Agent 12",
    balanceWhole: "$1,200",
    balanceFraction: ".50",
    accessLabel: "Can sign",
    accessLevel: "sign" as AccessLevel,
  },
  {
    id: "agent-4",
    label: "Agent 8",
    balanceWhole: "$85",
    balanceFraction: ".00",
    accessLabel: "Can execute",
    accessLevel: "execute" as AccessLevel,
  },
  {
    id: "agent-5",
    label: "Agent 3",
    balanceWhole: "$0",
    balanceFraction: ".00",
    accessLabel: "Can sign",
    accessLevel: "sign" as AccessLevel,
  },
  {
    id: "agent-6",
    label: "Agent 21",
    balanceWhole: "$500",
    balanceFraction: ".00",
    accessLabel: "Can execute",
    accessLevel: "execute" as AccessLevel,
  },
  {
    id: "agent-7",
    label: "Agent 99",
    balanceWhole: "$15",
    balanceFraction: ".75",
    accessLabel: "Can sign",
    accessLevel: "sign" as AccessLevel,
  },
];

const AGENTS_COLLAPSED_COUNT = 3;
const AGENTS_EXPAND_THRESHOLD = 5;

// Mock approval data
const MOCK_APPROVALS = [
  {
    id: "1",
    action: "Send",
    recipient: "@alex",
    amount: "200.00",
    token: "USDC",
    sourceLabel: "Main",
  },
  {
    id: "2",
    action: "Send",
    recipient: "@anastasia",
    amount: "15.0000",
    token: "SOL",
    sourceLabel: "Shielded",
  },
  {
    id: "3",
    action: "Send",
    recipient: "@alex",
    amount: "200.00",
    token: "USDT",
    sourceLabel: "Shielded",
  },
];

export function PortfolioContent({
  balanceFraction,
  balanceWhole,
  isBalanceHidden,
  isLoading,
  onBalanceHiddenChange,
  onClose,
  onDisconnect,
  onTabChange,
  hasVaultAccount,
  onReviewApproval,
  onSeeAllApprovals,
  onOpenReceive,
  onOpenSend,
  onOpenSwap,
  onOpenShield,
  onOpenStash,
  onOpenAgent,
  walletAddress,
  walletLabel,
  isAgentConnected,
}: {
  balanceFraction: string;
  balanceWhole: string;
  isBalanceHidden: boolean;
  isLoading: boolean;
  onBalanceHiddenChange: (hidden: boolean) => void;
  onClose: () => void;
  onDisconnect?: () => void;
  onTabChange: (tab: RightSidebarTab) => void;
  hasVaultAccount: boolean;
  onReviewApproval: () => void;
  onSeeAllApprovals: () => void;
  onOpenReceive: () => void;
  onOpenSend: () => void;
  onOpenSwap: () => void;
  onOpenShield: () => void;
  onOpenStash: () => void;
  onOpenAgent: (agent: { id: string; label: string; balanceWhole: string; balanceFraction: string; icon: string }) => void;
  walletAddress: string | null;
  walletLabel: string;
  isAgentConnected: boolean;
}) {
  // Randomise agent avatars once per mount
  const agentIcons = useMemo(() => shuffled(AGENT_ICONS), []);
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const needsExpand = MOCK_STASH_AGENTS.length > AGENTS_EXPAND_THRESHOLD;
  const visibleAgents = needsExpand && !agentsExpanded
    ? MOCK_STASH_AGENTS.slice(0, AGENTS_COLLAPSED_COUNT)
    : MOCK_STASH_AGENTS;
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
        <div style={{ padding: "8px" }}>
          <div
            style={{
              padding: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={skeletonBar("100px", "16px")} />
            <div style={skeletonBar("60px", "13px")} />
          </div>
        </div>
        <div
          style={{
            padding: "8px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <div style={skeletonBar("180px", "40px")} />
          <div style={skeletonBar("120px", "14px")} />
        </div>
        <div style={{ padding: "8px 20px", display: "flex", gap: "16px" }}>
          <div style={skeletonCircle("44px")} />
          <div style={skeletonCircle("44px")} />
          <div style={skeletonCircle("44px")} />
          <div style={skeletonBar("120px", "44px")} />
        </div>
        <div style={{ flex: 1, padding: "8px" }}>
          <div style={{ padding: "12px 12px 8px" }}>
            <div style={skeletonBar("80px", "16px")} />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "6px 12px",
            }}
          >
            <div style={skeletonCircle("48px")} />
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column" as const,
                gap: "6px",
              }}
            >
              <div style={skeletonBar("100px", "20px")} />
              <div style={skeletonBar("40px", "13px")} />
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
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
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
            </div>
          </div>
        </div>
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
      </div>

      {/* Balance */}
      <div style={{ padding: "8px 20px" }}>
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
        <span
          style={{
            fontFamily: font,
            fontSize: "14px",
            fontWeight: 400,
            lineHeight: "20px",
            color: secondary,
          }}
        >
          <span style={{ color: "#34C759" }}>+0.62% ($5.67)</span> · All time
        </span>
      </div>

      {/* Action buttons: receive, send, swap + Shield pill */}
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
          overflowY: "auto",
          overflowX: "hidden",
          scrollbarWidth: "none",
          borderTop: isScrolled ? "1px solid rgba(0, 0, 0, 0.08)" : "1px solid transparent",
          boxShadow: isScrolled ? "inset 0 6px 6px -6px rgba(0, 0, 0, 0.08)" : "none",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        }}
      >
        {/* Stash & Agents section */}
        <div
          style={{ display: "flex", flexDirection: "column", padding: "8px" }}
        >
          {/* Stash row — always visible when wallet is connected */}
          <button
            className="portfolio-account-row"
            onClick={onOpenStash}
            style={{
              position: "relative",
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
            {/* Tree trunk — from icon center to bottom (only when agents follow) */}
            {hasVaultAccount && (
              <div
                style={{
                  position: "absolute",
                  left: "35px",
                  top: "50%",
                  bottom: 0,
                  width: "1px",
                  background: "rgba(60, 60, 67, 0.12)",
                }}
              />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Stash"
              src="/agents/Stash.svg"
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
                    filter: isBalanceHidden
                      ? "url(#rs-pixelate-sm)"
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
                    }}
                  >
                    {balanceFraction}
                  </span>
                </span>
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
                Stash
              </span>
            </div>
            <ChevronLeft
              size={24}
              style={{
                color: "rgba(60, 60, 67, 0.3)",
                flexShrink: 0,
                marginLeft: "12px",
              }}
            />
          </button>

          {hasVaultAccount && (
            <>
              {/* Agent rows — indented under Stash with tree lines */}
              {visibleAgents.map((agent, agentIdx) => (
                <button
                  className="portfolio-account-row"
                  key={agent.id}
                  onClick={() => onOpenAgent({ ...agent, icon: agentIcons[agentIdx % agentIcons.length] })}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    padding: "6px 12px 6px 52px",
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
                  {/* Vertical line — full height (├) */}
                  <div
                    style={{
                      position: "absolute",
                      left: "35px",
                      top: 0,
                      bottom: 0,
                      width: "1px",
                      background: "rgba(60, 60, 67, 0.12)",
                    }}
                  />
                  {/* Horizontal branch */}
                  <div
                    style={{
                      position: "absolute",
                      left: "35px",
                      top: "50%",
                      width: "13px",
                      height: "1px",
                      background: "rgba(60, 60, 67, 0.12)",
                    }}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={agent.label}
                    src={agentIcons[agentIdx % agentIcons.length]}
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
                          filter: isBalanceHidden
                            ? "url(#rs-pixelate-sm)"
                            : "none",
                          transition: "filter 0.15s ease, color 0.15s ease",
                          userSelect: isBalanceHidden ? "none" : "auto",
                          display: "block",
                        }}
                      >
                        {agent.balanceWhole}
                        <span
                          style={{
                            color: isBalanceHidden
                              ? "#BBBBC0"
                              : "rgba(60, 60, 67, 0.4)",
                          }}
                        >
                          {agent.balanceFraction}
                        </span>
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
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
                        {agent.label}
                      </span>
                      <span
                        style={{
                          fontFamily: font,
                          fontSize: "11px",
                          fontWeight: 500,
                          lineHeight: "14px",
                          color: agent.accessLevel === "execute" ? "rgba(249, 54, 60, 0.65)" : "rgba(200, 160, 0, 0.75)",
                          border: `1px solid ${agent.accessLevel === "execute" ? "rgba(249, 54, 60, 0.25)" : "rgba(200, 160, 0, 0.3)"}`,
                          borderRadius: "9999px",
                          padding: "1px 8px 1px 4px",
                          whiteSpace: "nowrap" as const,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "2px",
                        }}
                      >
                        <AccessLevelIcon
                          level={agent.accessLevel}
                          size={14}
                          color={agent.accessLevel === "execute" ? "rgba(249, 54, 60, 0.65)" : "rgba(200, 160, 0, 0.75)"}
                        />
                        {agent.accessLabel}
                      </span>
                    </div>
                  </div>
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

              {/* View all row — shown when collapsed and there are more agents */}
              {needsExpand && !agentsExpanded && (
                <button
                  className="portfolio-account-row"
                  onClick={() => setAgentsExpanded(true)}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "4px 12px 4px 52px",
                    borderRadius: "16px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    width: "100%",
                    transition: "background 0.15s ease",
                  }}
                  type="button"
                >
                  {/* Vertical line — full height (├) */}
                  <div
                    style={{
                      position: "absolute",
                      left: "35px",
                      top: 0,
                      bottom: 0,
                      width: "1px",
                      background: "rgba(60, 60, 67, 0.12)",
                    }}
                  />
                  {/* Horizontal branch */}
                  <div
                    style={{
                      position: "absolute",
                      left: "35px",
                      top: "50%",
                      width: "13px",
                      height: "1px",
                      background: "rgba(60, 60, 67, 0.12)",
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 0",
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
                      View all ({MOCK_STASH_AGENTS.length})
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

              {/* Add agent row — last child (└) */}
              <button
                className="portfolio-account-row"
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  padding: "6px 12px 6px 52px",
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
                {/* Vertical line — top half only (└) */}
                <div
                  style={{
                    position: "absolute",
                    left: "35px",
                    top: 0,
                    bottom: "50%",
                    width: "1px",
                    background: "rgba(60, 60, 67, 0.12)",
                  }}
                />
                {/* Horizontal branch */}
                <div
                  style={{
                    position: "absolute",
                    left: "35px",
                    top: "50%",
                    width: "13px",
                    height: "1px",
                    background: "rgba(60, 60, 67, 0.12)",
                  }}
                />
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
            </>
          )}
        </div>

        {/* Approvals section */}
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
            {isAgentConnected && (
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
          {!isAgentConnected && (
            <div
              style={{
                padding: "32px 20px",
                textAlign: "center",
                fontFamily: font,
                fontSize: "14px",
                color: "rgba(60, 60, 67, 0.6)",
              }}
            >
              Approval requests from agent will appear here
            </div>
          )}
          {isAgentConnected &&
            MOCK_APPROVALS.map((approval) => (
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
                    alt={approval.token}
                    src={getTokenIconUrl(approval.token)}
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
                        {approval.action}
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
                        to {approval.recipient}
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
                        {approval.amount} {approval.token}
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
                          src={
                            ACCOUNT_ICONS[approval.sourceLabel] ??
                            "/purplebg.png"
                          }
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
                  {/* Review & Respond button */}
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      paddingBottom: "11px",
                    }}
                  >
                    <button
                      className="portfolio-review-btn"
                      onClick={onReviewApproval}
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
                      Review &amp; Respond
                    </button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
