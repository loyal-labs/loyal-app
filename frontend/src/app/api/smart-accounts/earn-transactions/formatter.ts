import type { EarnAutodepositHistoryEventRecord } from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import {
  resolveEarnTransactionMarketIcon,
  resolveEarnTransactionMarketLabel,
} from "@/lib/yield-optimization/earn-position-display";
import type { UserYieldPositionHistoryEventRecord } from "@/lib/yield-optimization/yield-deposit-repository.server";

const AUTODEPOSIT_LABEL = "Autodeposit";
const MAIN_USDC_LABEL = "Main";
const EARN_VAULT_LABEL = "Earn";
const MAIN_USDC_ICON = "/agents/Agent-01.svg";
const EARN_VAULT_ICON = null;

export type EarnTransactionKind =
  | "autodeposit_action"
  | "balance_sweep"
  | "deposit"
  | "reconciliation"
  | "rebalance"
  | "withdraw";

export type EarnTransactionEvent =
  | EarnAutodepositHistoryEventRecord
  | UserYieldPositionHistoryEventRecord;

export type SerializedEarnTransaction = {
  amount: string;
  confirmedAt: string;
  confirmedSlot: string;
  dateGroup: string;
  destination: {
    icon: string | null;
    label: string;
  };
  eventType:
    | UserYieldPositionHistoryEventRecord["eventType"]
    | "autodeposit_closed"
    | "autodeposit_created"
    | "balance_sweep";
  id: string;
  kind: EarnTransactionKind;
  rawAmount: string;
  signature: string;
  sortTimestamp: string;
  source: {
    icon: string | null;
    label: string;
  };
  timestamp: string;
};

function isSelfMovement(transaction: SerializedEarnTransaction): boolean {
  return transaction.source.label === transaction.destination.label;
}

export function collapseDuplicateEarnRebalanceTransactions(
  transactions: SerializedEarnTransaction[]
): SerializedEarnTransaction[] {
  const collapsedBySignature = new Map<string, SerializedEarnTransaction>();
  const result: SerializedEarnTransaction[] = [];

  for (const transaction of transactions) {
    if (
      transaction.kind !== "rebalance" ||
      transaction.signature.length === 0
    ) {
      result.push(transaction);
      continue;
    }

    const existing = collapsedBySignature.get(transaction.signature);
    if (!existing) {
      collapsedBySignature.set(transaction.signature, transaction);
      result.push(transaction);
      continue;
    }

    if (isSelfMovement(existing) && !isSelfMovement(transaction)) {
      collapsedBySignature.set(transaction.signature, transaction);
      const index = result.findIndex((item) => item.id === existing.id);
      if (index >= 0) {
        result[index] = transaction;
      }
    }
  }

  return result;
}

function formatExactUsdcAmount(rawAmount: bigint): string {
  const sign = rawAmount < BigInt(0) ? "-" : "";
  const absolute = rawAmount < BigInt(0) ? -rawAmount : rawAmount;
  const whole = absolute / BigInt(1_000_000);
  const fraction = (absolute % BigInt(1_000_000)).toString().padStart(6, "0");

  return `${sign}$${whole.toString()}.${fraction}`;
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

  return `${sign}$${whole.toString()}.${fraction}`;
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

function serializeKind(
  event: UserYieldPositionHistoryEventRecord
): Exclude<EarnTransactionKind, "autodeposit_action" | "balance_sweep"> {
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
  kind: Exclude<EarnTransactionKind, "autodeposit_action" | "balance_sweep">;
}): bigint {
  const { event, kind } = args;
  if (kind === "withdraw") {
    return (
      event.withdrawnAmountRaw ?? event.principalDeltaRaw ?? event.amountRaw
    );
  }
  if (kind === "deposit") {
    return event.principalDeltaRaw ?? event.amountRaw;
  }
  if (event.principalAmountRaw > BigInt(0)) {
    return event.principalAmountRaw;
  }

  return event.amountRaw;
}

