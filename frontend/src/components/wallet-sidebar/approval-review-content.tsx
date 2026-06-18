"use client";

import { DogWithMood } from "@/components/chat-input";
import type { SmartAccountApprovalItem } from "@/hooks/use-smart-account-sidebar-data";
import { ChevronDown, ChevronUp } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { useEffect, useState } from "react";

import { SubViewHeader } from "./shared";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";
const mono = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";

export type ApprovalReviewDisplayRow = {
  label: string;
  value: string;
};

export type ApprovalReviewDisplaySection = {
  rows: ApprovalReviewDisplayRow[];
  title: string;
};

export type ApprovalReviewCollapsible = {
  rows: ApprovalReviewDisplayRow[];
  title: string;
};

export type ApprovalReviewPage = {
  amount?: string;
  collapsibles?: ApprovalReviewCollapsible[];
  heading: string;
  hideAmountHeading?: boolean;
  mascotNote?: string;
  rows?: ApprovalReviewDisplayRow[];
  subheading?: string;
  symbol?: string;
  title: string;
};

export type ApprovalReviewDisplayItem = {
  actionMode?: "execute" | "none" | "vote";
  amount: string;
  destinationLabel: string;
  disabledActionLabel?: string;
  pages?: ApprovalReviewPage[];
  primaryActionLabel?: string;
  proposal?: Pick<SmartAccountApprovalItem["proposal"], "decodedInstructions">;
  reviewRows?: ApprovalReviewDisplayRow[];
  reviewSections?: ApprovalReviewDisplaySection[];
  secondaryActionLabel?: string;
  sourceLabel: string;
  status: string;
  statusLabel?: string;
  summaryLabel?: string;
  symbol: string;
  title: string;
};

function toStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function ButtonSpinner() {
  return (
    <span aria-hidden="true" className="review-btn-spinner">
      <style jsx>{`
        .review-btn-spinner {
          display: inline-block;
          width: 18px;
          height: 18px;
          vertical-align: middle;
          border-radius: 9999px;
          border: 2px solid rgba(255, 255, 255, 0.35);
          border-top-color: #fff;
          animation: review-btn-spinner-rotate 0.6s linear infinite;
        }
        @keyframes review-btn-spinner-rotate {
          to {
            transform: rotate(360deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .review-btn-spinner {
            animation-duration: 1.1s;
          }
        }
      `}</style>
    </span>
  );
}

