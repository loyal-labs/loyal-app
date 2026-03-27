import { Globe } from "lucide-react";

import { SubViewHeader } from "~/src/components/wallet/shared";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

function getTitle(kind: "connect" | "signTransaction" | "signMessage"): string {
  switch (kind) {
    case "connect":
      return "Connection request";
    case "signTransaction":
      return "Sign transaction";
    case "signMessage":
      return "Sign message";
  }
}

function getSubtitle(kind: "connect" | "signTransaction" | "signMessage"): string {
  switch (kind) {
    case "connect":
      return "wants to connect";
    case "signTransaction":
      return "wants you to sign a transaction";
    case "signMessage":
      return "wants you to sign a message";
  }
}

function getPermissionsText(kind: "connect" | "signTransaction" | "signMessage"): {
  label: string;
  value: string;
} {
  switch (kind) {
    case "connect":
      return {
        label: "Permissions",
        value: "This app requests access to view your wallet address and propose transactions for your approval.",
      };
    case "signTransaction":
      return {
        label: "Action",
        value: "This app is requesting your signature on a transaction. Review carefully before approving.",
      };
    case "signMessage":
      return {
        label: "Action",
        value: "This app is requesting your signature on a message. Review carefully before approving.",
      };
  }
}

function extractHostname(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function DappApprovalView({
  kind,
  origin,
  favicon,
  onDeny,
  onApprove,
  onClose,
}: {
  kind: "connect" | "signTransaction" | "signMessage";
  origin: string;
  favicon?: string;
  onDeny: () => void;
  onApprove: () => void;
  onClose: () => void;
}) {
  const title = getTitle(kind);
  const subtitle = getSubtitle(kind);
  const permissions = getPermissionsText(kind);
  const hostname = extractHostname(origin);
  const approveLabel = kind === "connect" ? "Connect" : "Sign";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style>{`
        .dapp-deny-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .dapp-approve-btn:hover {
          background: #222 !important;
        }
      `}</style>

      {/* Header */}
      <SubViewHeader onBack={onDeny} onClose={onClose} title={title} />

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
        {/* Hero area */}
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
          {/* Favicon */}
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={hostname}
              src={favicon}
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                marginBottom: "16px",
              }}
            />
          ) : (
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                background: "rgba(0, 0, 0, 0.04)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "16px",
              }}
            >
              <Globe size={24} style={{ color: secondary }} />
            </div>
          )}

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
              {hostname}
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
                Pending approval
              </span>
            </div>

            {/* Permissions / Action */}
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
                {permissions.label}
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
                {permissions.value}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom buttons */}
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", gap: "10px", width: "100%" }}>
          <button
            className="dapp-deny-btn"
            onClick={onDeny}
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
            Deny
          </button>
          <button
            className="dapp-approve-btn"
            onClick={onApprove}
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
            {approveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
