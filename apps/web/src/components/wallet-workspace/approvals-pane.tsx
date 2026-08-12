"use client";

import { FileSliders, RefreshCw, Send } from "lucide-react";

import type { SmartAccountApprovalItem } from "@/hooks/use-smart-account-sidebar-data";
import { getTokenIconUrl } from "@/lib/token-icon";
import { ApprovalReviewContent } from "@/components/wallet-sidebar/approval-review-content";
import {
  DraftPreviewContent,
  type DraftProposalView,
} from "@/components/wallet-sidebar/draft-preview-content";
import {
  PermissionPreviewContent,
  type PermissionChangeDraft,
} from "@/components/wallet-sidebar/permission-preview-content";
import {
  SpendingLimitPreviewContent,
  type SpendingLimitDraft,
} from "@/components/wallet-sidebar/spending-limit-preview-content";
import { getVaultIcon } from "@/components/wallet-sidebar/vault-icon";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

function toStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function ApprovalEmptyState() {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flex: 1,
        flexDirection: "column",
        justifyContent: "center",
        minHeight: "220px",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "rgba(0, 0, 0, 0.04)",
          borderRadius: "9999px",
          color: "rgba(60, 60, 67, 0.58)",
          display: "flex",
          height: "48px",
          justifyContent: "center",
          marginBottom: "12px",
          width: "48px",
        }}
      >
        <FileSliders size={22} strokeWidth={1.8} />
      </div>
      <span
        style={{
          color: "#000",
          fontFamily: font,
          fontSize: "16px",
          fontWeight: 500,
          lineHeight: "20px",
        }}
      >
        No approvals yet
      </span>
      <span
        style={{
          color: secondary,
          fontFamily: font,
          fontSize: "13px",
          fontWeight: 400,
          lineHeight: "16px",
          marginTop: "4px",
          maxWidth: "220px",
        }}
      >
        New proposals will appear here.
      </span>
    </div>
  );
}

function getApprovalErrorCopy(error: string | null) {
  const isRateLimited = error?.toLowerCase().includes("rate limited") ?? false;

  return {
    body: isRateLimited
      ? "Approvals are temporarily unavailable while smart-account reads cool down."
      : "We could not load approvals. Try again in a moment.",
    title: isRateLimited ? "Network limit reached" : "Could not load approvals",
  };
}

