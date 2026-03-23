"use client";

import { ArrowLeft, ChevronRight, Eye, EyeOff, Trash2, X } from "lucide-react";
import { useState } from "react";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

type AccessLevel = "view" | "suggest" | "sign" | "execute";

const ACCESS_OPTIONS: { id: AccessLevel; label: string; description: string }[] = [
  { id: "view", label: "View Only", description: "Can view wallet activity and balances, but cannot create or sign transactions." },
  { id: "suggest", label: "Suggest Transactions", description: "Can prepare transaction suggestions for your review and approval" },
  { id: "sign", label: "Sign Transactions", description: "Can sign transactions, but only within the permissions you allow." },
  { id: "execute", label: "Execute Transactions", description: "Can sign and send transactions on your behalf without additional approval." },
];

export function AgentPageView({
  label,
  initials,
  balanceWhole,
  balanceFraction,
  isBalanceHidden,
  onBalanceHiddenChange,
  onBack,
  onClose,
}: {
  label: string;
  initials: string;
  balanceWhole: string;
  balanceFraction: string;
  isBalanceHidden: boolean;
  onBalanceHiddenChange: (hidden: boolean) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("suggest");
  const [hasLimit] = useState(true); // mock: toggle for limit set vs not set

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .agent-back-btn:hover,
        .agent-close-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .agent-radio-row:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .agent-remove-row:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .agent-limit-card:hover {
          background: #EDEDF0 !important;
        }
        .agent-set-limit-btn:hover {
          background: #222 !important;
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
          <ArrowLeft size={24} />
        </button>
        <button
          className="agent-close-btn"
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

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {/* Agent info: initials circle + label + balance */}
        <div
          style={{ display: "flex", alignItems: "center", padding: "8px 20px" }}
        >
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              background: "rgba(0, 0, 0, 0.04)",
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
                fontSize: "20px",
                fontWeight: 600,
                lineHeight: "20px",
                color: secondary,
              }}
            >
              {initials}
            </span>
          </div>
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
        </div>

        {/* Agent Access section */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "8px",
            width: "100%",
          }}
        >
          <div style={{ width: "100%", padding: "3px 12px 1px" }}>
            <div style={{ padding: "12px 0 8px" }}>
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
                Agent Access
              </span>
            </div>
          </div>

          {ACCESS_OPTIONS.map((option) => {
            const selected = accessLevel === option.id;
            return (
              <button
                className="agent-radio-row"
                key={option.id}
                onClick={() => setAccessLevel(option.id)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  padding: "10px 12px",
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
                {/* Radio circle */}
                <div
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "9999px",
                    border: selected
                      ? "7px solid #F9363C"
                      : "2px solid rgba(60, 60, 67, 0.3)",
                    background: "#fff",
                    flexShrink: 0,
                    marginRight: "12px",
                    marginTop: "0px",
                    boxSizing: "border-box",
                    transition: "border 0.15s ease",
                  }}
                />
                {/* Text */}
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
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
              </button>
            );
          })}
        </div>

        {/* Spending Limit section */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "8px",
            width: "100%",
          }}
        >
          <div style={{ width: "100%", padding: "3px 12px 1px" }}>
            <div style={{ padding: "12px 0 8px" }}>
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
                Spending Limit
              </span>
            </div>
          </div>

          {hasLimit ? (
            /* Limit is set — show progress card */
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
            /* No limit set */
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

        {/* Remove Agent */}
        <div style={{ padding: "8px" }}>
          <button
            className="agent-remove-row"
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
              height: "60px",
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
              <Trash2 size={24} style={{ color: "#F9363C" }} />
            </div>
            <span
              style={{
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 500,
                lineHeight: "20px",
                color: "#F9363C",
                letterSpacing: "-0.176px",
              }}
            >
              Remove Agent
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
