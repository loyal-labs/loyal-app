"use client";

import { SubViewHeader } from "./shared";

export type SpendingLimitDraft =
  | {
      kind: "set";
      id: string;
      signerAddress: string;
      signerLabel: string;
      accountIndex: number;
      amountUsd: number;
      existingSpendingLimitAddress: string | null;
      isPolicyScope: boolean;
    }
  | {
      kind: "delete";
      id: string;
      signerAddress: string;
      signerLabel: string;
      accountIndex: number;
      spendingLimitAddress: string;
      isPolicyScope: boolean;
    };

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

function shortAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function SpendingLimitPreviewContent({
  draft,
  isSubmitting,
  onBack,
  onCancel,
  onClose,
  onSubmit,
  showClose = false,
  actionError = null,
}: {
  draft: SpendingLimitDraft;
  isSubmitting: boolean;
  onBack: () => void;
  onCancel: () => void;
  onClose: () => void;
  onSubmit: () => void;
  showClose?: boolean;
  actionError?: string | null;
}) {
  const isDelete = draft.kind === "delete";
  const title = isDelete
    ? "Review delete spending limit"
    : "Review spending limit";
  const headline = isDelete
    ? "Remove spending limit"
    : formatUsd(draft.amountUsd);
  const subtitle = isDelete
    ? `From ${draft.signerLabel} · ${shortAddress(draft.signerAddress)}`
    : `Monthly limit for ${draft.signerLabel} · ${shortAddress(
        draft.signerAddress
      )}`;
  const policyWarning =
    isDelete && draft.isPolicyScope
      ? `This is the only authorization for ${draft.signerLabel}. Removing it will also remove the agent.`
      : null;
  const noticeText =
    isDelete
      ? "Submitting will request a wallet signature to remove this spending limit."
      : "Submitting will request a wallet signature to update the spending limit.";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .slimit-cancel-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .slimit-submit-btn:hover {
          background: #222 !important;
        }
        .slimit-submit-btn.destructive:hover {
          background: #c91d22 !important;
        }
      `}</style>

      <SubViewHeader
        onBack={onBack}
        onClose={onClose}
        showClose={showClose}
        title={title}
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
            <span
              style={{
                fontFamily: font,
                fontSize: isDelete ? "32px" : "40px",
                lineHeight: isDelete ? "36px" : "48px",
                fontWeight: 600,
                color: "#000",
              }}
            >
              {headline}
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
              {subtitle}
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
            <DetailRow
              label="Action"
              value={
                isDelete ? "Remove spending-limit policy" : "Update spending limit"
              }
            />
            <DetailRow label="Signer" value={draft.signerAddress} />
            {!isDelete && (
              <DetailRow label="New monthly limit" value={formatUsd(draft.amountUsd)} />
            )}
            <DetailRow
              label="Scope"
              value={draft.isPolicyScope ? "Agent policy" : "Root signer"}
            />
          </div>

          {policyWarning ? (
            <div
              style={{
                margin: "12px 0 0",
                padding: "12px",
                borderRadius: "12px",
                background: "rgba(249, 54, 60, 0.10)",
                color: "#9D1B1F",
                fontFamily: font,
                fontSize: "13px",
                lineHeight: "18px",
              }}
            >
              {policyWarning}
            </div>
          ) : null}

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
            className="slimit-cancel-btn"
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
            className={`slimit-submit-btn${isDelete ? " destructive" : ""}`}
            disabled={isSubmitting}
            onClick={onSubmit}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: "9999px",
              background: isDelete ? "#F9363C" : "#000",
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
            {isSubmitting
              ? "Submitting…"
              : isDelete
                ? "Remove limit"
                : "Submit Change"}
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
