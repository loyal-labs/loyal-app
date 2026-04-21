"use client";

import { Send } from "lucide-react";

import type { SmartAccountApprovalItem } from "@/hooks/use-smart-account-sidebar-data";
import { getTokenIconUrl } from "@/lib/token-icon";

import { SubViewHeader } from "./shared";
import { getVaultIcon } from "./vault-icon";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

export function AllApprovalsView({
  approvals,
  isBalanceHidden,
  onBack,
  onClose,
  onReview,
}: {
  approvals: SmartAccountApprovalItem[];
  isBalanceHidden: boolean;
  onBack: () => void;
  onClose: () => void;
  onReview: (approval: SmartAccountApprovalItem) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .approval-review-btn:hover {
          background: rgba(0, 0, 0, 0.12) !important;
        }
      `}</style>

      <svg
        aria-hidden="true"
        height="0"
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
        width="0"
      >
        <defs>
          <filter id="approvals-pixelate-sm" x="0" y="0" width="100%" height="100%">
            <feFlood x="3" y="3" height="2" width="2" />
            <feComposite width="8" height="8" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="4" />
          </filter>
        </defs>
      </svg>

      <SubViewHeader onBack={onBack} onClose={onClose} title="Approvals" />

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 8px" }}>
        {approvals.length === 0 ? (
          <div
            style={{
              padding: "32px 20px",
              textAlign: "center",
              fontFamily: font,
              fontSize: "14px",
              color: secondary,
            }}
          >
            No smart-account proposals yet.
          </div>
        ) : (
          approvals.map((approval) => (
            <div
              key={approval.id}
              style={{
                display: "flex",
                padding: "0 12px",
                borderRadius: "16px",
                background: "transparent",
              }}
            >
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

              <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingBottom: "2px" }}>
                <div style={{ display: "flex", alignItems: "center", paddingTop: "1px" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", padding: "10px 0" }}>
                    <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 500, lineHeight: "20px", color: "#000", letterSpacing: "-0.176px" }}>
                      {approval.title}
                    </span>
                    <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary }}>
                      to {approval.destinationLabel}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-end", padding: "10px 0" }}>
                    <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: isBalanceHidden ? "#BBBBC0" : "#000", filter: isBalanceHidden ? "url(#approvals-pixelate-sm)" : "none", transition: "filter 0.15s ease, color 0.15s ease", userSelect: isBalanceHidden ? "none" : "auto" }}>
                      {approval.amount} {approval.symbol}
                    </span>
                    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary }}>
                        from
                      </span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={approval.sourceLabel}
                        src={getVaultIcon(approval.sourceAccountIndex)}
                        style={{ width: "16px", height: "16px", borderRadius: "4px", objectFit: "cover" }}
                      />
                      <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary }}>
                        {approval.sourceLabel}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", paddingBottom: "11px" }}>
                  <button
                    className="approval-review-btn"
                    onClick={() => onReview(approval)}
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
                    Review
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
