"use client";

import type { VaultTransferRequest } from "@/hooks/use-smart-account-sidebar-data";

import { SubViewHeader } from "./shared";

export type DraftProposalView = {
  id: string;
  request: VaultTransferRequest;
  amountDisplay: string;
  symbol: string;
  recipientAddress: string;
  destinationLabel: string;
  sourceAccountIndex: number;
  sourceLabel: string;
  threshold: number;
  expectedSigns: number;
};

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

export function DraftPreviewContent({
  draft,
  isSubmitting,
  onBack,
  onCancel,
  onClose,
  onSubmit,
  showClose = true,
  actionError = null,
}: {
  draft: DraftProposalView;
  isSubmitting: boolean;
  onBack: () => void;
  onCancel: () => void;
  onClose: () => void;
  onSubmit: () => void;
  showClose?: boolean;
  actionError?: string | null;
}) {
  const requiresMoreSigners = draft.threshold > 1;
  const noticeText = requiresMoreSigners
    ? `${draft.threshold} approvals required before funds move. Submitting will queue the proposal on chain.`
    : "Submitting requires 3 wallet signs (propose, approve, execute) and will move funds.";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .draft-cancel-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .draft-submit-btn:hover {
          background: #222 !important;
        }
      `}</style>

      <SubViewHeader
        onBack={onBack}
        onClose={onClose}
        showClose={showClose}
        title="Review draft"
      />

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
                {draft.amountDisplay}
              </span>
              <span
                style={{
                  fontSize: "28px",
                  lineHeight: "32px",
                  color: "rgba(60, 60, 67, 0.4)",
                  letterSpacing: "0.4px",
                }}
              >
                {draft.symbol}
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
              Send to {draft.destinationLabel}
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
            <DetailRow label="Status" value="Draft" />
            <DetailRow label="Destination" value={draft.recipientAddress} />
            <DetailRow label="Source" value={draft.sourceLabel} />
            <DetailRow
              label="Approvals required"
              value={`${draft.threshold} signer${
                draft.threshold === 1 ? "" : "s"
              }`}
            />
            <DetailRow
              label="Wallet signs needed"
              value={`${draft.expectedSigns}`}
            />
          </div>

          <div
            style={{
              padding: "12px 12px 0",
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "18px",
              color: secondary,
            }}
          >
            {noticeText}
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 20px" }}>
        {actionError ? (
          <div
            style={{
              marginBottom: "8px",
              padding: "10px 12px",
              borderRadius: "8px",
              background: "rgba(249, 54, 60, 0.10)",
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "18px",
              color: "#9D1B1F",
            }}
          >
            {actionError}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: "10px", width: "100%" }}>
          <button
            className="draft-cancel-btn"
            disabled={isSubmitting}
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: "9999px",
              background: "rgba(0, 0, 0, 0.04)",
              border: "none",
              cursor: isSubmitting ? "default" : "pointer",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "#000",
              textAlign: "center",
              transition: "background 0.15s ease",
              opacity: isSubmitting ? 0.6 : 1,
            }}
            type="button"
          >
            Cancel
          </button>
          <button
            className="draft-submit-btn"
            disabled={isSubmitting}
            onClick={onSubmit}
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
            {isSubmitting ? "Submitting…" : "Submit Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
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
        {label}
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
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}
