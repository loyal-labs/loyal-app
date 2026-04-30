import { ChevronDown, ChevronUp, Globe } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { track } from "~/src/lib/analytics";

import { DAPP_EVENTS } from "./dapp-analytics";
import { SubViewHeader } from "~/src/components/wallet/shared";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";
const mono = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";

// ---------------------------------------------------------------------------
// Known program addresses
// ---------------------------------------------------------------------------

const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "System Program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "Token Program",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter v6",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca Whirlpool",
};

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function programName(address: string): string {
  return KNOWN_PROGRAMS[address] ?? truncateAddress(address);
}

// ---------------------------------------------------------------------------
// Transaction decoder
// ---------------------------------------------------------------------------

interface InstructionSummary {
  program: string;
  description: string;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function decodeTransaction(
  base64: string,
): Promise<InstructionSummary[]> {
  try {
    const { Transaction, VersionedTransaction, SystemProgram, SystemInstruction, LAMPORTS_PER_SOL, PublicKey } =
      await import("@solana/web3.js");

    const bytes = base64ToUint8Array(base64);
    const summaries: InstructionSummary[] = [];

    let instructions: { programId: { toBase58(): string }; keys?: { pubkey: { toBase58(): string } }[]; data?: Buffer | Uint8Array }[];

    try {
      const vtx = VersionedTransaction.deserialize(bytes);
      const lookup = vtx.message;
      const staticKeys = lookup.staticAccountKeys;
      instructions = lookup.compiledInstructions.map((ix) => ({
        programId: staticKeys[ix.programIdIndex],
        keys: ix.accountKeyIndexes.map((idx) => ({
          pubkey: staticKeys[idx] ?? new PublicKey(new Uint8Array(32)),
        })),
        data: Buffer.from(ix.data),
      }));
    } catch {
      const tx = Transaction.from(bytes);
      instructions = tx.instructions;
    }

    for (const ix of instructions) {
      const progAddr = ix.programId.toBase58();

      if (progAddr === SystemProgram.programId.toBase58()) {
        try {
          const decoded = SystemInstruction.decodeTransfer({
            programId: ix.programId,
            keys: (ix.keys ?? []).map((k) => ({
              pubkey: k.pubkey,
              isSigner: false,
              isWritable: true,
            })),
            data: ix.data ? Buffer.from(ix.data) : Buffer.alloc(0),
          } as never);
          const sol = Number(decoded.lamports) / LAMPORTS_PER_SOL;
          summaries.push({
            program: "System Program",
            description: `Transfer ${sol} SOL to ${truncateAddress(decoded.toPubkey.toBase58())}`,
          });
          continue;
        } catch {
          // Not a transfer — fall through
        }
      }

      const name = programName(progAddr);
      summaries.push({
        program: name,
        description: KNOWN_PROGRAMS[progAddr]
          ? `${name} instruction`
          : `Instruction to ${name}`,
      });
    }

    return summaries;
  } catch {
    return [{ program: "Unknown", description: "Failed to decode transaction" }];
  }
}

function decodeMessage(base64: string): string {
  try {
    const bytes = base64ToUint8Array(base64);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // If it's printable text, show it; otherwise fall back to hex
    if (/^[\x20-\x7E\n\r\t]+$/.test(text)) return text;
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
  } catch {
    const bytes = base64ToUint8Array(base64);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
  }
}

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
        value:
          "Review the transaction details below before approving.",
      };
    case "signMessage":
      return {
        label: "Action",
        value:
          "Review the message content below before signing.",
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
  const [summaries, setSummaries] = useState<InstructionSummary[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void decodeTransaction(base64).then(setSummaries);
  }, [base64]);

  if (!summaries) {
    return (
      <div style={{ padding: "9px 12px" }}>
        <span style={{ fontFamily: font, fontSize: "13px", color: secondary }}>
          Decoding transaction...
        </span>
      </div>
    );
  }

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
          Instructions ({summaries.length})
        </span>
        <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "6px" }}>
          {summaries.map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                padding: "8px 10px",
                background: "rgba(0, 0, 0, 0.04)",
                borderRadius: "10px",
              }}
            >
              <span style={{ fontFamily: font, fontSize: "12px", fontWeight: 500, color: secondary }}>
                {s.program}
              </span>
              <span style={{ fontFamily: font, fontSize: "14px", fontWeight: 400, lineHeight: "18px", color: "#000", wordBreak: "break-all" }}>
                {s.description}
              </span>
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
          Raw data {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
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
            <span style={{ fontFamily: mono, fontSize: "11px", lineHeight: "16px", color: secondary }}>
              {base64}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

function MessageDetails({ base64 }: { base64: string }) {
  const decoded = useMemo(() => decodeMessage(base64), [base64]);

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
        <span style={{ fontFamily: mono, fontSize: "13px", lineHeight: "18px", color: "#000" }}>
          {decoded}
        </span>
      </div>
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
