import {
  decodeMessagePayload,
  decodeSolanaTransaction,
  type DecodedSolanaInstruction,
} from "@loyal-labs/solana-instruction-decoder";
import { ChevronDown, ChevronUp, Globe } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { SubViewHeader } from "~/src/components/wallet/shared";
import { track } from "~/src/lib/analytics";

import { DAPP_EVENTS } from "./dapp-analytics";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";
const mono = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

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

function getSubtitle(
  kind: "connect" | "signTransaction" | "signMessage"
): string {
  switch (kind) {
    case "connect":
      return "wants to connect";
    case "signTransaction":
      return "wants you to sign a transaction";
    case "signMessage":
      return "wants you to sign a message";
  }
}

function getPermissionsText(
  kind: "connect" | "signTransaction" | "signMessage"
): {
  label: string;
  value: string;
} {
  switch (kind) {
    case "connect":
      return {
        label: "Permissions",
        value:
          "This app requests access to view your wallet address and propose transactions for your approval.",
      };
    case "signTransaction":
      return {
        label: "Action",
        value: "Review the transaction details below before approving.",
      };
    case "signMessage":
      return {
        label: "Action",
        value: "Review the message content below before signing.",
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

// ---------------------------------------------------------------------------
// Transaction details component
// ---------------------------------------------------------------------------

function TransactionDetails({ base64 }: { base64: string }) {
  const decoded = useMemo(() => decodeSolanaTransaction(base64), [base64]);
  const [expanded, setExpanded] = useState(false);
  const instructions = decoded.instructions;

  return (
    <>
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
          Instructions ({instructions.length})
        </span>
        {decoded.error ? (
          <span
            style={{
              fontFamily: font,
              fontSize: "14px",
              fontWeight: 400,
              lineHeight: "18px",
              color: "#000",
              display: "block",
              marginTop: "6px",
            }}
          >
            {decoded.error}
          </span>
        ) : null}
        <div
          style={{
            marginTop: "6px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {instructions.map((instruction, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
                padding: "8px 10px",
                background: "rgba(0, 0, 0, 0.04)",
                borderRadius: "10px",
              }}
            >
              <span
                style={{
                  fontFamily: font,
                  fontSize: "12px",
                  fontWeight: 500,
                  color: secondary,
                }}
              >
                {instruction.programName}
              </span>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "14px",
                  fontWeight: 600,
                  lineHeight: "18px",
                  color: "#000",
                  wordBreak: "break-word",
                }}
              >
                {instruction.title}
              </span>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "18px",
                  color: "#000",
                  wordBreak: "break-word",
                }}
              >
                {instruction.description}
              </span>
              <InstructionMetadata instruction={instruction} />
            </div>
          ))}
        </div>
      </div>

      {/* Collapsible raw data */}
      <div style={{ padding: "4px 12px 9px" }}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 0",
            fontFamily: font,
            fontSize: "12px",
            fontWeight: 500,
            color: secondary,
          }}
        >
          Raw data{" "}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {expanded && (
          <div
            style={{
              marginTop: "4px",
              padding: "8px",
              background: "rgba(0, 0, 0, 0.04)",
              borderRadius: "8px",
              maxHeight: "120px",
              overflowY: "auto",
              wordBreak: "break-all",
            }}
          >
            <span
              style={{
                fontFamily: mono,
                fontSize: "11px",
                lineHeight: "16px",
                color: secondary,
              }}
            >
              {base64}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

function MessageDetails({ base64 }: { base64: string }) {
  const decoded = useMemo(() => decodeMessagePayload(base64), [base64]);

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
        Message content
      </span>
      <div
        style={{
          marginTop: "6px",
          padding: "8px 10px",
          background: "rgba(0, 0, 0, 0.04)",
          borderRadius: "10px",
          maxHeight: "160px",
          overflowY: "auto",
          wordBreak: "break-all",
          whiteSpace: "pre-wrap",
        }}
      >
        <span
          style={{
            fontFamily: mono,
            fontSize: "13px",
            lineHeight: "18px",
            color: "#000",
          }}
        >
          {decoded.value}
        </span>
      </div>
    </div>
  );
}

function InstructionMetadata({
  instruction,
}: {
  instruction: DecodedSolanaInstruction;
}) {
  const details = instruction.details.slice(0, 4);
  const accounts = instruction.accounts.slice(0, 4);

  if (details.length === 0 && accounts.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      {details.map((detail) => (
        <span
          key={`${detail.label}:${detail.value}`}
          style={{
            fontFamily: font,
            fontSize: "12px",
            fontWeight: 400,
            lineHeight: "16px",
            color: secondary,
            wordBreak: "break-word",
          }}
        >
          {detail.label}: {detail.value}
        </span>
      ))}
      {accounts.map((account, index) => (
        <span
          key={`${account.address}:${index}`}
          style={{
            fontFamily: mono,
            fontSize: "11px",
            fontWeight: 400,
            lineHeight: "15px",
            color: secondary,
            wordBreak: "break-all",
          }}
        >
          {account.label ?? `Account ${index + 1}`}: {account.address}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DappApprovalView({
  kind,
  origin,
  favicon,
  transactionBase64,
  messageBase64,
  onDeny,
  onApprove,
  onClose,
}: {
  kind: "connect" | "signTransaction" | "signMessage";
  origin: string;
  favicon?: string;
  transactionBase64?: string;
  messageBase64?: string;
  onDeny: () => void;
  onApprove: () => void;
  onClose: () => void;
}) {
  const title = getTitle(kind);
  const subtitle = getSubtitle(kind);
  const permissions = getPermissionsText(kind);
  const hostname = extractHostname(origin);
  const approveLabel = kind === "connect" ? "Connect" : "Sign";

  useEffect(() => {
    const event =
      kind === "connect"
        ? DAPP_EVENTS.connectRequested
        : DAPP_EVENTS.signRequested;
    track(event, { origin, kind });
  }, [kind, origin]);

  const handleDeny = () => {
    const denyEvent =
      kind === "connect" ? DAPP_EVENTS.connectDenied : DAPP_EVENTS.signDenied;
    track(denyEvent, { origin, kind });
    onDeny();
  };

  const handleApprove = () => {
    const approveEvent =
      kind === "connect"
        ? DAPP_EVENTS.connectApproved
        : DAPP_EVENTS.signApproved;
    track(approveEvent, { origin, kind });
    onApprove();
  };

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
      <SubViewHeader onBack={handleDeny} onClose={onClose} title={title} />

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

            {/* Transaction details */}
            {kind === "signTransaction" && transactionBase64 && (
              <TransactionDetails base64={transactionBase64} />
            )}

            {/* Message details */}
            {kind === "signMessage" && messageBase64 && (
              <MessageDetails base64={messageBase64} />
            )}
          </div>
        </div>
      </div>

      {/* Bottom buttons */}
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", gap: "10px", width: "100%" }}>
          <button
            className="dapp-deny-btn"
            onClick={handleDeny}
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
            onClick={handleApprove}
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
