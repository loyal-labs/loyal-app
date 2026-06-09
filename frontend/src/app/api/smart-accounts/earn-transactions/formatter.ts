import type { UserYieldPositionHistoryEventRecord } from "@/lib/yield-optimization/yield-deposit-repository.server";

const MAIN_USDC_LABEL = "Main USDC";
const EARN_VAULT_LABEL = "Earn vault";
const MAIN_USDC_ICON = "/agents/Agent-01.svg";
const EARN_VAULT_ICON = null;

export type EarnTransactionKind =
  | "deposit"
  | "reconciliation"
  | "rebalance"
  | "withdraw";

export type SerializedEarnTransaction = {
  amount: string;
  confirmedSlot: string;
  dateGroup: string;
  destination: {
    icon: string | null;
    label: string;
  };
  id: string;
  kind: EarnTransactionKind;
  rawAmount: string;
  signature: string;
  source: {
    icon: string | null;
    label: string;
  };
  timestamp: string;
};

function formatExactUsdcAmount(rawAmount: bigint): string {
  const sign = rawAmount < BigInt(0) ? "-" : "";
  const absolute = rawAmount < BigInt(0) ? -rawAmount : rawAmount;
  const whole = absolute / BigInt(1_000_000);
  const fraction = (absolute % BigInt(1_000_000)).toString().padStart(6, "0");

  return `${sign}${whole.toString()}.${fraction} USDC`;
}

function formatDisplayUsdcAmount(
  rawAmount: bigint,
  direction: "in" | "neutral" | "out"
): string {
  const sign = direction === "neutral" ? "" : direction === "in" ? "+" : "-";
  const absolute = rawAmount < BigInt(0) ? -rawAmount : rawAmount;
  const cents =
    absolute === BigInt(0)
      ? BigInt(0)
      : (absolute + BigInt(9_999)) / BigInt(10_000);
  const whole = cents / BigInt(100);
  const fraction = (cents % BigInt(100)).toString().padStart(2, "0");

  return `${sign}${whole.toString()}.${fraction} USDC`;
}

function formatDateGroup(date: Date): string {
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function shortReserveLabel(reserve: string | null | undefined): string {
  if (!reserve) {
    return "Unknown reserve";
  }
  if (reserve.length <= 10) {
    return reserve;
  }
  return `${reserve.slice(0, 4)}...${reserve.slice(-4)}`;
}

function serializeKind(
  event: UserYieldPositionHistoryEventRecord
): EarnTransactionKind {
  if (event.type === "withdrawal") {
    return "withdraw";
  }
  if (event.type === "rebalance") {
    return "rebalance";
  }
  if (event.type === "reconciliation") {
    return "reconciliation";
  }
  return "deposit";
}

function resolveTransactionAmountRaw(args: {
  event: UserYieldPositionHistoryEventRecord;
  kind: EarnTransactionKind;
}): bigint {
  const { event, kind } = args;
  if (kind === "deposit" || kind === "withdraw") {
    return event.principalDeltaRaw ?? event.amountRaw;
  }

  return event.amountRaw;
}

export function serializeEarnTransactionEvent(
  event: UserYieldPositionHistoryEventRecord
): SerializedEarnTransaction {
  const kind = serializeKind(event);
  const direction =
    kind === "deposit" ? "in" : kind === "withdraw" ? "out" : "neutral";
  const transactionAmountRaw = resolveTransactionAmountRaw({ event, kind });
  const isMovement = kind === "rebalance" || kind === "reconciliation";
  const sourceLabel = isMovement
    ? shortReserveLabel(event.sourceReserve)
    : kind === "deposit"
      ? MAIN_USDC_LABEL
      : EARN_VAULT_LABEL;
  const destinationLabel = isMovement
    ? shortReserveLabel(event.destinationReserve)
    : kind === "deposit"
      ? EARN_VAULT_LABEL
      : MAIN_USDC_LABEL;

  return {
    amount: formatDisplayUsdcAmount(transactionAmountRaw, direction),
    confirmedSlot: event.confirmedSlot.toString(),
    dateGroup: formatDateGroup(event.confirmedAt),
    destination: {
      icon: isMovement || kind === "deposit" ? EARN_VAULT_ICON : MAIN_USDC_ICON,
      label: destinationLabel,
    },
    id: event.signature,
    kind,
    rawAmount: formatExactUsdcAmount(transactionAmountRaw),
    signature: event.signature,
    source: {
      icon: kind === "deposit" ? MAIN_USDC_ICON : EARN_VAULT_ICON,
      label: sourceLabel,
    },
    timestamp: formatTimestamp(event.confirmedAt),
  };
}
