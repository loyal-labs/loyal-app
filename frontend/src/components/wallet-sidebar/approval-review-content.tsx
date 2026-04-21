"use client";

import type { SmartAccountApprovalItem } from "@/hooks/use-smart-account-sidebar-data";

import { SubViewHeader } from "./shared";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

function toStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function ApprovalReviewContent({
  approval,
  isSubmitting,
  onBack,
  onClose,
  onDecline,
  onApprove,
  onExecute,
}: {
  approval: SmartAccountApprovalItem | null;
  isSubmitting: boolean;
  onBack: () => void;
  onClose: () => void;
  onDecline: () => void;
  onApprove: () => void;
  onExecute: () => void;
}) {
  if (!approval) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <SubViewHeader onBack={onBack} onClose={onClose} title="Approval" />
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            textAlign: "center",
            fontFamily: font,
            fontSize: "14px",
            color: secondary,
          }}
        >
          Select a proposal to review.
        </div>
      </div>
    );
  }

  const canVote = approval.status === "active";
  const canExecute = approval.status === "approved" && approval.canExecute;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .review-decline-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .review-primary-btn:hover {
          background: #222 !important;
        }
      `}</style>

      <SubViewHeader onBack={onBack} onClose={onClose} title="Approval" />

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
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
                fontFamily: font,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{ fontSize: "40px", lineHeight: "48px", color: "#000" }}
              >
                {approval.amount}
              </span>
              <span
                style={{
                  fontSize: "28px",
                  lineHeight: "32px",
                  color: "rgba(60, 60, 67, 0.4)",
                  letterSpacing: "0.4px",
                }}
              >
                {approval.symbol}
              </span>
            </div>
            <span
              style={{
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: secondary,
              }}
            >
              {approval.title} to {approval.destinationLabel}
            </span>
          </div>
        </div>

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
            <div style={{ padding: "9px 12px" }}>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  color: secondary,
                  display: "block",
                }}
              >
                Status
              </span>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: "#000",
                  display: "block",
                  marginTop: "2px",
                }}
              >
                {toStatusLabel(approval.status)}
              </span>
            </div>

            <div style={{ padding: "9px 12px" }}>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  color: secondary,
                  display: "block",
                }}
              >
                Destination
              </span>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: "#000",
                  display: "block",
                  marginTop: "2px",
                }}
              >
                {approval.destinationLabel}
              </span>
            </div>

            <div style={{ padding: "9px 12px" }}>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  color: secondary,
                  display: "block",
                }}
              >
                Source
              </span>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: "#000",
                  display: "block",
                  marginTop: "2px",
                }}
              >
                {approval.sourceLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 20px" }}>
        {canVote ? (
          <div style={{ display: "flex", gap: "10px", width: "100%" }}>
            <button
              className="review-decline-btn"
              disabled={isSubmitting}
              onClick={onDecline}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: "9999px",
                background: "rgba(249, 54, 60, 0.14)",
                border: "none",
                cursor: isSubmitting ? "default" : "pointer",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#F9363C",
                textAlign: "center",
                transition: "background 0.15s ease",
                opacity: isSubmitting ? 0.6 : 1,
              }}
              type="button"
            >
              Reject
            </button>
            <button
              className="review-primary-btn"
              disabled={isSubmitting}
              onClick={onApprove}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: "9999px",
                background: "#000",
                border: "none",
                cursor: isSubmitting ? "default" : "pointer",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#fff",
                textAlign: "center",
                transition: "background 0.15s ease",
                opacity: isSubmitting ? 0.6 : 1,
              }}
              type="button"
            >
              Approve
            </button>
          </div>
        ) : canExecute ? (
          <button
            className="review-primary-btn"
            disabled={isSubmitting}
            onClick={onExecute}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: "9999px",
              background: "#000",
              border: "none",
              cursor: isSubmitting ? "default" : "pointer",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "#fff",
              textAlign: "center",
              transition: "background 0.15s ease",
              opacity: isSubmitting ? 0.6 : 1,
            }}
            type="button"
          >
            Execute
          </button>
        ) : (
          <button
            disabled
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: "9999px",
              background: "rgba(0, 0, 0, 0.04)",
              border: "none",
              cursor: "default",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: secondary,
              textAlign: "center",
            }}
            type="button"
          >
            No action available
          </button>
        )}
      </div>
    </div>
  );
}
