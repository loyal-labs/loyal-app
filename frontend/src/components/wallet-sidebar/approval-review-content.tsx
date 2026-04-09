"use client";

import { useState } from "react";

import { SubViewHeader } from "./shared";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

export function ApprovalReviewContent({
  onBack,
  onClose,
  onDecline,
  onApprove,
}: {
  onBack: () => void;
  onClose: () => void;
  onDecline: () => void;
  onApprove: () => void;
}) {
  const [phase, setPhase] = useState<"review" | "success">("review");

  if (phase === "success") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <style jsx>{`
          .review-close-btn:hover { background: rgba(0, 0, 0, 0.08) !important; }
          .review-done-btn:hover { background: rgba(0, 0, 0, 0.08) !important; }
          @keyframes mascotNod {
            0%, 100% { transform: rotate(0deg); }
            25% { transform: rotate(4deg); }
            75% { transform: rotate(-4deg); }
          }
        `}</style>

        <SubViewHeader onBack={onApprove} onClose={onApprove} title="Send Request" />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", alignItems: "center", padding: "24px 32px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Success"
              src="/hero-new/success.svg"
              style={{ width: "100px", height: "80px", animation: "mascotNod 0.6s ease-in-out 2", transformOrigin: "center bottom" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center", textAlign: "center" }}>
              <span style={{ fontFamily: font, fontSize: "20px", fontWeight: 600, lineHeight: "24px", color: "#000" }}>
                Transaction approved
              </span>
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: secondary, maxWidth: "255px" }}>
                <span style={{ color: "#000" }}>103.2064 SOL</span> successfully sent to <span style={{ color: "#000" }}>@alex</span>
              </span>
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 20px" }}>
          <button
            className="review-done-btn"
            onClick={onApprove}
            style={{ width: "100%", padding: "12px 16px", borderRadius: "9999px", background: "rgba(0, 0, 0, 0.04)", border: "none", cursor: "pointer", fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#000", textAlign: "center", transition: "background 0.15s ease" }}
            type="button"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .review-decline-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .review-approve-btn:hover {
          background: #222 !important;
        }
      `}</style>

      {/* Header */}
      <SubViewHeader onBack={onBack} onClose={onClose} title="Send Request" />

      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px", overflowY: "auto" }}>
        {/* Amount hero */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 12px 24px", width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", fontFamily: font, fontWeight: 600, whiteSpace: "nowrap" }}>
              <span style={{ fontSize: "40px", lineHeight: "48px", color: "#000" }}>103.2064</span>
              <span style={{ fontSize: "28px", lineHeight: "32px", color: "rgba(60, 60, 67, 0.4)", letterSpacing: "0.4px" }}>SOL</span>
            </div>
            <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: secondary }}>
              ≈$2,869.77
            </span>
          </div>
        </div>

        {/* Details card */}
        <div style={{ width: "100%" }}>
          <div style={{ background: "rgba(0, 0, 0, 0.04)", borderRadius: "16px", padding: "4px 0", display: "flex", flexDirection: "column" }}>
            {/* Status */}
            <div style={{ padding: "9px 12px" }}>
              <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary, display: "block" }}>
                Status
              </span>
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#000", display: "block", marginTop: "2px" }}>
                Pending approval
              </span>
            </div>

            {/* Recipient */}
            <div style={{ padding: "9px 12px" }}>
              <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary, display: "block" }}>
                Recipient
              </span>
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#000", display: "block", marginTop: "2px" }}>
                @alex
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom buttons */}
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", gap: "10px", width: "100%" }}>
          <button
            className="review-decline-btn"
            onClick={onDecline}
            style={{ flex: 1, padding: "12px 16px", borderRadius: "9999px", background: "rgba(249, 54, 60, 0.14)", border: "none", cursor: "pointer", fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#F9363C", textAlign: "center", transition: "background 0.15s ease" }}
            type="button"
          >
            Decline
          </button>
          <button
            className="review-approve-btn"
            onClick={() => setPhase("success")}
            style={{ flex: 1, padding: "12px 16px", borderRadius: "9999px", background: "#000", border: "none", cursor: "pointer", fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#fff", textAlign: "center", transition: "background 0.15s ease" }}
            type="button"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
