"use client";

import { sendPreparedWithWallet } from "@loyal-labs/smart-account-vaults";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ReceiptText } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { DogWithMood } from "@/components/chat-input";
import type {
  ActivityRow,
  TransactionDetail,
} from "@/components/wallet-sidebar/types";
import { EarnYieldIcon } from "@/components/wallet-sidebar/portfolio-content";
import { useAuthSession } from "@/contexts/auth-session-context";
import type { LoadedEarnAutodepositScheduledSweep } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import {
  hydratePreparedEarnPolicyRefund,
  type EarnPolicyRefundPrepareResponse,
  type EarnPolicyRefundScanPolicy,
  type EarnPolicyRefundScanResponse,
} from "@/lib/yield-optimization/earn-policy-refund-contracts.shared";
import {
  fetchEarnTransactions,
  invalidateEarnTransactionsCache,
  type EarnTransactionItem,
} from "@/lib/yield-optimization/earn-transactions.client";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

const KAMINO_ICON = "/wallet-workspace/earn-kamino.png";
const EARN_VAULT_LABEL = "Earn";
const LOYAL_EARN_BRAND_COLOR = "#F9363C";
const UTC_TIME_ZONE = "UTC";
const USDC_RAW_SCALE = BigInt(1_000_000);

// Poll cadence for the pseudo-realtime feed. Most ticks resolve from the
// client cache for free; the tick after an Earn action fetches fresh data
// because the workspace invalidates the cache on confirmation.
const EARN_TRANSACTIONS_POLL_INTERVAL_MS = 15_000;
const EARN_TRANSACTIONS_FAST_POLL_INTERVAL_MS = 2_000;
const EARN_TRANSACTIONS_FAST_POLL_WINDOW_MS = 90_000;
const EARN_MASCOT_STREAM_DELAY_MS = 240;
const EARN_MASCOT_STREAM_INTERVAL_MS = 30;
const EARN_MASCOT_EXPERIMENTAL_TOGGLE_CLICK_COUNT = 5;
const EARN_MASCOT_EXPERIMENTAL_TOGGLE_RESET_MS = 1_800;
const TELEGRAM_COMMUNITY_URL = "https://t.me/loyal_tgchat";
const TURN_ON_EARN_MASCOT_PHRASE_ID = "turn-on-earn";

type EarnMascotPhrase = {
  href?: string;
  id: string;
  text: string;
};

const EARN_MASCOT_IDLE_PHRASES = [
  {
    href: TELEGRAM_COMMUNITY_URL,
    id: "join-telegram",
    text: "Join the pack on Telegram",
  },
  {
    id: "guard-funds",
    text: "I sit here and guard your funds. Best job I've ever had",
  },
  { id: "still-loyal", text: "Still here. Still Loyal." },
  { id: "herding-usdc", text: "I'm herding your USDC" },
  {
    id: TURN_ON_EARN_MASCOT_PHRASE_ID,
    text: "Turn on Earn. Idle USDC is a waste of a good dog's time.",
  },
] as const satisfies readonly EarnMascotPhrase[];

const EARN_MASCOT_BUSY_PHRASES = [
  { id: "sniffing", text: "Sniffing…" },
  { id: "fetching", text: "Fetching…" },
  { id: "snuffling", text: "Snuffling…" },
  { id: "borking", text: "Borking…" },
  { id: "floofing", text: "Floofing…" },
  { id: "splooting", text: "Splooting…" },
  { id: "mlemming", text: "Mlemming…" },
  { id: "zoomies", text: "Zoomies…" },
  { id: "wagging", text: "Wagging…" },
  { id: "trotting", text: "Trotting…" },
  { id: "booping", text: "Booping…" },
  { id: "scritching", text: "Scritching…" },
  { id: "pawing-through", text: "Pawing through…" },
  { id: "digging", text: "Digging…" },
  { id: "good-boying", text: "Good-boying…" },
  { id: "staying-loyal", text: "Staying Loyal…" },
  { id: "counting-bones", text: "Counting bones…" },
  { id: "marking-territory", text: "Marking territory…" },
  { id: "heeling", text: "Heeling…" },
] as const satisfies readonly EarnMascotPhrase[];

export type PendingScheduledSweepPreview = {
  amountRaw: string;
};

export function resolveEarnTransactionDisplayTimeZone(
  timeZone?: string | null
): string {
  const candidate =
    timeZone ??
    (typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : null);

  if (!candidate) {
    return UTC_TIME_ZONE;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(
      new Date(0)
    );
    return candidate;
  } catch {
    return UTC_TIME_ZONE;
  }
}

function parseEarnTransactionInstant(confirmedAt: string | null | undefined) {
  if (!confirmedAt) {
    return null;
  }

  const date = new Date(confirmedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatEarnTransactionDateGroup(
  confirmedAt: string | null | undefined,
  timeZone?: string | null
): string | null {
  const date = parseEarnTransactionInstant(confirmedAt);
  if (!date) {
    return null;
  }

  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    timeZone: resolveEarnTransactionDisplayTimeZone(timeZone),
  });
}

export function formatEarnTransactionTimestamp(
  confirmedAt: string | null | undefined,
  timeZone?: string | null
): string | null {
  const date = parseEarnTransactionInstant(confirmedAt);
  if (!date) {
    return null;
  }

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
    timeZone: resolveEarnTransactionDisplayTimeZone(timeZone),
  });
}

function getEarnTransactionConfirmedAt(item: EarnTransactionItem) {
  return item.confirmedAt ?? item.sortTimestamp ?? null;
}

export function getEarnTransactionRowLabel(
  item: Pick<EarnTransactionItem, "eventType" | "kind">
) {
  switch (item.eventType) {
    case "autodeposit_created":
      return "Create allowance";
    case "autodeposit_closed":
      return "Remove allowance";
    case "balance_sweep":
      return "Balance sweep";
    case "deposit_initialized":
      return "Create & Deposit";
    case "withdrawal_full":
      return "Withdraw & Close";
  }

  switch (item.kind) {
    case "deposit":
      return "Deposit";
    case "withdraw":
      return "Withdraw";
    case "rebalance":
      return "Rebalanced";
    case "reconciliation":
      return "Reconciled";
    case "balance_sweep":
      return "Balance sweep";
    case "autodeposit_action":
      return "Allowance";
  }
}

export function buildEarnTransactionDetail(
  item: EarnTransactionItem,
  timeZone?: string | null
): TransactionDetail {
  const isDeposit = item.kind === "deposit" || item.kind === "balance_sweep";
  const isMovement =
    item.kind === "rebalance" || item.kind === "reconciliation";
  const isAutodepositAction = item.kind === "autodeposit_action";
  const confirmedAt = getEarnTransactionConfirmedAt(item);
  const timestamp =
    formatEarnTransactionTimestamp(confirmedAt, timeZone) ?? item.timestamp;
  const dateGroup =
    formatEarnTransactionDateGroup(confirmedAt, timeZone) ?? item.dateGroup;
  const activityIcon =
    (isMovement
      ? item.destination.icon ?? item.source.icon
      : isDeposit
      ? item.destination.icon ?? item.source.icon
      : item.source.icon ?? item.destination.icon) ?? KAMINO_ICON;
  const activity: ActivityRow = {
    id: item.signature,
    type: isDeposit ? "received" : "sent",
    counterparty: isAutodepositAction
      ? item.destination.label
      : isMovement
      ? `${getEarnTransactionRowLabel(item)} ${item.source.label} -> ${
          item.destination.label
        }`
      : isDeposit
      ? item.source.label
      : item.destination.label,
    amount: item.amount,
    timestamp,
    date: dateGroup,
    icon: activityIcon,
  };
  return {
    activity,
    usdValue: item.rawAmount,
    status: "Completed",
    networkFee: isAutodepositAction ? "Paid by wallet" : "~0.000005 SOL",
    networkFeeUsd: isAutodepositAction ? "confirmed on-chain" : "~$0.0005",
  };
}

