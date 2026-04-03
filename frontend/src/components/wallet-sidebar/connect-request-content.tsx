"use client";

import { X } from "lucide-react";
import { useState } from "react";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

export function ConnectRequestContent({
  agentName,
  onClose,
  onDecline,
  onApprove,
}: {
  agentName: string;
  onClose: () => void;
  onDecline: () => void;
  onApprove: () => void;
}) {
  const [phase, setPhase] = useState<"review" | "success">("review");

  if (phase === "success") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <style jsx>{`
          .connect-close-btn:hover { background: rgba(0, 0, 0, 0.08) !important; }
          .connect-done-btn:hover { background: rgba(0, 0, 0, 0.08) !important; }
          @keyframes mascotNod {
            0%, 100% { transform: rotate(0deg); }
            25% { transform: rotate(4deg); }
            75% { transform: rotate(-4deg); }
          }
        `}</style>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px" }}>
          <div style={{ flex: 1, paddingLeft: "12px", paddingTop: "4px", paddingBottom: "4px" }}>
            <span style={{ fontFamily: font, fontSize: "18px", fontWeight: 600, lineHeight: "28px", color: "#000" }}>
              Connection request
            </span>
          </div>
          <button
            className="connect-close-btn"
            onClick={() => { onApprove(); }}
            style={{ width: "36px", height: "36px", display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0, 0, 0, 0.04)", border: "none", borderRadius: "9999px", cursor: "pointer", transition: "all 0.2s ease", color: "#3C3C43" }}
            type="button"
          >
            <X size={24} />
          </button>
        </div>

        {/* Success content */}
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
                Connection approved
              </span>
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: secondary, maxWidth: "255px" }}>
                <span style={{ color: "#000" }}>{agentName}</span> has been connected to your wallet
              </span>
            </div>
          </div>
        </div>

        {/* Done button */}
        <div style={{ padding: "16px 20px" }}>
          <button
            className="connect-done-btn"
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
        .connect-decline-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .connect-approve-btn:hover {
          background: #222 !important;
        }
        .connect-close-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px",
        }}
      >
        <div style={{ width: "36px" }} />
        <span
          style={{
            fontFamily: font,
            fontSize: "18px",
            fontWeight: 600,
            lineHeight: "28px",
            color: "#000",
          }}
        >
          Connection request
        </span>
        <button
          className="connect-close-btn"
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

      {/* Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "8px",
          overflowY: "auto",
        }}
      >
        {/* Agent label */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px 12px 24px",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              width: "100%",
            }}
          >
            <span
              style={{
                fontFamily: font,
                fontSize: "40px",
                fontWeight: 600,
                lineHeight: "48px",
                color: "#000",
              }}
            >
              {agentName}
            </span>
            <span
              style={{
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: secondary,
              }}
            >
              Agent wants to connect
            </span>
          </div>
        </div>

        {/* Details card */}
        <div style={{ width: "100%" }}>
          <div
            style={{
              background: "rgba(0, 0, 0, 0.04)",
              borderRadius: "16px",
              padding: "4px 0",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Status */}
            <div style={{ padding: "9px 12px" }}>
              <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary, display: "block" }}>
                Status
              </span>
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#000", display: "block", marginTop: "2px" }}>
                Pending approval
              </span>
            </div>

            {/* Additional information */}
            <div style={{ padding: "9px 12px" }}>
              <span style={{ fontFamily: font, fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: secondary, display: "block" }}>
                Additional information
              </span>
              <span style={{ fontFamily: font, fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#000", display: "block", marginTop: "2px" }}>
                This agent requests access to view your wallet address and
                propose transactions for your approval.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom buttons */}
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", gap: "10px", width: "100%" }}>
          <button
            className="connect-decline-btn"
            onClick={onDecline}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: "9999px",
              background: "rgba(249, 54, 60, 0.14)",
              border: "none",
              cursor: "pointer",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "#F9363C",
              textAlign: "center",
              transition: "background 0.15s ease",
            }}
            type="button"
          >
            Decline
          </button>
          <button
            className="connect-approve-btn"
            onClick={() => setPhase("success")}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: "9999px",
              background: "#000",
              border: "none",
              cursor: "pointer",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "#fff",
              textAlign: "center",
              transition: "background 0.15s ease",
            }}
            type="button"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