function serializeAutodepositActionEvent(
  event: EarnAutodepositHistoryEventRecord
): SerializedEarnTransaction {
  const isBalanceSweep = event.actionType === "balance_sweep";
  const transactionAmountRaw = isBalanceSweep ? event.amountRaw : BigInt(0);
  const isCreate = event.actionType === "create";

  return {
    amount: formatDisplayUsdcAmount(
      transactionAmountRaw,
      isBalanceSweep ? "in" : "neutral"
    ),
    confirmedAt: event.confirmedAt.toISOString(),
    confirmedSlot: event.confirmedSlot.toString(),
    dateGroup: formatDateGroup(event.confirmedAt),
    destination: {
      icon: isCreate || isBalanceSweep ? EARN_VAULT_ICON : null,
      label: isCreate || isBalanceSweep ? EARN_VAULT_LABEL : AUTODEPOSIT_LABEL,
    },
    eventType: isBalanceSweep
      ? "balance_sweep"
      : isCreate
      ? "autodeposit_created"
      : "autodeposit_closed",
    id: event.id,
    kind: isBalanceSweep ? "balance_sweep" : "autodeposit_action",
    rawAmount: formatExactUsdcAmount(transactionAmountRaw),
    signature: event.signature,
    sortTimestamp: event.confirmedAt.toISOString(),
    source: {
      icon: isBalanceSweep || isCreate ? MAIN_USDC_ICON : EARN_VAULT_ICON,
      label: isBalanceSweep
        ? MAIN_USDC_LABEL
        : isCreate
        ? MAIN_USDC_LABEL
        : EARN_VAULT_LABEL,
    },
    timestamp: formatTimestamp(event.confirmedAt),
  };
}

export function serializeEarnTransactionEvent(
  event: EarnTransactionEvent
): SerializedEarnTransaction {
  if (event.type === "autodeposit_action") {
    return serializeAutodepositActionEvent(event);
  }

  const kind = serializeKind(event);
  const direction =
    kind === "deposit" ? "in" : kind === "withdraw" ? "out" : "neutral";
  const transactionAmountRaw = resolveTransactionAmountRaw({ event, kind });
  const isMovement = kind === "rebalance" || kind === "reconciliation";
  const sourceLabel = isMovement
    ? resolveEarnTransactionMarketLabel({
        liquidityMint: event.sourceLiquidityMint,
        market: event.sourceMarket,
        reserve: event.sourceReserve,
      })
    : kind === "deposit"
    ? MAIN_USDC_LABEL
    : EARN_VAULT_LABEL;
  const destinationLabel = isMovement
    ? resolveEarnTransactionMarketLabel({
        liquidityMint: event.destinationLiquidityMint,
        market: event.destinationMarket,
        reserve: event.destinationReserve,
      })
    : kind === "deposit"
    ? EARN_VAULT_LABEL
    : MAIN_USDC_LABEL;
  // Rebalances move funds between two Kamino markets, so each side carries its
  // own market logo. Deposits/withdrawals keep the Main USDC ↔ Earn vault art.
  const sourceIcon = isMovement
    ? resolveEarnTransactionMarketIcon({ market: event.sourceMarket })
    : kind === "deposit"
    ? MAIN_USDC_ICON
    : EARN_VAULT_ICON;
  const destinationIcon = isMovement
    ? resolveEarnTransactionMarketIcon({ market: event.destinationMarket })
    : kind === "deposit"
    ? EARN_VAULT_ICON
    : MAIN_USDC_ICON;

  return {
    amount: formatDisplayUsdcAmount(transactionAmountRaw, direction),
    confirmedAt: event.confirmedAt.toISOString(),
    confirmedSlot: event.confirmedSlot.toString(),
    dateGroup: formatDateGroup(event.confirmedAt),
    destination: {
      icon: destinationIcon,
      label: destinationLabel,
    },
    eventType: event.eventType,
    id: `${event.signature}:${event.id.toString()}`,
    kind,
    rawAmount: formatExactUsdcAmount(transactionAmountRaw),
    signature: event.signature,
    sortTimestamp: event.confirmedAt.toISOString(),
    source: {
      icon: sourceIcon,
      label: sourceLabel,
    },
    timestamp: formatTimestamp(event.confirmedAt),
  };
}