export function getEarnTransactionAmountColor(args: {
  isBalanceHidden?: boolean;
  kind: EarnTransactionItem["kind"];
}) {
  if (args.isBalanceHidden) {
    return "#BBBBC0";
  }

  return args.kind === "deposit" || args.kind === "balance_sweep"
    ? "#34C759"
    : "#000";
}

function EarnTransactionsLoadingState() {
  return (
    <div
      aria-label="Loading earn transactions"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "8px 12px",
      }}
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          style={{
            alignItems: "center",
            display: "flex",
            gap: "12px",
            height: "60px",
            width: "100%",
          }}
        >
          <span
            style={{
              background: "rgba(0, 0, 0, 0.06)",
              borderRadius: "9999px",
              height: "48px",
              width: "48px",
            }}
          />
          <span
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <span
              style={{
                background: "rgba(0, 0, 0, 0.06)",
                borderRadius: "9999px",
                height: "14px",
                width: "104px",
              }}
            />
            <span
              style={{
                background: "rgba(0, 0, 0, 0.05)",
                borderRadius: "9999px",
                height: "12px",
                width: "72px",
              }}
            />
          </span>
          <span
            style={{
              background: "rgba(0, 0, 0, 0.06)",
              borderRadius: "9999px",
              height: "14px",
              width: "92px",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function EarnTransactionsErrorState({ message }: { message: string }) {
  return (
    <div
      role="status"
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
      <span
        style={{
          color: "#000",
          fontFamily: font,
          fontSize: "16px",
          fontWeight: 500,
          lineHeight: "20px",
        }}
      >
        Transactions unavailable
      </span>
      <span
        style={{
          color: secondary,
          fontFamily: font,
          fontSize: "13px",
          fontWeight: 400,
          lineHeight: "16px",
          marginTop: "4px",
          maxWidth: "240px",
        }}
      >
        {message}
      </span>
    </div>
  );
}

const COMPOUND_ICON_IMAGE_STYLE = {
  height: "100%",
  inset: 0,
  objectFit: "cover",
  position: "absolute",
  width: "100%",
} as const;

function CompoundUsdcImage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        src="/wallet-workspace/earn-vault-usdc.png"
        style={COMPOUND_ICON_IMAGE_STYLE}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        src="/wallet-workspace/earn-vault-usdc-overlay.png"
        style={COMPOUND_ICON_IMAGE_STYLE}
      />
    </>
  );
}

function CompoundKaminoImage() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" src={KAMINO_ICON} style={COMPOUND_ICON_IMAGE_STYLE} />
  );
}

function CompoundMarketImage({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" src={src} style={COMPOUND_ICON_IMAGE_STYLE} />
  );
}

// Reads source (back, top-left) -> destination (front, bottom-right):
// deposits flow USDC -> Kamino, withdrawals flow Kamino -> USDC. Rebalances
// pass explicit market logos (backSrc/frontSrc) so each Kamino market shows
// its own brand icon instead of the generic vault art.
function CompoundIcon({
  backSrc = null,
  frontSrc = null,
  isWithdraw = false,
}: {
  backSrc?: string | null;
  frontSrc?: string | null;
  isWithdraw?: boolean;
}) {
  const back = backSrc ? (
    <CompoundMarketImage src={backSrc} />
  ) : isWithdraw ? (
    <CompoundKaminoImage />
  ) : (
    <CompoundUsdcImage />
  );
  const front = frontSrc ? (
    <CompoundMarketImage src={frontSrc} />
  ) : isWithdraw ? (
    <CompoundUsdcImage />
  ) : (
    <CompoundKaminoImage />
  );
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        flexShrink: 0,
        height: "48px",
        position: "relative",
        width: "48px",
      }}
    >
      <span
        style={{
          border: "2.286px solid #fff",
          borderRadius: "9999px",
          height: "32px",
          left: 0,
          overflow: "hidden",
          position: "absolute",
          top: 0,
          width: "32px",
        }}
      >
        {back}
      </span>
      <span
        style={{
          borderRadius: "9999px",
          bottom: 0,
          height: "32px",
          overflow: "hidden",
          position: "absolute",
          right: 0,
          width: "32px",
        }}
      >
        {front}
      </span>
    </span>
  );
}

function FlowAccount({
  icon,
  isEarnVault = false,
  label,
}: {
  icon: string | null;
  isEarnVault?: boolean;
  label: string;
}) {
  return (
    <span
      style={{
        alignItems: "center",
        display: "inline-flex",
        gap: "4px",
        whiteSpace: "nowrap",
      }}
    >
      {isEarnVault || label === EARN_VAULT_LABEL ? (
        <EarnYieldIcon size={16} />
      ) : icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          aria-hidden="true"
          src={icon}
          style={{
            borderRadius: "4px",
            flexShrink: 0,
            height: "16px",
            objectFit: "cover",
            width: "16px",
          }}
        />
      ) : null}
      <span
        style={{
          color: secondary,
          fontFamily: font,
          fontSize: "13px",
          lineHeight: "16px",
        }}
      >
        {label}
      </span>
    </span>
  );
}

function EarnTransactionRow({
  displayTimeZone,
  isBalanceHidden = false,
  item,
  onSelect,
}: {
  displayTimeZone: string;
  isBalanceHidden?: boolean;
  item: EarnTransactionItem;
  onSelect: (item: EarnTransactionItem) => void;
}) {
  const label = getEarnTransactionRowLabel(item);
  const isMovement =
    item.kind === "rebalance" || item.kind === "reconciliation";
  const compoundBackIcon =
    isMovement || item.kind === "withdraw" ? item.source.icon : null;
  const compoundFrontIcon =
    isMovement || item.kind === "deposit" ? item.destination.icon : null;
  const timestamp =
    formatEarnTransactionTimestamp(
      getEarnTransactionConfirmedAt(item),
      displayTimeZone
    ) ?? item.timestamp;
  return (
    <button
      className="earn-tx-row"
      onClick={() => onSelect(item)}
      style={{
        alignItems: "center",
        background: "transparent",
        border: "none",
        borderRadius: "16px",
        cursor: "pointer",
        display: "flex",
        overflow: "hidden",
        padding: "0 12px",
        textAlign: "left",
        transition: "background 0.15s ease",
        width: "100%",
      }}
      type="button"
    >
      <span style={{ display: "flex", padding: "6px 12px 6px 0" }}>
        {item.kind === "autodeposit_action" ? (
          // Allowance create/remove moves no funds, so a single Earn coin
          // reads better than the USDC <-> Kamino flow pair. Clipped round
          // to match the other transaction icons.
          <span
            style={{
              borderRadius: "9999px",
              display: "inline-flex",
              flexShrink: 0,
              height: "48px",
              overflow: "hidden",
              width: "48px",
            }}
          >
            <EarnYieldIcon />
          </span>
        ) : (
          <CompoundIcon
            backSrc={compoundBackIcon}
            frontSrc={compoundFrontIcon}
            isWithdraw={item.kind === "withdraw"}
          />
        )}
      </span>
      <span
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
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: secondary,
            fontFamily: font,
            fontSize: "13px",
            lineHeight: "16px",
          }}
        >
          {timestamp}
        </span>
      </span>
      <span
        style={{
          alignItems: "flex-end",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          paddingLeft: "12px",
          paddingTop: "10px",
          paddingBottom: "10px",
        }}
      >
        <span
          style={{
            color: getEarnTransactionAmountColor({
              isBalanceHidden,
              kind: item.kind,
            }),
            filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
            fontFamily: font,
            fontSize: "16px",
            lineHeight: "20px",
            transition: "filter 0.15s ease, color 0.15s ease",
            userSelect: isBalanceHidden ? "none" : "auto",
            whiteSpace: "nowrap",
          }}
        >
          {item.amount}
        </span>
        <span
          style={{
            alignItems: "center",
            display: "inline-flex",
            gap: "4px",
            justifyContent: "flex-end",
          }}
        >
          <FlowAccount icon={item.source.icon} label={item.source.label} />
          <span
            style={{
              color: "rgba(60, 60, 67, 0.4)",
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "16px",
            }}
          >
            →
          </span>
          <FlowAccount
            icon={item.destination.icon}
            label={item.destination.label}
          />
        </span>
      </span>
    </button>
  );
}

function TransactionsSectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "11px 12px 8px",
        width: "100%",
      }}
    >
      <p
        style={{
          color: secondary,
          fontFamily: font,
          fontSize: "16px",
          fontWeight: 400,
          letterSpacing: "-0.176px",
          lineHeight: "20px",
          margin: 0,
        }}
      >
        {label}
      </p>
    </div>
  );
}

export function formatScheduledSweepAmount(rawAmount: string): string {
  if (!/^\d+$/.test(rawAmount)) {
    return "0.00 USDC";
  }

  const raw = BigInt(rawAmount);
  const whole = raw / USDC_RAW_SCALE;
  const cents = (raw % USDC_RAW_SCALE) / BigInt(10_000);

  return `${whole.toLocaleString("en-US")}.${cents
    .toString()
    .padStart(2, "0")} USDC`;
}

export function formatScheduledSweepTime(
  eligibleAfter: string,
  timeZone?: string | null
): string {
  const date = new Date(eligibleAfter);
  if (Number.isNaN(date.getTime())) {
    return "Scheduled";
  }

  return date.toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: resolveEarnTransactionDisplayTimeZone(timeZone),
  });
}

export function shouldShowScheduledSweepsSection(
  scheduledSweeps: readonly LoadedEarnAutodepositScheduledSweep[],
  pendingScheduledSweep?: PendingScheduledSweepPreview | null
): boolean {
  return scheduledSweeps.length > 0 || Boolean(pendingScheduledSweep);
}

export function resolveVisiblePendingScheduledSweep(
  scheduledSweeps: readonly LoadedEarnAutodepositScheduledSweep[],
  pendingScheduledSweep?: PendingScheduledSweepPreview | null
): PendingScheduledSweepPreview | null {
  return scheduledSweeps.length > 0 ? null : pendingScheduledSweep ?? null;
}

function parseExactUsdcRawAmount(rawAmount: string): bigint | null {
  const match = rawAmount.trim().match(/^\$(-?\d+)\.(\d{6})$/);
  if (!match) {
    return null;
  }

  const [, whole = "0", fraction = "000000"] = match;
  const sign = whole.startsWith("-") ? BigInt(-1) : BigInt(1);
  const absoluteWhole = whole.startsWith("-") ? whole.slice(1) : whole;
  return sign * (BigInt(absoluteWhole) * USDC_RAW_SCALE + BigInt(fraction));
}

function hasBalanceSweepActivityForScheduledSweep(
  transactions: readonly EarnTransactionItem[],
  sweep: LoadedEarnAutodepositScheduledSweep
): boolean {
  if (!/^\d+$/.test(sweep.remainingAmountRaw)) {
    return false;
  }

  const scheduledAmountRaw = BigInt(sweep.remainingAmountRaw);
  return transactions.some((item) => {
    if (item.kind !== "balance_sweep") {
      return false;
    }

    return parseExactUsdcRawAmount(item.rawAmount) === scheduledAmountRaw;
  });
}

