import type { EarnAutodepositHistoryEventRecord } from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import type { EarnLifecycleActivityEventRecord } from "@/lib/yield-optimization/earn-activity-repository.server";
import {
  resolveEarnTransactionMarketIcon,
  resolveEarnTransactionMarketLabel,
} from "@/lib/yield-optimization/earn-position-display";
import type { UserYieldPositionHistoryEventRecord } from "@/lib/yield-optimization/yield-deposit-repository.server";

const AUTODEPOSIT_LABEL = "Autodeposit";
const AUTOSWAP_LABEL = "Autoswap";
const MAIN_USDC_LABEL = "Main";
const EARN_VAULT_LABEL = "Earn";
const MAIN_USDC_ICON = "/agents/Agent-01.svg";
const EARN_VAULT_ICON = null;

export type EarnTransactionKind =
  | "autodeposit_action"
  | "autoswap_action"
  | "balance_sweep"
  | "deposit"
  | "reconciliation"
  | "rebalance"
  | "withdraw";

export type EarnTransactionEvent =
  | EarnAutodepositHistoryEventRecord
  | EarnLifecycleActivityEventRecord
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
    | "autoswap_closed"
    | "autoswap_created"
    | "balance_sweep";
  id: string;
  kind: EarnTransactionKind;
  // Mint of the position the event belongs to; null for autodeposit action
  // rows (USDC-only flows). Lets the client render per-mint coin icons.
  liquidityMint: string | null;
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
): Exclude<
  EarnTransactionKind,
  "autodeposit_action" | "autoswap_action" | "balance_sweep"
> {
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
  kind: Exclude<
    EarnTransactionKind,
    "autodeposit_action" | "autoswap_action" | "balance_sweep"
  >;
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
  return {
    amount: formatDisplayUsdcAmount(event.amountRaw, "in"),
    confirmedAt: event.confirmedAt.toISOString(),
    confirmedSlot: event.confirmedSlot.toString(),
    dateGroup: formatDateGroup(event.confirmedAt),
    destination: {
      icon: EARN_VAULT_ICON,
      label: EARN_VAULT_LABEL,
    },
    eventType: "balance_sweep",
    id: event.id,
    kind: "balance_sweep",
    liquidityMint: null,
    rawAmount: formatExactUsdcAmount(event.amountRaw),
    signature: event.signature,
    sortTimestamp: event.confirmedAt.toISOString(),
    source: {
      icon: MAIN_USDC_ICON,
      label: MAIN_USDC_LABEL,
    },
    timestamp: formatTimestamp(event.confirmedAt),
  };
}

function serializeLifecycleActionEvent(
  event: EarnLifecycleActivityEventRecord
): SerializedEarnTransaction {
  const isAutoswap = event.actionType.startsWith("autoswap_");
  const isCreate = event.actionType.endsWith("_created");
  const featureLabel = isAutoswap ? AUTOSWAP_LABEL : AUTODEPOSIT_LABEL;

  return {
    amount: formatDisplayUsdcAmount(BigInt(0), "neutral"),
    confirmedAt: event.confirmedAt.toISOString(),
    confirmedSlot: event.confirmedSlot.toString(),
    dateGroup: formatDateGroup(event.confirmedAt),
    destination: {
      icon: isCreate ? EARN_VAULT_ICON : null,
      label: isCreate ? EARN_VAULT_LABEL : featureLabel,
    },
    eventType: event.actionType,
    id: event.id,
    kind: isAutoswap ? "autoswap_action" : "autodeposit_action",
    liquidityMint: null,
    rawAmount: formatExactUsdcAmount(BigInt(0)),
    signature: event.signature,
    sortTimestamp: event.confirmedAt.toISOString(),
    source: {
      icon: isCreate ? MAIN_USDC_ICON : EARN_VAULT_ICON,
      label: isCreate ? MAIN_USDC_LABEL : EARN_VAULT_LABEL,
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
  if (event.type === "earn_lifecycle_action") {
    return serializeLifecycleActionEvent(event);
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
  const positionMarketIcon = resolveEarnTransactionMarketIcon({
    market: event.market,
  });
  // Rebalances move funds between two Kamino markets, so each side carries its
  // own market logo. Deposits/withdrawals use the actual Earn-side market too.
  const sourceIcon = isMovement
    ? resolveEarnTransactionMarketIcon({ market: event.sourceMarket })
    : kind === "deposit"
    ? MAIN_USDC_ICON
    : positionMarketIcon;
  const destinationIcon = isMovement
    ? resolveEarnTransactionMarketIcon({ market: event.destinationMarket })
    : kind === "deposit"
    ? positionMarketIcon
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
    liquidityMint: event.liquidityMint,
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
