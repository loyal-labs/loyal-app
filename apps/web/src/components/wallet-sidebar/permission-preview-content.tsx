"use client";

import type { SmartAccountSignerPermission } from "@loyal-labs/smart-account-vaults";

import { type AccessLevel, ACCESS_DISPLAY } from "./agent-page-view";
import { SubViewHeader } from "./shared";

export type PermissionChangeDraft = {
  id: string;
  signerAddress: string;
  signerLabel: string;
  previousLevel: AccessLevel;
  nextLevel: AccessLevel;
  policyAddress: string | null;
  accountIndex: number | undefined;
  permissions: SmartAccountSignerPermission[];
};

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

function shortAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function PermissionPreviewContent({
  draft,
  isSubmitting,
  onBack,
  onCancel,
  onClose,
  onSubmit,
  showClose = false,
  actionError = null,
}: {
  draft: PermissionChangeDraft;
  isSubmitting: boolean;
  onBack: () => void;
  onCancel: () => void;
  onClose: () => void;
  onSubmit: () => void;
  showClose?: boolean;
  actionError?: string | null;
}) {
  const noticeText =
    "Submitting will request a wallet signature to update this signer's permissions.";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        .perm-cancel-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .perm-submit-btn:hover {
          background: #222 !important;
        }
      `}</style>

      <SubViewHeader
        onBack={onBack}
        onClose={onClose}
        showClose={showClose}
        title="Review permission change"
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
                gap: "10px",
                fontFamily: font,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{ fontSize: "28px", lineHeight: "32px", color: secondary }}
              >
                {ACCESS_DISPLAY[draft.previousLevel]}
              </span>
              <span
                style={{ fontSize: "24px", lineHeight: "28px", color: secondary }}
              >
                →
              </span>
              <span
                style={{ fontSize: "32px", lineHeight: "36px", color: "#000" }}
              >
                {ACCESS_DISPLAY[draft.nextLevel]}
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
              For {draft.signerLabel} · {shortAddress(draft.signerAddress)}
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
            <DetailRow label="Action" value="Update signer permissions" />
            <DetailRow label="Signer" value={draft.signerAddress} />
            <DetailRow
              label="Scope"
              value={draft.policyAddress ? "Policy signer" : "Root signer"}
            />
            <DetailRow
              label="New access level"
              value={ACCESS_DISPLAY[draft.nextLevel]}
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
            className="perm-cancel-btn"
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
            className="perm-submit-btn"
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
            {isSubmitting ? "Submitting…" : "Submit Change"}
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