export function ApprovalReviewContent({
  approval,
  isSubmitting,
  onBack,
  onClose,
  onDecline,
  onApprove,
  onExecute,
  showBack = true,
  showClose = true,
  actionError = null,
}: {
  approval: ApprovalReviewDisplayItem | SmartAccountApprovalItem | null;
  isSubmitting: boolean;
  onBack: () => void;
  onClose: () => void;
  onDecline: () => void;
  onApprove: () => void;
  onExecute: () => void;
  showBack?: boolean;
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
          showBack={showBack}
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

  const pages = "pages" in approval ? approval.pages : undefined;
  if (pages && pages.length > 0) {
    const pagedSecondary =
      "secondaryActionLabel" in approval && approval.secondaryActionLabel
        ? approval.secondaryActionLabel
        : "Cancel";
    const pagedPrimary =
      "primaryActionLabel" in approval && approval.primaryActionLabel
        ? approval.primaryActionLabel
        : "Continue";
    return (
      <PagedApprovalReview
        actionError={actionError}
        isSubmitting={isSubmitting}
        onApprove={onApprove}
        onBack={onBack}
        onClose={onClose}
        onDecline={onDecline}
        pages={pages}
        primaryActionLabel={pagedPrimary}
        secondaryActionLabel={pagedSecondary}
        showBack={showBack}
        showClose={showClose}
      />
    );
  }

  const actionMode = "actionMode" in approval ? approval.actionMode : undefined;
  const canVote =
    actionMode === "vote" ||
    (actionMode === undefined && approval.status === "active");
  const canExecute =
    actionMode === "execute" ||
    (actionMode === undefined &&
      approval.status === "approved" &&
      "canExecute" in approval &&
      approval.canExecute);
  const decodedInstructions = approval.proposal?.decodedInstructions ?? [];
  const statusLabel =
    "statusLabel" in approval && approval.statusLabel
      ? approval.statusLabel
      : toStatusLabel(approval.status);
  const secondaryActionLabel =
    "secondaryActionLabel" in approval && approval.secondaryActionLabel
      ? approval.secondaryActionLabel
      : "Reject";
  const primaryActionLabel =
    "primaryActionLabel" in approval && approval.primaryActionLabel
      ? approval.primaryActionLabel
      : canExecute
      ? "Execute"
      : "Approve";
  const disabledActionLabel =
    "disabledActionLabel" in approval && approval.disabledActionLabel
      ? approval.disabledActionLabel
      : "No action available";
  const reviewRows = "reviewRows" in approval ? approval.reviewRows : undefined;
  const reviewSections =
    "reviewSections" in approval ? approval.reviewSections : undefined;
  const summaryLabel =
    "summaryLabel" in approval && approval.summaryLabel
      ? approval.summaryLabel
      : `${approval.title} to ${approval.destinationLabel}`;

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
        showBack={showBack}
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
              {summaryLabel}
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
                {statusLabel}
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

            {reviewRows?.map((row) => (
              <div key={row.label} style={{ padding: "9px 12px" }}>
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
                  {row.label}
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
                    wordBreak: "break-word",
                  }}
                >
                  {row.value}
                </span>
              </div>
            ))}

            {reviewSections?.map((section) => (
              <div key={section.title} style={{ padding: "11px 12px" }}>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 600,
                    lineHeight: "16px",
                    color: "#000",
                    display: "block",
                    marginBottom: "8px",
                  }}
                >
                  {section.title}
                </span>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  {section.rows.map((row) => (
                    <div key={row.label}>
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
                        {row.label}
                      </span>
                      <span
                        style={{
                          fontFamily: row.value.length > 44 ? mono : font,
                          fontSize: row.value.length > 44 ? "13px" : "16px",
                          fontWeight: 400,
                          lineHeight: row.value.length > 44 ? "18px" : "20px",
                          color: "#000",
                          display: "block",
                          marginTop: "2px",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

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
              {secondaryActionLabel}
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
                opacity: 1,
              }}
              type="button"
            >
              {isSubmitting ? <ButtonSpinner /> : primaryActionLabel}
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
              opacity: 1,
            }}
            type="button"
          >
            {isSubmitting ? <ButtonSpinner /> : primaryActionLabel}
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
            {disabledActionLabel}
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

function isAddressLikeValue(value: string): boolean {
  return value.length > 24 && !value.includes(" ");
}

function ReviewKeyValue({ row }: { row: ApprovalReviewDisplayRow }) {
  const isAddressLike = isAddressLikeValue(row.value);
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
        {row.label}
      </span>
      <span
        style={{
          fontFamily: isAddressLike ? mono : font,
          fontSize: isAddressLike ? "13px" : "16px",
          fontWeight: 400,
          lineHeight: isAddressLike ? "18px" : "20px",
          color: "#000",
          display: "block",
          marginTop: "2px",
          overflowWrap: "anywhere",
        }}
      >
        {row.value}
      </span>
    </div>
  );
}

function ReviewKeyValueCompact({ row }: { row: ApprovalReviewDisplayRow }) {
  const isAddressLike = isAddressLikeValue(row.value);
  return (
    <div>
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
        {row.label}
      </span>
      <span
        style={{
          fontFamily: isAddressLike ? mono : font,
          fontSize: isAddressLike ? "13px" : "16px",
          fontWeight: 400,
          lineHeight: isAddressLike ? "18px" : "20px",
          color: "#000",
          display: "block",
          marginTop: "2px",
          overflowWrap: "anywhere",
        }}
      >
        {row.value}
      </span>
    </div>
  );
}

function CollapsibleRows({
  collapsible,
}: {
  collapsible: ApprovalReviewCollapsible;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.04)",
        borderRadius: "16px",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setIsOpen((current) => !current)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "13px 12px",
          fontFamily: font,
          fontSize: "14px",
          fontWeight: 500,
          color: "#000",
          textAlign: "left",
        }}
        type="button"
      >
        <span>{collapsible.title}</span>
        {isOpen ? (
          <ChevronUp color={secondary} size={16} />
        ) : (
          <ChevronDown color={secondary} size={16} />
        )}
      </button>
      {isOpen ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "0 12px 12px",
          }}
        >
          {collapsible.rows.map((row) => (
            <ReviewKeyValueCompact key={row.label} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Only the "exit" state is defined: entrance is handled by the CSS keyframes
// below, while "exit" is propagated down from the review pane overlay in the
// wallet workspace, whose slide-out waits for this fade ("afterChildren") so
// the dog disappears before the pane moves.
const mascotNoteVariants: Variants = {
  exit: { opacity: 0, transition: { duration: 0.16, ease: "easeOut" } },
};

function ApprovalMascotNote({ text }: { text: string }) {
  const [visibleLength, setVisibleLength] = useState(0);
  const visibleText = text.slice(0, visibleLength);
  const isComplete = visibleLength >= text.length;

  useEffect(() => {
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setVisibleLength(text.length);
      return;
    }

    setVisibleLength(0);

    let index = 0;
    let intervalId: number | null = null;
    const startTimeoutId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        index = Math.min(text.length, index + 1);
        setVisibleLength(index);

        if (index >= text.length && intervalId !== null) {
          window.clearInterval(intervalId);
        }
      }, 30);
    }, 240);

    return () => {
      window.clearTimeout(startTimeoutId);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [text]);

  return (
    // The motion wrapper only carries the propagated exit fade. It must stay
    // unstyled: styled-jsx scopes classes to plain DOM elements only, so the
    // styled note root has to remain a regular div.
    <motion.div variants={mascotNoteVariants}>
      <div className="approval-mascot-note">
        <style jsx>{`
          .approval-mascot-note {
            display: flex;
            flex-direction: column;
            width: 100%;
            align-items: flex-end;
            justify-content: flex-end;
            gap: 8px;
            padding: 4px 20px 12px;
          }
          /* On wide layouts the review pane sits in the grid with the scrim to
           its left, so the mascot floats outside the pane's left edge,
           aligned with the pane title. Below 1024px the pane becomes a fixed
           overlay with no room to the left and the mascot keeps its in-pane
           spot above the buttons. */
          @media (min-width: 1025px) {
            .approval-mascot-note {
              position: absolute;
              top: 66%;
              right: 100%;
              width: max-content;
              margin-right: clamp(32px, 8vw, 120px);
              padding: 0;
              align-items: flex-end;
              transform: translateY(-50%);
            }
            .approval-mascot-bubble::before {
              bottom: -6px;
            }
          }
          .approval-mascot-bubble {
            position: relative;
            max-width: 300px;
            padding: 12px 16px;
            border: 1px solid rgba(0, 0, 0, 0.08);
            border-radius: 18px;
            background: #fff;
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08),
              0 2px 6px rgba(0, 0, 0, 0.04);
            color: rgba(0, 0, 0, 0.86);
            font-family: var(--font-geist-sans), sans-serif;
            font-size: 15px;
            font-weight: 500;
            line-height: 21px;
            transform-origin: 100% 50%;
            animation: approval-mascot-bubble-unravel 0.62s
              cubic-bezier(0.16, 1, 0.3, 1) 0.14s both;
          }
          .approval-mascot-bubble-content {
            display: block;
            position: relative;
          }
          .approval-mascot-bubble-measure {
            display: block;
            visibility: hidden;
          }
          .approval-mascot-bubble-stream {
            position: absolute;
            inset: 0;
            display: block;
            white-space: normal;
          }
          .approval-mascot-bubble-cursor {
            display: inline-block;
            width: 2px;
            height: 1em;
            margin-left: 2px;
            border-radius: 9999px;
            background: currentColor;
            transform: translateY(2px);
            animation: approval-mascot-stream-cursor 0.8s step-end infinite;
          }
          .approval-mascot-bubble-cursor[data-complete="true"] {
            animation: none;
            opacity: 0;
          }
          .approval-mascot-bubble::before {
            content: "";
            position: absolute;
            right: 34px;
            bottom: -6px;
            width: 11px;
            height: 11px;
            background: #fff;
            border-bottom: 1px solid rgba(0, 0, 0, 0.08);
            border-right: 1px solid rgba(0, 0, 0, 0.08);
            transform: rotate(45deg);
            animation: approval-mascot-bubble-tail 0.62s
              cubic-bezier(0.16, 1, 0.3, 1) 0.14s both;
          }
          .approval-mascot-dog {
            flex-shrink: 0;
            width: 88px;
            height: 70px;
            animation: approval-mascot-dog-slide-in 0.5s
              cubic-bezier(0.16, 1, 0.3, 1) both;
          }
          .approval-mascot-dog :global(svg) {
            display: block;
            width: 100%;
            height: 100%;
          }
          @keyframes approval-mascot-bubble-unravel {
            from {
              opacity: 0;
              transform: translateX(4px) scaleX(0.08);
            }
            to {
              opacity: 1;
              transform: translateX(0) scaleX(1);
            }
          }
          @keyframes approval-mascot-bubble-tail {
            from {
              opacity: 0;
              transform: translateY(-3px) rotate(45deg) scale(0.3);
            }
            to {
              opacity: 1;
              transform: translateY(0) rotate(45deg) scale(1);
            }
          }
          @keyframes approval-mascot-dog-slide-in {
            from {
              opacity: 0;
              transform: translateX(28px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
          @keyframes approval-mascot-stream-cursor {
            0%,
            48% {
              opacity: 1;
            }
            49%,
            100% {
              opacity: 0;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .approval-mascot-bubble,
            .approval-mascot-bubble::before,
            .approval-mascot-bubble-cursor,
            .approval-mascot-dog {
              animation: none;
            }
          }
        `}</style>
        <div className="approval-mascot-bubble" key={text}>
          <span aria-label={text} className="approval-mascot-bubble-content">
            <span aria-hidden="true" className="approval-mascot-bubble-measure">
              {text}
            </span>
            <span aria-hidden="true" className="approval-mascot-bubble-stream">
              {visibleText}
              <span
                className="approval-mascot-bubble-cursor"
                data-complete={isComplete}
              />
            </span>
          </span>
        </div>
        <div className="approval-mascot-dog">
          <DogWithMood />
        </div>
      </div>
    </motion.div>
  );
}

