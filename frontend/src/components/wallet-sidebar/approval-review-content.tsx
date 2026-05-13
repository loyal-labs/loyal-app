"use client";

import type { SmartAccountApprovalItem } from "@/hooks/use-smart-account-sidebar-data";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import { SubViewHeader } from "./shared";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";
const mono = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";

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
  showClose = true,
  actionError = null,
}: {
  approval: SmartAccountApprovalItem | null;
  isSubmitting: boolean;
  onBack: () => void;
  onClose: () => void;
  onDecline: () => void;
  onApprove: () => void;
  onExecute: () => void;
  showClose?: boolean;
  actionError?: string | null;
}) {
  const [isRawDataExpanded, setIsRawDataExpanded] = useState(false);

  if (!approval) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <SubViewHeader
          onBack={onBack}
          onClose={onClose}
          showClose={showClose}
          title="Approval"
        />
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
  const decodedInstructions = approval.proposal.decodedInstructions ?? [];

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

      <SubViewHeader
        onBack={onBack}
        onClose={onClose}
        showClose={showClose}
        title="Approval"
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

            <ProposalInstructionDetails
              instructions={decodedInstructions}
              isRawDataExpanded={isRawDataExpanded}
              onToggleRawData={() =>
                setIsRawDataExpanded((currentValue) => !currentValue)
              }
            />
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

function ProposalInstructionDetails({
  instructions,
  isRawDataExpanded,
  onToggleRawData,
}: {
  instructions: SmartAccountApprovalItem["proposal"]["decodedInstructions"];
  isRawDataExpanded: boolean;
  onToggleRawData: () => void;
}) {
  if (instructions.length === 0) {
    return null;
  }

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
        Decoded instructions ({instructions.length})
      </span>
      <div
        style={{
          marginTop: "6px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        {instructions.map((instruction, index) => (
          <div
            key={`${instruction.programId}:${instruction.rawDataBase64}:${index}`}
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
            <InstructionMetadata
              accounts={instruction.accounts}
              details={instruction.details}
            />
          </div>
        ))}
      </div>

      <button
        onClick={onToggleRawData}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "8px 0 0",
          fontFamily: font,
          fontSize: "12px",
          fontWeight: 500,
          color: secondary,
        }}
        type="button"
      >
        Raw data{" "}
        {isRawDataExpanded ? (
          <ChevronUp size={14} />
        ) : (
          <ChevronDown size={14} />
        )}
      </button>

      {isRawDataExpanded ? (
        <div
          style={{
            marginTop: "4px",
            padding: "8px",
            background: "rgba(0, 0, 0, 0.04)",
            borderRadius: "8px",
            maxHeight: "160px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {instructions.map((instruction, index) => (
            <div
              key={`${instruction.programId}:raw:${index}`}
              style={{ display: "flex", flexDirection: "column", gap: "3px" }}
            >
              <span
                style={{
                  fontFamily: font,
                  fontSize: "11px",
                  fontWeight: 600,
                  lineHeight: "14px",
                  color: secondary,
                }}
              >
                #{index + 1} {instruction.instructionName}
              </span>
              <span
                style={{
                  fontFamily: mono,
                  fontSize: "11px",
                  lineHeight: "16px",
                  color: secondary,
                  wordBreak: "break-all",
                }}
              >
                {instruction.rawDataBase64 ||
                  instruction.rawDataHex ||
                  "(empty)"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InstructionMetadata({
  accounts,
  details,
}: {
  accounts: SmartAccountApprovalItem["proposal"]["decodedInstructions"][number]["accounts"];
  details: SmartAccountApprovalItem["proposal"]["decodedInstructions"][number]["details"];
}) {
  const visibleDetails = details.slice(0, 4);
  const visibleAccounts = accounts.slice(0, 4);

  if (visibleDetails.length === 0 && visibleAccounts.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      {visibleDetails.map((detail) => (
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
      {visibleAccounts.map((account, index) => (
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