function ScheduledTransactionRow({
  displayTimeZone,
  isAwaitingExecution = false,
  isExecuting = false,
  isPending = false,
  isBalanceHidden = false,
  onExecuteNow,
  sweep,
}: {
  displayTimeZone: string;
  isAwaitingExecution?: boolean;
  isExecuting?: boolean;
  isPending?: boolean;
  isBalanceHidden?: boolean;
  onExecuteNow?: () => void;
  sweep: LoadedEarnAutodepositScheduledSweep | PendingScheduledSweepPreview;
}) {
  const amountLabel = formatScheduledSweepAmount(
    "remainingAmountRaw" in sweep ? sweep.remainingAmountRaw : sweep.amountRaw
  );
  const timeLabel =
    "eligibleAfter" in sweep
      ? formatScheduledSweepTime(sweep.eligibleAfter, displayTimeZone)
      : "Scheduling...";
  const isButtonDisabled = isPending || isExecuting || !onExecuteNow;

  return (
    <>
      <style jsx>{`
        .earn-scheduled-execute-btn {
          transition: background 0.15s ease, transform 0.15s ease;
        }
        .earn-scheduled-execute-btn:hover {
          background: #e72f34 !important;
          transform: translateY(-1px);
        }
        .earn-scheduled-execute-btn:active {
          transform: translateY(0);
        }
        .earn-scheduled-spinner {
          animation: earn-scheduled-spin 0.8s linear infinite;
        }
        @keyframes earn-scheduled-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          padding: "0 12px",
          width: "100%",
        }}
      >
        <span style={{ display: "flex", padding: "6px 12px 6px 0" }}>
          <CompoundIcon />
        </span>
        <span
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <span
            style={{
              alignItems: "center",
              display: "flex",
              width: "100%",
            }}
          >
            <span
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
                }}
              >
                Autodeposit
              </span>
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "13px",
                  lineHeight: "16px",
                }}
              >
                {timeLabel}
              </span>
            </span>
            <span
              style={{
                alignItems: "flex-end",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                paddingBottom: "10px",
                paddingLeft: "12px",
                paddingTop: "10px",
              }}
            >
              <span
                style={{
                  color: isBalanceHidden ? "#BBBBC0" : "#000",
                  filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                  fontFamily: font,
                  fontSize: "16px",
                  lineHeight: "20px",
                  transition: "filter 0.15s ease, color 0.15s ease",
                  userSelect: isBalanceHidden ? "none" : "auto",
                  whiteSpace: "nowrap",
                }}
              >
                {amountLabel}
              </span>
              <span
                style={{
                  alignItems: "center",
                  display: "inline-flex",
                  gap: "4px",
                  justifyContent: "flex-end",
                }}
              >
                <FlowAccount icon="/agents/Agent-01.svg" label="Main" />
                <span
                  style={{
                    color: "rgba(60, 60, 67, 0.4)",
                    fontFamily: font,
                    fontSize: "13px",
                    lineHeight: "16px",
                  }}
                >
                  →
                </span>
                <FlowAccount icon={null} isEarnVault label="Earn" />
              </span>
            </span>
          </span>
          <span style={{ display: "flex", gap: "8px", paddingBottom: "11px" }}>
            <button
              aria-busy={isExecuting}
              className="earn-scheduled-execute-btn"
              disabled={isButtonDisabled}
              onClick={onExecuteNow}
              style={{
                alignItems: "center",
                background:
                  isPending || isExecuting ? "#F97B80" : LOYAL_EARN_BRAND_COLOR,
                border: "none",
                borderRadius: "9999px",
                color: "#fff",
                cursor: isButtonDisabled ? "default" : "pointer",
                display: "inline-flex",
                gap: "6px",
                fontFamily: font,
                fontSize: "14px",
                fontWeight: 500,
                justifyContent: "center",
                lineHeight: "20px",
                padding: "6px 16px",
              }}
              type="button"
            >
              {isPending ? (
                <span
                  aria-hidden="true"
                  className="earn-scheduled-spinner"
                  style={{
                    border: "2px solid rgba(255, 255, 255, 0.45)",
                    borderRadius: "9999px",
                    borderTopColor: "#fff",
                    display: "inline-block",
                    height: "12px",
                    width: "12px",
                  }}
                />
              ) : null}
              {isPending
                ? "Scheduling"
                : isAwaitingExecution
                ? "Executing..."
                : isExecuting
                ? "Requesting..."
                : "Execute now"}
            </button>
          </span>
        </span>
      </div>
    </>
  );
}

function formatPolicyRefundLamports(lamports: number | null): string {
  if (lamports === null || !Number.isFinite(lamports)) {
    return "Unknown rent";
  }

  return `${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`;
}

function PolicyRefundRow({
  isRefunding = false,
  onRefund,
  policy,
}: {
  isRefunding?: boolean;
  onRefund?: () => void;
  policy: EarnPolicyRefundScanPolicy;
}) {
  const isButtonDisabled = isRefunding || !policy.canRefund || !onRefund;
  const subtitle = policy.blockedReason ?? `Policy #${policy.seed}`;

  return (
    <div
      style={{
        alignItems: "flex-start",
        display: "flex",
        padding: "0 12px",
        width: "100%",
      }}
    >
      <span style={{ display: "flex", padding: "6px 12px 6px 0" }}>
        <CompoundIcon />
      </span>
      <span
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <span
          style={{
            alignItems: "center",
            display: "flex",
            width: "100%",
          }}
        >
          <span
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
              }}
            >
              Policy rent
            </span>
            <span
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "13px",
                lineHeight: "16px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={policy.account}
            >
              {subtitle}
            </span>
          </span>
          <span
            style={{
              alignItems: "flex-end",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              paddingBottom: "10px",
              paddingLeft: "12px",
              paddingTop: "10px",
            }}
          >
            <span
              style={{
                color: "#000",
                fontFamily: font,
                fontSize: "16px",
                lineHeight: "20px",
                whiteSpace: "nowrap",
              }}
            >
              {formatPolicyRefundLamports(policy.lamports)}
            </span>
            <span
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "13px",
                lineHeight: "16px",
                whiteSpace: "nowrap",
              }}
            >
              {policy.state}
            </span>
          </span>
        </span>
        <span style={{ display: "flex", gap: "8px", paddingBottom: "11px" }}>
          <button
            aria-busy={isRefunding}
            className="earn-scheduled-execute-btn"
            disabled={isButtonDisabled}
            onClick={onRefund}
            style={{
              alignItems: "center",
              background:
                isRefunding || !policy.canRefund
                  ? "#F97B80"
                  : LOYAL_EARN_BRAND_COLOR,
              border: "none",
              borderRadius: "9999px",
              color: "#fff",
              cursor: isButtonDisabled ? "default" : "pointer",
              display: "inline-flex",
              gap: "6px",
              fontFamily: font,
              fontSize: "14px",
              fontWeight: 500,
              justifyContent: "center",
              lineHeight: "20px",
              padding: "6px 16px",
            }}
            type="button"
          >
            {isRefunding ? (
              <span
                aria-hidden="true"
                className="earn-scheduled-spinner"
                style={{
                  border: "2px solid rgba(255, 255, 255, 0.45)",
                  borderRadius: "9999px",
                  borderTopColor: "#fff",
                  display: "inline-block",
                  height: "12px",
                  width: "12px",
                }}
              />
            ) : null}
            {isRefunding ? "Refunding..." : "Refund"}
          </button>
        </span>
      </span>
    </div>
  );
}

function EarnTransactionsEmptyState() {
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
        <ReceiptText size={22} strokeWidth={1.8} />
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
        No transactions yet
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
        Earn deposits and withdrawals will appear here.
      </span>
    </div>
  );
}

function getEarnMascotIdlePhrases(hasCurrentPosition: boolean) {
  return hasCurrentPosition
    ? EARN_MASCOT_IDLE_PHRASES.filter(
        (phrase) => phrase.id !== TURN_ON_EARN_MASCOT_PHRASE_ID
      )
    : EARN_MASCOT_IDLE_PHRASES;
}

function chooseEarnMascotPhraseIndex(phraseCount: number) {
  if (phraseCount < 2) {
    return 0;
  }

  if (typeof window === "undefined") {
    return 0;
  }

  return Math.floor(Math.random() * phraseCount);
}

