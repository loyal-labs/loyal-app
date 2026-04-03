"use client";

import { Send } from "lucide-react";

import { getTokenIconUrl } from "@/lib/token-icon";

import { SubViewHeader } from "./shared";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

const ACCOUNT_ICONS: Record<string, string> = {
  Main: "/purplebg.png",
  Shielded: "/redbg.png",
};

// Same mock data as portfolio
const MOCK_APPROVALS = [
  { id: "1", action: "Send", recipient: "@alex", amount: "200.00", token: "USDC", sourceLabel: "Main" },
  { id: "2", action: "Send", recipient: "@anastasia", amount: "15.0000", token: "SOL", sourceLabel: "Shielded" },
  { id: "3", action: "Send", recipient: "@alex", amount: "200.00", token: "USDT", sourceLabel: "Shielded" },
  { id: "4", action: "Send", recipient: "@john", amount: "50.00", token: "USDC", sourceLabel: "Main" },
  { id: "5", action: "Send", recipient: "@kate", amount: "1.5000", token: "SOL", sourceLabel: "Main" },
];

export function AllApprovalsView({
  isBalanceHidden,
  onBack,
  onClose,
  onReview,
}: {
  isBalanceHidden: boolean;
  onBack: () => void;
  onClose: () => void;
  onReview: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .approval-review-btn:hover {
          background: rgba(0, 0, 0, 0.12) !important;
        }
      `}</style>

      {/* SVG pixelation filter */}
      <svg aria-hidden="true" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} width="0">
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
        {MOCK_APPROVALS.map((approval) => (
          <div
            key={approval.id}
            style={{
              display: "flex",
              padding: "0 12px",
              borderRadius: "16px",
              background: "transparent",
            }}
          >
            {/* Stacked icon: token (40px) + send badge (24px) */}
            <div style={{ position: "relative", width: "48px", height: "50px", flexShrink: 0, marginRight: "12px", marginTop: "6px", marginBottom: "6px" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={approval.token}
                src={getTokenIconUrl(approval.token)}
                style={{ width: "40px", height: "40px", borderRadius: "9999px", objectFit: "cover", position: "absolute", top: 0, left: 0 }}
              />
              <div style={{ position: "absolute", bottom: 0, right: 0, width: "24px", height: "24px", borderRadius: "9999px", background: "#E8E8E8", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Send size={12} style={{ color: "#3C3C43" }} />
              </div>
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingBottom: "2px" }}>
              <div style={{ display: "flex", alignItems: "center", paddingTop: "1px" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", padding: "10px 0" }}>
                  <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 500, lineHeight: "20px", color: "#000", letterSpacing: "-0.176px" }}>
                    {approval.action}
                  </span>
                  <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary }}>
                    to {approval.recipient}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-end", padding: "10px 0" }}>
                  <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: isBalanceHidden ? "#BBBBC0" : "#000", filter: isBalanceHidden ? "url(#approvals-pixelate-sm)" : "none", transition: "filter 0.15s ease, color 0.15s ease", userSelect: isBalanceHidden ? "none" : "auto" }}>
                    {approval.amount} {approval.token}
                  </span>
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary }}>
                      from
                    </span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={approval.sourceLabel}
                      src={ACCOUNT_ICONS[approval.sourceLabel] ?? "/purplebg.png"}
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
                  onClick={onReview}
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
  );
}