function PagedApprovalReview({
  actionError,
  isSubmitting,
  onApprove,
  onBack,
  onClose,
  onDecline,
  pages,
  primaryActionLabel,
  secondaryActionLabel,
  showBack,
  showClose,
}: {
  actionError: string | null;
  isSubmitting: boolean;
  onApprove: () => void;
  onBack: () => void;
  onClose: () => void;
  onDecline: () => void;
  pages: ApprovalReviewPage[];
  primaryActionLabel: string;
  secondaryActionLabel: string;
  showBack: boolean;
  showClose: boolean;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const safeIndex = Math.min(pageIndex, pages.length - 1);
  const page = pages[safeIndex];
  const isFirst = safeIndex === 0;
  const isLast = safeIndex === pages.length - 1;

  const goBack = () => {
    if (isFirst) {
      onBack();
      return;
    }
    setPageIndex((current) => Math.max(0, current - 1));
  };

  const handleSecondary = () => {
    if (isFirst) {
      onDecline();
      return;
    }
    setPageIndex((current) => Math.max(0, current - 1));
  };

  const handlePrimary = () => {
    if (isLast) {
      onApprove();
      return;
    }
    setPageIndex((current) => Math.min(pages.length - 1, current + 1));
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        // Anchors the mascot note when it floats outside the pane edge.
        position: "relative",
      }}
    >
      <style jsx>{`
        .review-decline-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .review-back-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .review-primary-btn:hover {
          background: #222 !important;
        }
      `}</style>

      <SubViewHeader
        onBack={goBack}
        onClose={onClose}
        showBack={showBack}
        showClose={showClose}
        title={page.title}
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
            gap: "4px",
            padding: "32px 12px 24px",
            width: "100%",
          }}
        >
          {page.amount ? (
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
                {page.amount}
              </span>
              {page.symbol ? (
                <span
                  style={{
                    fontSize: "28px",
                    lineHeight: "32px",
                    color: "rgba(60, 60, 67, 0.4)",
                    letterSpacing: "0.4px",
                  }}
                >
                  {page.symbol}
                </span>
              ) : null}
            </div>
          ) : (
            <span
              style={{
                fontFamily: font,
                fontSize: "24px",
                fontWeight: 600,
                lineHeight: "30px",
                color: "#000",
              }}
            >
              {page.heading}
            </span>
          )}
          {page.amount && !page.hideAmountHeading ? (
            <span
              style={{
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: secondary,
              }}
            >
              {page.heading}
            </span>
          ) : null}
          {page.subheading ? (
            <span
              style={{
                fontFamily: font,
                fontSize: "14px",
                fontWeight: 400,
                lineHeight: "19px",
                color: secondary,
              }}
            >
              {page.subheading}
            </span>
          ) : null}
        </div>

        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {page.rows && page.rows.length > 0 ? (
            <div
              style={{
                background: "rgba(0, 0, 0, 0.04)",
                borderRadius: "16px",
                padding: "4px 0",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {page.rows.map((row) => (
                <ReviewKeyValue key={row.label} row={row} />
              ))}
            </div>
          ) : null}

          {page.collapsibles && page.collapsibles.length > 0 ? (
            <div
              key={`page-${safeIndex}`}
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              {page.collapsibles.map((collapsible) => (
                <CollapsibleRows
                  collapsible={collapsible}
                  key={collapsible.title}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {page.mascotNote ? <ApprovalMascotNote text={page.mascotNote} /> : null}

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
            className={isFirst ? "review-decline-btn" : "review-back-btn"}
            disabled={isSubmitting}
            onClick={handleSecondary}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: "9999px",
              background: isFirst
                ? "rgba(249, 54, 60, 0.14)"
                : "rgba(0, 0, 0, 0.04)",
              border: "none",
              cursor: isSubmitting ? "default" : "pointer",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: isFirst ? "#F9363C" : "#000",
              textAlign: "center",
              transition: "background 0.15s ease",
              opacity: isSubmitting ? 0.6 : 1,
            }}
            type="button"
          >
            {isFirst ? secondaryActionLabel : "Back"}
          </button>
          <button
            className="review-primary-btn"
            disabled={isSubmitting}
            onClick={handlePrimary}
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
              opacity: 1,
            }}
            type="button"
          >
            {isSubmitting ? (
              <ButtonSpinner />
            ) : isLast ? (
              primaryActionLabel
            ) : (
              "Continue"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