function EarnMascotPanel({
  hasCurrentPosition = false,
  isBusy = false,
  onExperimentalModeToggle,
}: {
  hasCurrentPosition?: boolean;
  isBusy?: boolean;
  onExperimentalModeToggle?: () => void;
}) {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [visibleLength, setVisibleLength] = useState(0);
  const experimentalToggleClickCountRef = useRef(0);
  const experimentalToggleResetTimeoutRef = useRef<number | null>(null);
  const idlePhrases = getEarnMascotIdlePhrases(hasCurrentPosition);
  const activePhrases = isBusy ? EARN_MASCOT_BUSY_PHRASES : idlePhrases;
  const activePhraseCount = activePhrases.length;
  const activePhrase =
    activePhrases[phraseIndex % activePhraseCount] ??
    EARN_MASCOT_IDLE_PHRASES[0];
  const visibleText = activePhrase.text.slice(0, visibleLength);
  const isTextComplete = visibleLength >= activePhrase.text.length;

  useEffect(() => {
    setPhraseIndex(chooseEarnMascotPhraseIndex(activePhraseCount));
  }, [activePhraseCount, hasCurrentPosition, isBusy]);

  const resetExperimentalToggleClicks = useCallback(() => {
    experimentalToggleClickCountRef.current = 0;
    if (experimentalToggleResetTimeoutRef.current !== null) {
      window.clearTimeout(experimentalToggleResetTimeoutRef.current);
      experimentalToggleResetTimeoutRef.current = null;
    }
  }, []);

  const handleMascotClick = useCallback(() => {
    if (!onExperimentalModeToggle) {
      return;
    }

    experimentalToggleClickCountRef.current += 1;

    if (
      experimentalToggleClickCountRef.current >=
      EARN_MASCOT_EXPERIMENTAL_TOGGLE_CLICK_COUNT
    ) {
      resetExperimentalToggleClicks();
      onExperimentalModeToggle();
      return;
    }

    if (experimentalToggleResetTimeoutRef.current !== null) {
      window.clearTimeout(experimentalToggleResetTimeoutRef.current);
    }
    experimentalToggleResetTimeoutRef.current = window.setTimeout(
      resetExperimentalToggleClicks,
      EARN_MASCOT_EXPERIMENTAL_TOGGLE_RESET_MS
    );
  }, [onExperimentalModeToggle, resetExperimentalToggleClicks]);

  useEffect(
    () => resetExperimentalToggleClicks,
    [resetExperimentalToggleClicks]
  );

  useEffect(() => {
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setVisibleLength(activePhrase.text.length);
      return;
    }

    setVisibleLength(0);

    let index = 0;
    let intervalId: number | null = null;
    const startTimeoutId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        index = Math.min(activePhrase.text.length, index + 1);
        setVisibleLength(index);

        if (index >= activePhrase.text.length && intervalId !== null) {
          window.clearInterval(intervalId);
        }
      }, EARN_MASCOT_STREAM_INTERVAL_MS);
    }, EARN_MASCOT_STREAM_DELAY_MS);

    return () => {
      window.clearTimeout(startTimeoutId);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [activePhrase.id, activePhrase.text]);

  return (
    <section aria-label="Loyal mascot" className="earn-mascot-panel">
      <style jsx>{`
        .earn-mascot-panel {
          align-items: center;
          background: #fff;
          border-top: 1px solid rgba(0, 0, 0, 0.06);
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-height: 0;
          overflow: hidden;
          padding: 18px 22px 24px;
          position: relative;
        }
        .earn-mascot-stage {
          flex: 0 0 auto;
          height: clamp(220px, 82%, 278px);
          max-width: 360px;
          position: relative;
          width: 100%;
        }
        .earn-mascot-bubble {
          background: #fff;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 18px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08),
            0 2px 6px rgba(0, 0, 0, 0.04);
          box-sizing: border-box;
          color: rgba(0, 0, 0, 0.86);
          font-family: var(--font-geist-sans), sans-serif;
          font-size: 15px;
          font-weight: 500;
          line-height: 21px;
          max-width: 100%;
          padding: 12px 16px;
          position: absolute;
          right: 0;
          top: 0;
          text-align: center;
          width: 100%;
          z-index: 2;
        }
        .earn-mascot-bubble::before {
          background: #fff;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
          border-right: 1px solid rgba(0, 0, 0, 0.08);
          bottom: -6px;
          content: "";
          height: 11px;
          position: absolute;
          right: 88px;
          transform: rotate(45deg);
          width: 11px;
        }
        .earn-mascot-bubble-content {
          display: block;
          position: relative;
        }
        .earn-mascot-bubble-measure {
          display: block;
          visibility: hidden;
        }
        .earn-mascot-bubble-stream {
          display: block;
          inset: 0;
          position: absolute;
          white-space: normal;
        }
        .earn-mascot-bubble-cursor {
          animation: earn-mascot-stream-cursor 0.8s step-end infinite;
          background: currentColor;
          border-radius: 9999px;
          display: inline-block;
          height: 1em;
          margin-left: 2px;
          transform: translateY(2px);
          width: 2px;
        }
        .earn-mascot-bubble-cursor[data-complete="true"] {
          animation: none;
          opacity: 0;
        }
        .earn-mascot-bubble-link {
          color: inherit;
          display: block;
          text-decoration: none;
        }
        .earn-mascot-bubble-link:hover {
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .earn-mascot-dog {
          align-items: center;
          background: transparent;
          border: none;
          cursor: pointer;
          display: flex;
          justify-content: center;
          padding: 0;
          position: absolute;
          right: 28px;
          top: 108px;
          width: clamp(128px, 40%, 148px);
        }
        .earn-mascot-dog :global(svg) {
          display: block;
          width: 100%;
          height: auto;
        }
        @keyframes earn-mascot-stream-cursor {
          0%,
          48% {
            opacity: 1;
          }
          49%,
          100% {
            opacity: 0;
          }
        }
        @media (max-width: 760px) {
          .earn-mascot-panel {
            display: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .earn-mascot-bubble-cursor {
            animation: none;
          }
        }
      `}</style>
      <div className="earn-mascot-stage">
        <div
          aria-label={activePhrase.text}
          className="earn-mascot-bubble"
          key={activePhrase.id}
        >
          {activePhrase.href ? (
            <a
              aria-label={activePhrase.text}
              className="earn-mascot-bubble-link"
              href={activePhrase.href}
              rel="noreferrer"
              target="_blank"
            >
              <span className="earn-mascot-bubble-content">
                <span aria-hidden="true" className="earn-mascot-bubble-measure">
                  {activePhrase.text}
                </span>
                <span aria-hidden="true" className="earn-mascot-bubble-stream">
                  {visibleText}
                  <span
                    className="earn-mascot-bubble-cursor"
                    data-complete={isTextComplete}
                  />
                </span>
              </span>
            </a>
          ) : (
            <span
              aria-label={activePhrase.text}
              className="earn-mascot-bubble-content"
            >
              <span aria-hidden="true" className="earn-mascot-bubble-measure">
                {activePhrase.text}
              </span>
              <span aria-hidden="true" className="earn-mascot-bubble-stream">
                {visibleText}
                <span
                  className="earn-mascot-bubble-cursor"
                  data-complete={isTextComplete}
                />
              </span>
            </span>
          )}
        </div>
        <button
          aria-label="Loyal mascot"
          className="earn-mascot-dog"
          onClick={handleMascotClick}
          type="button"
        >
          <DogWithMood disableClickMood disableIdleMood />
        </button>
      </div>
    </section>
  );
}

// Mount-time reveal for rows that arrive after the initial load: the slot
// expands first (pushing the rest of the list down), then the content fades
// in. Rows present at mount render statically (`initial: false`).
function EnterReveal({
  children,
  isEntering,
}: {
  children: ReactNode;
  isEntering: boolean;
}) {
  return (
    <motion.div
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      initial={isEntering ? { height: 0, opacity: 0 } : false}
      layout
      style={{ overflow: "hidden", width: "100%" }}
      transition={{
        height: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
        opacity: { duration: 0.22, ease: "easeOut" },
      }}
    >
      {children}
    </motion.div>
  );
}

export function groupEarnTransactions(
  items: EarnTransactionItem[],
  timeZone?: string | null
) {
  const groups: { date: string; items: EarnTransactionItem[] }[] = [];
  for (const item of items) {
    const date =
      formatEarnTransactionDateGroup(
        getEarnTransactionConfirmedAt(item),
        timeZone
      ) ?? item.dateGroup;
    const last = groups[groups.length - 1];
    if (last && last.date === date) {
      last.items.push(item);
    } else {
      groups.push({ date, items: [item] });
    }
  }
  return groups;
}

