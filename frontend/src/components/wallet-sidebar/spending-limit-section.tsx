"use client";

import type { SmartAccountSpendingLimitSnapshot } from "@loyal-labs/smart-account-vaults";
import { Check, ChevronRight, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

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

export function SpendingLimitSection({
  isBalanceHidden,
  isPending,
  onDelete,
  onSet,
  spendingLimit,
}: {
  isBalanceHidden: boolean;
  isPending: boolean;
  onDelete: (spendingLimit: SmartAccountSpendingLimitSnapshot) => Promise<void>;
  onSet: (amountUsd: number) => Promise<void>;
  spendingLimit: SmartAccountSpendingLimitSnapshot | null;
}) {
  const limitAmounts = spendingLimit ? formatLimitAmount(spendingLimit) : null;
  const isLimitCurrency = limitAmounts?.remaining.startsWith("$") ?? true;
  const remainingParts = limitAmounts
    ? splitCurrency(limitAmounts.remaining)
    : { whole: "$0", fraction: ".00" };
  const totalParts = limitAmounts
    ? splitCurrency(limitAmounts.total)
    : { whole: "$0", fraction: ".00" };
  const limitProgress = spendingLimit ? getLimitProgress(spendingLimit) : 0;
  const [draftAmount, setDraftAmount] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraftError(null);
      setDraftAmount(
        typeof spendingLimit?.amountUsd === "number"
          ? spendingLimit.amountUsd.toFixed(2)
          : ""
      );
    }
  }, [isEditing, spendingLimit?.amountUsd]);

  const startLimitEdit = () => {
    setDraftAmount(
      typeof spendingLimit?.amountUsd === "number"
        ? spendingLimit.amountUsd.toFixed(2)
        : ""
    );
    setDraftError(null);
    setIsEditing(true);
  };

  const saveLimitAmount = async () => {
    const amountUsd = Number.parseFloat(draftAmount.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      setDraftError("Enter an amount greater than $0.");
      return;
    }

    setDraftError(null);

    try {
      await onSet(amountUsd);
      setIsEditing(false);
    } catch (error) {
      setDraftError(
        error instanceof Error
          ? error.message
          : "Failed to save spending limit."
      );
    }
  };

  const requestLimitDelete = async () => {
    if (!spendingLimit) return;

    try {
      await onDelete(spendingLimit);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Failed to delete spending limit."
      );
    }
  };

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "8px",
        width: "100%",
      }}
    >
      <style jsx>{`
        .spending-limit-card:hover {
          background: #ededf0 !important;
        }
        .spending-limit-btn:hover {
          background: #222 !important;
        }
        .spending-limit-link:hover {
          opacity: 0.7 !important;
        }
        .spending-limit-input:focus {
          border-color: rgba(0, 0, 0, 0.2) !important;
          box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.04) !important;
        }
      `}</style>
      {(isEditing || spendingLimit) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            borderRadius: "16px",
            padding: "14px 12px",
          }}
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
        </div>
      )}

      {isEditing ? (
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
                className="spending-limit-input"
                disabled={isPending}
                inputMode="decimal"
                onChange={(event) => {
                  setDraftAmount(event.target.value);
                  setDraftError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveLimitAmount();
                  }
                  if (event.key === "Escape") {
                    setIsEditing(false);
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
                  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                  width: "100%",
                }}
                type="text"
                value={draftAmount}
              />
            </div>
            <button
              aria-label="Save spending limit"
              className="spending-limit-btn"
              disabled={isPending}
              onClick={() => void saveLimitAmount()}
              style={{
                alignItems: "center",
                background: "#000",
                border: "none",
                borderRadius: "9999px",
                color: "#fff",
                cursor: isPending ? "default" : "pointer",
                display: "flex",
                height: "44px",
                justifyContent: "center",
                opacity: isPending ? 0.6 : 1,
                transition: "background 0.15s ease",
                width: "44px",
              }}
              type="button"
            >
              <Check size={20} />
            </button>
            <button
              aria-label="Cancel spending limit edit"
              className="spending-limit-link"
              disabled={isPending}
              onClick={() => setIsEditing(false)}
              style={{
                alignItems: "center",
                background: "rgba(0, 0, 0, 0.04)",
                border: "none",
                borderRadius: "9999px",
                color: secondary,
                cursor: isPending ? "default" : "pointer",
                display: "flex",
                height: "44px",
                justifyContent: "center",
                opacity: isPending ? 0.6 : 1,
                width: "44px",
              }}
              type="button"
            >
              <X size={20} />
            </button>
          </div>
          <div
            style={{
              color: draftError ? "#F9363C" : secondary,
              fontFamily: font,
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
              minHeight: "16px",
              paddingTop: "8px",
            }}
          >
            {draftError ?? "Applies to this vault signer for the current period."}
          </div>
        </div>
      ) : spendingLimit ? (
        <div
          className="spending-limit-card"
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
                      ? "url(#stash-pixelate-sm)"
                      : "none",
                    transition: "filter 0.15s ease, color 0.15s ease",
                    userSelect: isBalanceHidden ? "none" : "auto",
                  }}
                >
                  {isLimitCurrency ? (
                    <>
                      {remainingParts.whole}
                      <span>{remainingParts.fraction}</span>
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
                      ? "url(#stash-pixelate-sm)"
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
                {getLimitResetLabel(spendingLimit)}
              </span>
            </div>
            <button
              className="spending-limit-link"
              disabled={isPending}
              onClick={startLimitEdit}
              style={{
                display: "flex",
                alignItems: "center",
                paddingLeft: "12px",
                cursor: isPending ? "default" : "pointer",
                background: "transparent",
                border: "none",
                opacity: isPending ? 0.6 : 1,
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
                {isPending ? "Saving" : "Change"}
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
              className="spending-limit-link"
              disabled={isPending}
              onClick={requestLimitDelete}
              style={{
                width: "36px",
                height: "36px",
                marginLeft: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: isPending ? "default" : "pointer",
                background: "transparent",
                border: "none",
                color: "#EF4444",
                opacity: isPending ? 0.6 : 1,
              }}
              title="Delete spending limit"
              type="button"
            >
              <Trash2 size={18} />
            </button>
          </div>
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
              className="spending-limit-btn"
              disabled={isPending}
              onClick={startLimitEdit}
              style={{
                background: "#000",
                border: "none",
                borderRadius: "9999px",
                color: "#fff",
                cursor: isPending ? "default" : "pointer",
                fontFamily: font,
                fontSize: "14px",
                fontWeight: 400,
                lineHeight: "20px",
                opacity: isPending ? 0.6 : 1,
                padding: "8px 16px",
                transition: "background 0.15s ease",
                whiteSpace: "nowrap",
              }}
              type="button"
            >
              {isPending ? "Saving" : "Set Limit"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