function ApprovalErrorState({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry?: () => void;
}) {
  const copy = getApprovalErrorCopy(error);

  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flex: 1,
        flexDirection: "column",
        justifyContent: "center",
        minHeight: "260px",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "#F5F5F5",
          borderRadius: "28px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          maxWidth: "280px",
          padding: "24px",
          width: "100%",
        }}
      >
        <span
          style={{
            alignItems: "center",
            background: "#FDE8E9",
            borderRadius: "999px",
            color: "#F9363C",
            display: "inline-flex",
            height: "48px",
            justifyContent: "center",
            width: "48px",
          }}
        >
          <RefreshCw size={22} strokeWidth={1.8} />
        </span>
        <div>
          <p
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 600,
              lineHeight: "20px",
              margin: 0,
            }}
          >
            {copy.title}
          </p>
          <p
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "17px",
              margin: "6px 0 0",
            }}
          >
            {copy.body}
          </p>
        </div>
        {onRetry ? (
          <button
            onClick={onRetry}
            style={{
              background: "#000",
              border: "none",
              borderRadius: "999px",
              color: "#fff",
              cursor: "pointer",
              fontFamily: font,
              fontSize: "14px",
              fontWeight: 500,
              lineHeight: "18px",
              padding: "8px 16px",
            }}
            type="button"
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ApprovalRow({
  approval,
  isBalanceHidden,
  onReview,
}: {
  approval: SmartAccountApprovalItem;
  isBalanceHidden: boolean;
  onReview: (approval: SmartAccountApprovalItem) => void;
}) {
  const symbol = approval.symbol || "TOKEN";

  return (
    <button
      className="workspace-approval-row"
      onClick={() => onReview(approval)}
      style={{
        background: "transparent",
        border: "none",
        borderRadius: "16px",
        cursor: "pointer",
        display: "flex",
        padding: "0 12px",
        textAlign: "left",
        transition: "background 0.15s ease",
        width: "100%",
      }}
      type="button"
    >
      <div
        style={{
          flexShrink: 0,
          height: "50px",
          marginBottom: "6px",
          marginRight: "12px",
          marginTop: "6px",
          position: "relative",
          width: "48px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={symbol}
          src={getTokenIconUrl(symbol)}
          style={{
            borderRadius: "9999px",
            height: "40px",
            left: 0,
            objectFit: "cover",
            position: "absolute",
            top: 0,
            width: "40px",
          }}
        />
        <div
          style={{
            alignItems: "center",
            background: "#2a2a2a",
            border: "2px solid #fff",
            borderRadius: "9999px",
            bottom: 0,
            display: "flex",
            height: "24px",
            justifyContent: "center",
            position: "absolute",
            right: 0,
            width: "24px",
          }}
        >
          <Send size={12} style={{ color: "#fff" }} />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          minWidth: 0,
          paddingBottom: "2px",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            minWidth: 0,
            paddingTop: "1px",
          }}
        >
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              gap: "2px",
              minWidth: 0,
              padding: "10px 0",
            }}
          >
            <span
              style={{
                color: "#000",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 500,
                letterSpacing: "-0.176px",
                lineHeight: "20px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {approval.title}
            </span>
            <span
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 400,
                lineHeight: "16px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {toStatusLabel(approval.status)} · to {approval.destinationLabel}
            </span>
          </div>

          <div
            style={{
              alignItems: "flex-end",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              gap: "2px",
              padding: "10px 0 10px 12px",
            }}
          >
            <span
              style={{
                color: isBalanceHidden ? "#BBBBC0" : "#000",
                filter: isBalanceHidden
                  ? "url(#workspace-approvals-pixelate-sm)"
                  : "none",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                transition: "filter 0.15s ease, color 0.15s ease",
                userSelect: isBalanceHidden ? "none" : "auto",
                whiteSpace: "nowrap",
              }}
            >
              {approval.amount} {approval.symbol}
            </span>
            <div
              style={{
                alignItems: "center",
                display: "flex",
                gap: "4px",
                justifyContent: "flex-end",
              }}
            >
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  whiteSpace: "nowrap",
                }}
              >
                from
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={approval.sourceLabel}
                src={getVaultIcon(approval.sourceAccountIndex)}
                style={{
                  borderRadius: "4px",
                  height: "16px",
                  objectFit: "cover",
                  width: "16px",
                }}
              />
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  maxWidth: "80px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {approval.sourceLabel}
              </span>
            </div>
          </div>
        </div>

        {(() => {
          const pillLabel =
            approval.status === "active"
              ? "Review & Respond"
              : approval.status === "approved" && approval.canExecute
              ? "Execute"
              : null;
          if (!pillLabel) return null;
          return (
            <div
              style={{
                display: "flex",
                gap: "8px",
                paddingBottom: "11px",
              }}
            >
              <span
                className="workspace-approval-review-pill"
                style={{
                  background: "rgba(0, 0, 0, 0.04)",
                  borderRadius: "9999px",
                  color: "#000",
                  fontFamily: font,
                  fontSize: "14px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  padding: "6px 16px",
                  transition: "background 0.15s ease",
                  whiteSpace: "nowrap",
                }}
              >
                {pillLabel}
              </span>
            </div>
          );
        })()}
      </div>
    </button>
  );
}