export function EarnTransactionsPane({
  hasCurrentPosition = false,
  isAutodepositConfigured = false,
  isBalanceHidden = false,
  isExecutingScheduledSweep = false,
  mascotPaneHeight = "38%",
  onExperimentalModeToggle,
  onExecuteScheduledSweep,
  onRefreshScheduledSweeps,
  onSelectTransaction,
  pendingScheduledSweep = null,
  refreshKey = 0,
  scheduledSweepExecuteError = null,
  scheduledSweeps = [],
  showPolicyRefundScan = false,
  settingsPda,
  solanaEnv,
  topInset = 0,
  walletAddress,
}: {
  hasCurrentPosition?: boolean;
  isAutodepositConfigured?: boolean;
  isBalanceHidden?: boolean;
  isExecutingScheduledSweep?: boolean;
  mascotPaneHeight?: string;
  onExperimentalModeToggle?: () => void;
  onExecuteScheduledSweep?: () => void;
  onRefreshScheduledSweeps?: () => Promise<void> | void;
  onSelectTransaction: (detail: TransactionDetail) => void;
  pendingScheduledSweep?: PendingScheduledSweepPreview | null;
  refreshKey?: number;
  scheduledSweepExecuteError?: string | null;
  scheduledSweeps?: LoadedEarnAutodepositScheduledSweep[];
  showPolicyRefundScan?: boolean;
  settingsPda: string | null | undefined;
  solanaEnv: string;
  topInset?: number;
  walletAddress: string | null | undefined;
}) {
  const { isAuthenticated, isHydrated } = useAuthSession();
  const { connection } = useConnection();
  const wallet = useWallet();
  const [transactions, setTransactions] = useState<EarnTransactionItem[]>([]);
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [renderedScheduledSweeps, setRenderedScheduledSweeps] = useState<
    LoadedEarnAutodepositScheduledSweep[]
  >(() => scheduledSweeps);
  const feedKeyRef = useRef<string | null>(null);
  const knownTransactionIdsRef = useRef<Set<string> | null>(null);
  const loadRequestSeqRef = useRef(0);
  const renderedScheduledSweepsFeedKeyRef = useRef<string | null>(null);
  const scheduledSweepsLengthRef = useRef(scheduledSweeps.length);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [
    scheduledSweepExecutionRequestedAtMs,
    setScheduledSweepExecutionRequestedAtMs,
  ] = useState<number | null>(null);
  const [earnActionRefreshRequestedAtMs, setEarnActionRefreshRequestedAtMs] =
    useState<number | null>(null);
  const lastRefreshKeyRef = useRef<number | null>(null);
  const [policyRefundPolicies, setPolicyRefundPolicies] = useState<
    EarnPolicyRefundScanPolicy[] | null
  >(null);
  const [isScanningPolicies, setIsScanningPolicies] = useState(false);
  const [refundingPolicyAccount, setRefundingPolicyAccount] = useState<
    string | null
  >(null);
  const [policyRefundError, setPolicyRefundError] = useState<string | null>(
    null
  );
  const isAwaitingScheduledSweepExecution =
    scheduledSweepExecutionRequestedAtMs !== null;

  useEffect(() => {
    scheduledSweepsLengthRef.current = scheduledSweeps.length;
  }, [scheduledSweeps.length]);

  useEffect(() => {
    if (lastRefreshKeyRef.current === refreshKey) {
      return;
    }

    const previousRefreshKey = lastRefreshKeyRef.current;
    lastRefreshKeyRef.current = refreshKey;
    if (previousRefreshKey !== null || refreshKey > 0) {
      setEarnActionRefreshRequestedAtMs(Date.now());
    }
  }, [refreshKey]);

  useEffect(() => {
    const feedKey = `${solanaEnv}:${settingsPda ?? ""}:${walletAddress ?? ""}`;
    if (renderedScheduledSweepsFeedKeyRef.current !== feedKey) {
      renderedScheduledSweepsFeedKeyRef.current = feedKey;
      setRenderedScheduledSweeps(scheduledSweeps);
      return;
    }

    if (!isAutodepositConfigured) {
      setRenderedScheduledSweeps([]);
      return;
    }

    if (scheduledSweeps.length > 0) {
      setRenderedScheduledSweeps(scheduledSweeps);
      return;
    }

    if (
      scheduledSweepExecutionRequestedAtMs === null ||
      scheduledSweepExecuteError
    ) {
      setRenderedScheduledSweeps([]);
      return;
    }

    setRenderedScheduledSweeps((current) =>
      current.filter(
        (sweep) =>
          !hasBalanceSweepActivityForScheduledSweep(transactions, sweep)
      )
    );
  }, [
    isAutodepositConfigured,
    scheduledSweepExecuteError,
    scheduledSweepExecutionRequestedAtMs,
    scheduledSweeps,
    settingsPda,
    solanaEnv,
    transactions,
    walletAddress,
  ]);

  useEffect(() => {
    if (scheduledSweepExecuteError) {
      setScheduledSweepExecutionRequestedAtMs(null);
    }
  }, [scheduledSweepExecuteError]);

  const handleExecuteScheduledSweep = useCallback(() => {
    if (
      isAwaitingScheduledSweepExecution ||
      isExecutingScheduledSweep ||
      !onExecuteScheduledSweep
    ) {
      return;
    }

    setScheduledSweepExecutionRequestedAtMs(Date.now());
    void Promise.resolve(onExecuteScheduledSweep()).catch(() => {
      setScheduledSweepExecutionRequestedAtMs(null);
    });
  }, [
    isAwaitingScheduledSweepExecution,
    isExecutingScheduledSweep,
    onExecuteScheduledSweep,
  ]);

  useEffect(() => {
    // Wait for the auth session to hydrate and become active before fetching.
    // Firing right after wallet connect (before the session cookie lands) 401s
    // with "No active auth session" and would leave the pane stuck until a full
    // reload. Keying on isAuthenticated lets it self-heal once the session is
    // ready; the loading skeleton shows in the meantime.
    if (!isHydrated) {
      return;
    }

    if (!isAuthenticated || !settingsPda || !walletAddress) {
      setIsLoading(false);
      setTransactions([]);
      setEnteringIds(new Set());
      setErrorMessage(null);
      setPolicyRefundPolicies(null);
      setPolicyRefundError(null);
      feedKeyRef.current = null;
      knownTransactionIdsRef.current = null;
      setScheduledSweepExecutionRequestedAtMs(null);
      setEarnActionRefreshRequestedAtMs(null);
      return;
    }

    let isMounted = true;
    const feedKey = `${solanaEnv}:${settingsPda}:${walletAddress}`;
    if (feedKeyRef.current !== feedKey) {
      feedKeyRef.current = feedKey;
      knownTransactionIdsRef.current = null;
    }

    const refreshScheduledSweeps = () => {
      void Promise.resolve(onRefreshScheduledSweeps?.()).catch((error) => {
        console.warn(
          "[earn-transactions] failed to refresh scheduled sweeps",
          error
        );
      });
    };

    const hasConfirmedRequestedSweep = (items: EarnTransactionItem[]) => {
      if (scheduledSweepExecutionRequestedAtMs === null) {
        return false;
      }

      return items.some((item) => {
        if (item.kind !== "balance_sweep") {
          return false;
        }

        const confirmedAt = parseEarnTransactionInstant(
          getEarnTransactionConfirmedAt(item)
        );
        return (
          confirmedAt !== null &&
          confirmedAt.getTime() >= scheduledSweepExecutionRequestedAtMs - 5_000
        );
      });
    };
    const hasConfirmedRequestedEarnAction = (items: EarnTransactionItem[]) => {
      if (earnActionRefreshRequestedAtMs === null) {
        return false;
      }

      return items.some((item) => {
        if (item.kind !== "deposit" && item.kind !== "withdraw") {
          return false;
        }

        const confirmedAt = parseEarnTransactionInstant(
          getEarnTransactionConfirmedAt(item)
        );
        return (
          confirmedAt !== null &&
          confirmedAt.getTime() >= earnActionRefreshRequestedAtMs - 5_000
        );
      });
    };

    const applyTransactions = (items: EarnTransactionItem[]) => {
      const previousIds = knownTransactionIdsRef.current;
      const freshIds =
        previousIds === null
          ? []
          : items
              .filter((item) => !previousIds.has(item.id))
              .map((item) => item.id);
      if (
        previousIds !== null &&
        freshIds.length === 0 &&
        items.length === previousIds.size
      ) {
        if (
          hasConfirmedRequestedSweep(items) &&
          scheduledSweepsLengthRef.current === 0
        ) {
          setScheduledSweepExecutionRequestedAtMs(null);
        }
        if (hasConfirmedRequestedEarnAction(items)) {
          setEarnActionRefreshRequestedAtMs(null);
        }
        // Same id set as the last render — skip the no-op state update.
        return;
      }
      knownTransactionIdsRef.current = new Set(items.map((item) => item.id));
      setTransactions(items);
      setEnteringIds(new Set(freshIds));

      if (
        hasConfirmedRequestedSweep(items) &&
        scheduledSweepsLengthRef.current === 0
      ) {
        setScheduledSweepExecutionRequestedAtMs(null);
      }
      if (hasConfirmedRequestedEarnAction(items)) {
        setEarnActionRefreshRequestedAtMs(null);
      }
    };

    const invalidateTransactionsCache = () => {
      invalidateEarnTransactionsCache({
        settingsPda,
        solanaEnv,
        walletAddress,
      });
    };

    const loadTransactions = async ({
      fresh = false,
      silent,
    }: {
      fresh?: boolean;
      silent: boolean;
    }) => {
      const requestSeq = (loadRequestSeqRef.current += 1);
      if (!silent) {
        setIsLoading(true);
        setErrorMessage(null);
      }
      if (fresh) {
        invalidateTransactionsCache();
      }

      try {
        const payload = await fetchEarnTransactions({
          settingsPda,
          solanaEnv,
          walletAddress,
        });

        if (isMounted && requestSeq === loadRequestSeqRef.current) {
          applyTransactions(payload.transactions);
          setErrorMessage(null);
        }
      } catch (error) {
        console.warn("[earn-transactions] failed to load transactions", error);
        // Silent polls keep whatever is on screen; only the initial load
        // surfaces the error state.
        if (isMounted && requestSeq === loadRequestSeqRef.current && !silent) {
          setTransactions([]);
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Failed to load earn transactions."
          );
        }
      } finally {
        if (isMounted && requestSeq === loadRequestSeqRef.current && !silent) {
          setIsLoading(false);
        }
      }
    };

    const nowMs = Date.now();
    const isScheduledSweepFastPolling =
      scheduledSweepExecutionRequestedAtMs !== null &&
      nowMs - scheduledSweepExecutionRequestedAtMs <
        EARN_TRANSACTIONS_FAST_POLL_WINDOW_MS;
    const isEarnActionFastPolling =
      earnActionRefreshRequestedAtMs !== null &&
      nowMs - earnActionRefreshRequestedAtMs <
        EARN_TRANSACTIONS_FAST_POLL_WINDOW_MS;
    const isFastPolling =
      isScheduledSweepFastPolling || isEarnActionFastPolling;
    const pollIntervalMs = isFastPolling
      ? EARN_TRANSACTIONS_FAST_POLL_INTERVAL_MS
      : EARN_TRANSACTIONS_POLL_INTERVAL_MS;

    if (
      scheduledSweepExecutionRequestedAtMs !== null &&
      !isScheduledSweepFastPolling
    ) {
      setScheduledSweepExecutionRequestedAtMs(null);
    }
    if (earnActionRefreshRequestedAtMs !== null && !isEarnActionFastPolling) {
      setEarnActionRefreshRequestedAtMs(null);
    }

    void loadTransactions({
      fresh: isFastPolling,
      silent: knownTransactionIdsRef.current !== null,
    });
    refreshScheduledSweeps();

    // Pseudo-realtime: poll the cached fetcher so confirmed Earn actions appear
    // without a reload. Refresh loaded Earn state on the same cadence because
    // scheduled sweep lots are created by the background worker after setup.
    const intervalId = window.setInterval(() => {
      const intervalNowMs = Date.now();
      const shouldFastPollScheduledSweeps =
        scheduledSweepExecutionRequestedAtMs !== null &&
        intervalNowMs - scheduledSweepExecutionRequestedAtMs <
          EARN_TRANSACTIONS_FAST_POLL_WINDOW_MS;
      const shouldFastPollEarnAction =
        earnActionRefreshRequestedAtMs !== null &&
        intervalNowMs - earnActionRefreshRequestedAtMs <
          EARN_TRANSACTIONS_FAST_POLL_WINDOW_MS;
      const shouldFastPoll =
        shouldFastPollScheduledSweeps || shouldFastPollEarnAction;
      if (
        scheduledSweepExecutionRequestedAtMs !== null &&
        !shouldFastPollScheduledSweeps
      ) {
        setScheduledSweepExecutionRequestedAtMs(null);
      }
      if (
        earnActionRefreshRequestedAtMs !== null &&
        !shouldFastPollEarnAction
      ) {
        setEarnActionRefreshRequestedAtMs(null);
      }
      void loadTransactions({ fresh: shouldFastPoll, silent: true });
      refreshScheduledSweeps();
    }, pollIntervalMs);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [
    isAuthenticated,
    earnActionRefreshRequestedAtMs,
    isHydrated,
    onRefreshScheduledSweeps,
    refreshKey,
    scheduledSweepExecutionRequestedAtMs,
    settingsPda,
    solanaEnv,
    walletAddress,
  ]);

  const displayTimeZone = resolveEarnTransactionDisplayTimeZone();
  const groups = groupEarnTransactions(transactions, displayTimeZone);
  const visiblePendingScheduledSweep = resolveVisiblePendingScheduledSweep(
    renderedScheduledSweeps,
    pendingScheduledSweep
  );
  const showScheduledSweeps = shouldShowScheduledSweepsSection(
    renderedScheduledSweeps,
    visiblePendingScheduledSweep
  );
  const showPolicyRefunds =
    showPolicyRefundScan && policyRefundPolicies !== null;
  const hasPinnedContent = showPolicyRefunds || showScheduledSweeps;
  const isPolicyScanDisabled =
    isScanningPolicies || !isAuthenticated || !settingsPda || !walletAddress;
  const isMascotBusy =
    isLoading ||
    isScanningPolicies ||
    refundingPolicyAccount !== null ||
    isExecutingScheduledSweep ||
    isAwaitingScheduledSweepExecution ||
    scheduledSweepExecutionRequestedAtMs !== null ||
    earnActionRefreshRequestedAtMs !== null;

  const handleSelect = (item: EarnTransactionItem) => {
    onSelectTransaction(buildEarnTransactionDetail(item, displayTimeZone));
  };

  const readApiError = async (response: Response, fallback: string) => {
    try {
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      return payload.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  };

  const handleScanPolicies = async () => {
    setIsScanningPolicies(true);
    setPolicyRefundError(null);
    try {
      const response = await fetch(
        "/api/smart-accounts/yield-optimization/policy-refunds/scan",
        {
          method: "POST",
        }
      );
      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Failed to scan policies.")
        );
      }
      const payload = (await response.json()) as EarnPolicyRefundScanResponse;
      setPolicyRefundPolicies(payload.policies);
    } catch (error) {
      console.warn("[earn-policy-refunds] scan failed", error);
      setPolicyRefundPolicies([]);
      setPolicyRefundError(
        error instanceof Error ? error.message : "Failed to scan policies."
      );
    } finally {
      setIsScanningPolicies(false);
    }
  };

  const handleRefundPolicy = async (policy: EarnPolicyRefundScanPolicy) => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setPolicyRefundError("Connect a wallet before refunding policy rent.");
      return;
    }

    setRefundingPolicyAccount(policy.account);
    setPolicyRefundError(null);
    try {
      const response = await fetch(
        "/api/smart-accounts/yield-optimization/policy-refunds/prepare",
        {
          body: JSON.stringify({ policyAccount: policy.account }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      );
      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Failed to prepare policy refund.")
        );
      }
      const payload =
        (await response.json()) as EarnPolicyRefundPrepareResponse;
      const preparedRefund = hydratePreparedEarnPolicyRefund(
        payload.preparedRefund
      );
      await sendPreparedWithWallet({
        confirm: true,
        connection,
        prepared: preparedRefund.prepared,
        wallet: {
          publicKey: wallet.publicKey,
          signTransaction: wallet.signTransaction,
        },
      });
      await handleScanPolicies();
    } catch (error) {
      console.warn("[earn-policy-refunds] refund failed", error);
      setPolicyRefundError(
        error instanceof Error ? error.message : "Failed to refund policy rent."
      );
    } finally {
      setRefundingPolicyAccount(null);
    }
  };

  const railStyle = {
    "--earn-mascot-pane-height": mascotPaneHeight,
    paddingTop: topInset,
  } as CSSProperties & { "--earn-mascot-pane-height": string };

  return (
    <div className="earn-activity-rail" style={railStyle}>
      <style jsx>{`
        .earn-activity-rail {
          background: #fff;
          display: grid;
          grid-template-rows:
            minmax(300px, 1fr)
            clamp(250px, var(--earn-mascot-pane-height), 380px);
          height: 100%;
          min-height: 0;
          overflow: hidden;
          width: 100%;
        }
        .earn-transactions-region {
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: hidden;
          width: 100%;
        }
        .earn-transactions-feed {
          display: flex;
          flex: 1;
          flex-direction: column;
          min-height: 0;
          overflow-y: auto;
          padding: 8px;
          scrollbar-width: none;
          width: 100%;
        }
        .earn-tx-row:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .earn-tx-row:focus-visible {
          outline: 2px solid rgba(249, 54, 60, 0.45);
          outline-offset: -2px;
        }
        .earn-scheduled-execute-btn {
          transition: background 0.15s ease, transform 0.15s ease;
        }
        .earn-scheduled-execute-btn:hover {
          background: #e72f34 !important;
          transform: translateY(-1px);
        }
        .earn-scheduled-execute-btn:active {
          transform: translateY(0);
        }
        .earn-scheduled-spinner {
          animation: earn-scheduled-spin 0.8s linear infinite;
        }
        @keyframes earn-scheduled-spin {
          to {
            transform: rotate(360deg);
          }
        }
        @media (max-width: 760px) {
          .earn-activity-rail {
            display: flex;
            flex-direction: column;
          }
          .earn-transactions-region {
            flex: 1;
          }
        }
      `}</style>
      {/* SVG pixelation filters */}
      <svg
        aria-hidden="true"
        height="0"
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          overflow: "hidden",
        }}
        width="0"
      >
        <defs>
          <filter id="rs-pixelate-sm" x="0" y="0" width="100%" height="100%">
            <feFlood x="3" y="3" height="2" width="2" />
            <feComposite width="8" height="8" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="4" />
          </filter>
        </defs>
      </svg>
      <section className="earn-transactions-region">
        <div
          style={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between",
            padding: "12px 20px 8px",
            width: "100%",
          }}
        >
          <h2
            style={{
              color: "#000",
              flex: 1,
              fontFamily: font,
              fontSize: "20px",
              fontWeight: 600,
              lineHeight: "28px",
              margin: 0,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Transactions
          </h2>
          {showPolicyRefundScan ? (
            <button
              disabled={isPolicyScanDisabled}
              onClick={() => void handleScanPolicies()}
              style={{
                background: isPolicyScanDisabled
                  ? "#F97B80"
                  : LOYAL_EARN_BRAND_COLOR,
                border: "none",
                borderRadius: "9999px",
                color: "#fff",
                cursor: isPolicyScanDisabled ? "default" : "pointer",
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 500,
                lineHeight: "18px",
                padding: "6px 12px",
                whiteSpace: "nowrap",
              }}
              type="button"
            >
              {isScanningPolicies ? "Scanning..." : "Scan policies"}
            </button>
          ) : null}
        </div>

        <div className="earn-transactions-feed">
          {isLoading && !hasPinnedContent ? (
            <EarnTransactionsLoadingState />
          ) : errorMessage && !hasPinnedContent ? (
            <EarnTransactionsErrorState message={errorMessage} />
          ) : transactions.length === 0 &&
            !showScheduledSweeps &&
            !showPolicyRefunds ? (
            <EarnTransactionsEmptyState />
          ) : (
            <>
              {showPolicyRefunds ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    width: "100%",
                  }}
                >
                  <TransactionsSectionHeader label="Policies" />
                  {policyRefundPolicies.length === 0 ? (
                    <p
                      style={{
                        color: secondary,
                        fontFamily: font,
                        fontSize: "13px",
                        lineHeight: "16px",
                        margin: "0",
                        padding: "0 12px 12px",
                      }}
                    >
                      No open policies found.
                    </p>
                  ) : (
                    policyRefundPolicies.map((policy) => (
                      <PolicyRefundRow
                        isRefunding={refundingPolicyAccount === policy.account}
                        key={policy.account}
                        onRefund={
                          policy.canRefund
                            ? () => void handleRefundPolicy(policy)
                            : undefined
                        }
                        policy={policy}
                      />
                    ))
                  )}
                  {policyRefundError ? (
                    <p
                      style={{
                        color: LOYAL_EARN_BRAND_COLOR,
                        fontFamily: font,
                        fontSize: "13px",
                        lineHeight: "16px",
                        margin: "0",
                        padding: "0 12px 10px 56px",
                      }}
                    >
                      {policyRefundError}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {showScheduledSweeps ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    width: "100%",
                  }}
                >
                  <TransactionsSectionHeader label="Scheduled" />
                  {visiblePendingScheduledSweep ? (
                    <ScheduledTransactionRow
                      displayTimeZone={displayTimeZone}
                      isBalanceHidden={isBalanceHidden}
                      isPending
                      sweep={visiblePendingScheduledSweep}
                    />
                  ) : null}
                  {renderedScheduledSweeps.map((sweep) => (
                    <ScheduledTransactionRow
                      displayTimeZone={displayTimeZone}
                      isBalanceHidden={isBalanceHidden}
                      isAwaitingExecution={
                        isAwaitingScheduledSweepExecution &&
                        !isExecutingScheduledSweep
                      }
                      isExecuting={
                        isExecutingScheduledSweep ||
                        isAwaitingScheduledSweepExecution
                      }
                      key={sweep.id}
                      onExecuteNow={handleExecuteScheduledSweep}
                      sweep={sweep}
                    />
                  ))}
                  {scheduledSweepExecuteError ? (
                    <p
                      style={{
                        color: LOYAL_EARN_BRAND_COLOR,
                        fontFamily: font,
                        fontSize: "13px",
                        lineHeight: "16px",
                        margin: "0",
                        padding: "0 12px 10px 56px",
                      }}
                    >
                      {scheduledSweepExecuteError}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {isLoading ? (
                <EarnTransactionsLoadingState />
              ) : errorMessage ? (
                <EarnTransactionsErrorState message={errorMessage} />
              ) : (
                groups.map((group) => (
                  <div
                    key={group.date}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                    }}
                  >
                    <EnterReveal
                      isEntering={group.items.every((item) =>
                        enteringIds.has(item.id)
                      )}
                    >
                      <TransactionsSectionHeader label={group.date} />
                    </EnterReveal>
                    <AnimatePresence initial={false}>
                      {group.items.map((item) => (
                        <EnterReveal
                          isEntering={enteringIds.has(item.id)}
                          key={item.id}
                        >
                          <EarnTransactionRow
                            displayTimeZone={displayTimeZone}
                            isBalanceHidden={isBalanceHidden}
                            item={item}
                            onSelect={handleSelect}
                          />
                        </EnterReveal>
                      ))}
                    </AnimatePresence>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </section>
      <EarnMascotPanel
        hasCurrentPosition={hasCurrentPosition}
        isBusy={isMascotBusy}
        onExperimentalModeToggle={onExperimentalModeToggle}
      />
    </div>
  );
}
