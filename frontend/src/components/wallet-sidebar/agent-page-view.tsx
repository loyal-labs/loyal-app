"use client";

import { ArrowRight, ArrowUpRight, ChevronRight, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { ActivityRowItem } from "./activity-row-item";
import { TokenRowItem, type TokenRowActions } from "./token-row-item";
import type {
  ActivityRow,
  SubView,
  TokenRow,
  TransactionDetail,
} from "./types";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

export type AccessLevel = "suggest" | "sign" | "execute";

const ACCESS_OPTIONS: { id: AccessLevel; label: string; description: string }[] = [
  { id: "suggest", label: "Suggest Transactions", description: "Can prepare transaction suggestions for your review and approval" },
  { id: "sign", label: "Sign Transactions", description: "Can sign transactions, but only within the permissions you allow." },
  { id: "execute", label: "Execute Transactions", description: "Can sign and send transactions on your behalf without additional approval." },
];

const ACCESS_DISPLAY: Record<AccessLevel, string> = {
  suggest: "Can suggest",
  sign: "Can sign",
  execute: "Can execute",
};

export function AccessLevelIcon({ level, size = 28, color: colorProp }: { level: AccessLevel; size?: number; color?: string }) {
  const color = colorProp ?? "rgba(60, 60, 67, 0.6)";
  const scale = size / 28;
  const c = size / 2;

  if (level === "execute") {
    return (
      <svg fill="none" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        <circle cx={c} cy={c} r={11.67 * scale} stroke={color} strokeWidth={1.5 * scale} />
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
      {level === "sign" && <circle cx={c} cy={c} fill={color} r={2.33 * scale} />}
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
  onBack,
  onNavigate,
  getTokenActions,
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
  onBack: () => void;
  onNavigate: (view: Exclude<SubView, null>) => void;
  getTokenActions?: (token: TokenRow) => TokenRowActions | undefined;
}) {
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("suggest");
  const [isAccessExpanded, setIsAccessExpanded] = useState(false);
  const [isLimitExpanded, setIsLimitExpanded] = useState(false);
  const [hasLimit] = useState(true); // mock
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
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
          background: #EDEDF0 !important;
        }
        .agent-set-limit-btn:hover {
          background: #222 !important;
        }
        .agent-link-btn:hover {
          opacity: 0.7 !important;
        }
        .agent-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {/* SVG pixelation filters */}
      <svg
        aria-hidden="true"
        height="0"
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
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

      {/* Header: back (arrow right — slides back to the right) */}
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
          overflowY: "auto",
          overflowX: "hidden",
          scrollbarWidth: "none",
          borderTop: isScrolled ? "1px solid rgba(0, 0, 0, 0.08)" : "1px solid transparent",
          boxShadow: isScrolled ? "inset 0 6px 6px -6px rgba(0, 0, 0, 0.08)" : "none",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        }}
      >
        {/* Agent info: icon + label + balance + remove button */}
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
                    filter: isBalanceHidden
                      ? "url(#agent-pixelate)"
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
          {/* Remove agent — small icon, right-aligned, vertically centered with balance */}
          <button
            className="agent-remove-btn"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "opacity 0.15s ease",
            }}
            type="button"
          >
            <Trash2 size={20} style={{ color: "#F9363C" }} />
          </button>
        </div>

        {/* Action buttons: Transfer + Top Up */}
        <div
          style={{
            display: "flex",
            gap: "16px",
            alignItems: "start",
            padding: "8px 20px",
          }}
        >
          <button
            disabled
            style={{
              flex: 1,
              display: "flex",
              gap: "6px",
              alignItems: "center",
              justifyContent: "center",
              padding: "10px 16px 10px 8px",
              borderRadius: "9999px",
              background: "rgba(249, 54, 60, 0.14)",
              border: "none",
              cursor: "not-allowed",
              opacity: 0.4,
            }}
            type="button"
          >
            <ArrowUpRight size={24} style={{ color: "rgba(0, 0, 0, 0.6)" }} />
            <span
              style={{
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#000",
              }}
            >
              Transfer
            </span>
          </button>
          <button
            className="agent-topup-btn"
            style={{
              flex: 1,
              display: "flex",
              gap: "6px",
              alignItems: "center",
              justifyContent: "center",
              padding: "10px 16px 10px 8px",
              borderRadius: "9999px",
              background: "#000",
              border: "none",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            type="button"
          >
            <Plus size={24} style={{ color: "#fff" }} />
            <span
              style={{
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#fff",
              }}
            >
              Top Up
            </span>
          </button>
        </div>

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
              background: "rgba(0, 0, 0, 0.04)",
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
              Agent Access
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
                transform: isAccessExpanded ? "rotate(-90deg)" : "rotate(90deg)",
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
                return (
                  <button
                    className="agent-radio-row"
                    key={option.id}
                    onClick={() => setAccessLevel(option.id)}
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
                    <div style={{ padding: "10px 0", paddingRight: "12px", flexShrink: 0 }}>
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
                  </button>
                );
              })}
          </div>

          {/* Spending Limit — collapsible */}
          <button
            className="agent-limit-header"
            onClick={() => setIsLimitExpanded((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              background: "rgba(0, 0, 0, 0.04)",
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
                <span style={{ fontWeight: 500, color: isBalanceHidden ? "#BBBBC0" : "#000" }}>$211.56</span>
                <span style={{ color: isBalanceHidden ? "#C8C8CC" : secondary }}>/$1,200.00</span>
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
                transform: isLimitExpanded ? "rotate(-90deg)" : "rotate(90deg)",
                transition: "transform 0.2s ease",
                flexShrink: 0,
              }}
            />
          </button>

          {/* Expanded limit content */}
          <div
            style={{
              width: "100%",
              maxHeight: isLimitExpanded ? "200px" : "0px",
              overflow: "hidden",
              transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            {hasLimit ? (
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
                        alignItems: "baseline",
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
                          transition:
                            "filter 0.15s ease, color 0.15s ease",
                          userSelect: isBalanceHidden ? "none" : "auto",
                        }}
                      >
                        $211<span style={{ color: isBalanceHidden ? "#BBBBC0" : undefined }}>.56</span>
                      </span>
                      <span
                        style={{
                          fontFamily: font,
                          fontSize: "16px",
                          fontWeight: 400,
                          lineHeight: "20px",
                          color: isBalanceHidden
                            ? "#C8C8CC"
                            : secondary,
                          letterSpacing: "-0.176px",
                          filter: isBalanceHidden
                            ? "url(#agent-pixelate-sm)"
                            : "none",
                          transition:
                            "filter 0.15s ease, color 0.15s ease",
                          userSelect: isBalanceHidden ? "none" : "auto",
                        }}
                      >
                        /$1,200<span>.00</span>
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
                      left in April
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: "12px",
                      cursor: "pointer",
                    }}
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
                      Change
                    </span>
                    <ChevronRight
                      size={24}
                      style={{
                        color: "rgba(60, 60, 67, 0.3)",
                        marginLeft: "6px",
                      }}
                    />
                  </div>
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
                        width: "17.6%",
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
                  width: "100%",
                  background: "#F5F5F5",
                  borderRadius: "16px",
                  padding: "0 12px 2px",
                }}
              >
                <div
                  style={{
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
                    Limit is not set
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
                    The agent can access the full balance of this account.
                  </span>
                </div>
                <div style={{ paddingBottom: "11px" }}>
                  <button
                    className="agent-set-limit-btn"
                    style={{
                      padding: "6px 16px",
                      borderRadius: "9999px",
                      background: "#000",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: font,
                      fontSize: "14px",
                      fontWeight: 400,
                      lineHeight: "20px",
                      color: "#fff",
                      transition: "background 0.15s ease",
                    }}
                    type="button"
                  >
                    Set Limit
                  </button>
                </div>
              </div>
            )}
          </div>
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
      </div>
    </div>
  );
}