export function ApprovalsPane({
  approvals,
  draft = null,
  draftError = null,
  error,
  isBalanceHidden,
  isDraftSubmitting = false,
  isSubmitting,
  pendingApprovalId,
  permissionDraft = null,
  permissionDraftError = null,
  isPermissionDraftSubmitting = false,
  onCancelPermissionDraft,
  onSubmitPermissionDraft,
  spendingLimitDraft = null,
  spendingLimitDraftError = null,
  isSpendingLimitDraftSubmitting = false,
  onCancelSpendingLimitDraft,
  onSubmitSpendingLimitDraft,
  selectedApproval,
  selectedDraft = null,
  onApprove,
  onBackToList,
  onCancelDraft,
  onDecline,
  onExecute,
  onReview,
  onReviewDraft,
  onRetry,
  onSubmitDraft,
  actionError = null,
}: {
  approvals: SmartAccountApprovalItem[];
  draft?: DraftProposalView | null;
  draftError?: string | null;
  error: string | null;
  isBalanceHidden: boolean;
  isDraftSubmitting?: boolean;
  isSubmitting: boolean;
  pendingApprovalId: string | null;
  permissionDraft?: PermissionChangeDraft | null;
  permissionDraftError?: string | null;
  isPermissionDraftSubmitting?: boolean;
  onCancelPermissionDraft?: () => void;
  onSubmitPermissionDraft?: () => void;
  spendingLimitDraft?: SpendingLimitDraft | null;
  spendingLimitDraftError?: string | null;
  isSpendingLimitDraftSubmitting?: boolean;
  onCancelSpendingLimitDraft?: () => void;
  onSubmitSpendingLimitDraft?: () => void;
  selectedApproval: SmartAccountApprovalItem | null;
  selectedDraft?: DraftProposalView | null;
  onApprove: (approval: SmartAccountApprovalItem) => void;
  onBackToList: () => void;
  onCancelDraft?: () => void;
  onDecline: (approval: SmartAccountApprovalItem) => void;
  onExecute: (approval: SmartAccountApprovalItem) => void;
  onReview: (approval: SmartAccountApprovalItem) => void;
  onReviewDraft?: (draft: DraftProposalView) => void;
  onRetry?: () => void;
  onSubmitDraft?: () => void;
  actionError?: string | null;
}) {
  if (spendingLimitDraft) {
    return (
      <SpendingLimitPreviewContent
        actionError={spendingLimitDraftError}
        draft={spendingLimitDraft}
        isSubmitting={isSpendingLimitDraftSubmitting}
        onBack={onCancelSpendingLimitDraft ?? onBackToList}
        onCancel={onCancelSpendingLimitDraft ?? onBackToList}
        onClose={onCancelSpendingLimitDraft ?? onBackToList}
        onSubmit={onSubmitSpendingLimitDraft ?? onBackToList}
      />
    );
  }

  if (permissionDraft) {
    return (
      <PermissionPreviewContent
        actionError={permissionDraftError}
        draft={permissionDraft}
        isSubmitting={isPermissionDraftSubmitting}
        onBack={onCancelPermissionDraft ?? onBackToList}
        onCancel={onCancelPermissionDraft ?? onBackToList}
        onClose={onCancelPermissionDraft ?? onBackToList}
        onSubmit={onSubmitPermissionDraft ?? onBackToList}
      />
    );
  }

  if (selectedDraft) {
    return (
      <DraftPreviewContent
        actionError={draftError}
        draft={selectedDraft}
        isSubmitting={isDraftSubmitting}
        onBack={onBackToList}
        onCancel={onCancelDraft ?? onBackToList}
        onClose={onBackToList}
        onSubmit={onSubmitDraft ?? onBackToList}
        showClose={false}
      />
    );
  }

  if (selectedApproval) {
    const isSelectedSubmitting =
      isSubmitting && pendingApprovalId === selectedApproval.id;

    return (
      <ApprovalReviewContent
        approval={selectedApproval}
        actionError={actionError}
        isSubmitting={isSelectedSubmitting}
        onApprove={() => onApprove(selectedApproval)}
        onBack={onBackToList}
        onClose={onBackToList}
        onDecline={() => onDecline(selectedApproval)}
        onExecute={() => onExecute(selectedApproval)}
        showClose={false}
      />
    );
  }

  return (
    <div
      style={{
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <style jsx>{`
        .workspace-approval-row:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .workspace-approval-row:hover .workspace-approval-review-pill {
          background: rgba(0, 0, 0, 0.1) !important;
        }
      `}</style>

      <svg
        aria-hidden="true"
        height="0"
        style={{
          height: 0,
          overflow: "hidden",
          position: "absolute",
          width: 0,
        }}
        width="0"
      >
        <defs>
          <filter
            id="workspace-approvals-pixelate-sm"
            x="0"
            y="0"
            width="100%"
            height="100%"
          >
            <feFlood x="3" y="3" height="2" width="2" />
            <feComposite width="8" height="8" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="4" />
          </filter>
        </defs>
      </svg>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            padding: "3px 12px 1px",
            width: "100%",
          }}
        >
          <span
            style={{
              color: "#000",
              flex: 1,
              fontFamily: font,
              fontSize: "20px",
              fontWeight: 600,
              lineHeight: "24px",
              padding: "8px 0",
            }}
          >
            Approvals
          </span>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowX: "hidden",
          overflowY: "auto",
          padding: "0 8px 8px",
        }}
      >
        {error ? (
          <ApprovalErrorState error={error} onRetry={onRetry} />
        ) : approvals.length === 0 && !draft ? (
          <ApprovalEmptyState />
        ) : (
          <>
            {draft && onReviewDraft ? (
              <DraftRow
                draft={draft}
                isBalanceHidden={isBalanceHidden}
                onReview={onReviewDraft}
              />
            ) : null}
            {approvals.map((approval) => (
              <ApprovalRow
                approval={approval}
                isBalanceHidden={isBalanceHidden}
                key={approval.id}
                onReview={onReview}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function DraftRow({
  draft,
  isBalanceHidden,
  onReview,
}: {
  draft: DraftProposalView;
  isBalanceHidden: boolean;
  onReview: (draft: DraftProposalView) => void;
}) {
  return (
    <button
      className="workspace-approval-row"
      onClick={() => onReview(draft)}
      style={{
        background: "transparent",
        border: "none",
        borderRadius: "16px",
        cursor: "pointer",
        display: "flex",
        padding: "0 12px",
        textAlign: "left",
        transition: "background 0.15s ease",
        width: "100%",
      }}
      type="button"
    >
      <div
        style={{
          flexShrink: 0,
          height: "50px",
          marginBottom: "6px",
          marginRight: "12px",
          marginTop: "6px",
          position: "relative",
          width: "48px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={draft.symbol}
          src={getTokenIconUrl(draft.symbol)}
          style={{
            borderRadius: "9999px",
            height: "40px",
            left: 0,
            objectFit: "cover",
            position: "absolute",
            top: 0,
            width: "40px",
          }}
        />
        <div
          style={{
            alignItems: "center",
            background: "#2a2a2a",
            border: "2px solid #fff",
            borderRadius: "9999px",
            bottom: 0,
            display: "flex",
            height: "24px",
            justifyContent: "center",
            position: "absolute",
            right: 0,
            width: "24px",
          }}
        >
          <Send size={12} style={{ color: "#fff" }} />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          minWidth: 0,
          paddingBottom: "2px",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            minWidth: 0,
            paddingTop: "1px",
          }}
        >
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              gap: "2px",
              minWidth: 0,
              padding: "10px 0",
            }}
          >
            <span
              style={{
                color: "#000",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 500,
                letterSpacing: "-0.176px",
                lineHeight: "20px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Send {draft.symbol}
            </span>
            <span
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 400,
                lineHeight: "16px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Draft · to {draft.destinationLabel}
            </span>
          </div>

          <div
            style={{
              alignItems: "flex-end",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              gap: "2px",
              padding: "10px 0 10px 12px",
            }}
          >
            <span
              style={{
                color: isBalanceHidden ? "#BBBBC0" : "#000",
                filter: isBalanceHidden
                  ? "url(#workspace-approvals-pixelate-sm)"
                  : "none",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                transition: "filter 0.15s ease, color 0.15s ease",
                userSelect: isBalanceHidden ? "none" : "auto",
                whiteSpace: "nowrap",
              }}
            >
              {draft.amountDisplay} {draft.symbol}
            </span>
            <div
              style={{
                alignItems: "center",
                display: "flex",
                gap: "4px",
                justifyContent: "flex-end",
              }}
            >
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  whiteSpace: "nowrap",
                }}
              >
                from
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={draft.sourceLabel}
                src={getVaultIcon(draft.sourceAccountIndex)}
                style={{
                  borderRadius: "4px",
                  height: "16px",
                  objectFit: "cover",
                  width: "16px",
                }}
              />
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  maxWidth: "80px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {draft.sourceLabel}
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            paddingBottom: "11px",
          }}
        >
          <span
            className="workspace-approval-review-pill"
            style={{
              background: "rgba(0, 0, 0, 0.04)",
              borderRadius: "9999px",
              color: "#000",
              fontFamily: font,
              fontSize: "14px",
              fontWeight: 400,
              lineHeight: "20px",
              padding: "6px 16px",
              transition: "background 0.15s ease",
              whiteSpace: "nowrap",
            }}
          >
            Preview & Submit
          </span>
        </div>
      </div>
    </button>
  );
}
