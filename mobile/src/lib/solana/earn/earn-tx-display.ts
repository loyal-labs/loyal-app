import type { EarnTransactionItem } from "./earn-api";

// Row title for an Earn transaction. Mirrors the web pane's
// `getEarnTransactionRowLabel`: the specific lifecycle events win over the
// generic kind (e.g. a `deposit_initialized` reads "Create & Deposit").
export function getEarnTransactionRowLabel(
  item: Pick<EarnTransactionItem, "eventType" | "kind">,
): string {
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
    default:
      break;
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
    default:
      return "Transaction";
  }
}

// Money-in (deposits/sweeps) reads green; everything else is neutral black.
export function getEarnTransactionAmountColor(
  kind: EarnTransactionItem["kind"],
): string {
  return kind === "deposit" || kind === "balance_sweep" ? "#34C759" : "#000000";
}

// Epoch ms for an item, for "newest" comparisons (unread dot). Falls back to 0
// when neither timestamp parses.
export function earnTransactionTimestampMs(
  item: Pick<EarnTransactionItem, "confirmedAt" | "sortTimestamp">,
): number {
  const raw = item.confirmedAt ?? item.sortTimestamp;
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 0 : ms;
}

export type EarnTransactionGroup = {
  date: string;
  items: EarnTransactionItem[];
};

// Groups a pre-sorted (newest-first) list into consecutive date sections, using
// the backend-supplied `dateGroup` label — same as the web pane.
export function groupEarnTransactions(
  items: EarnTransactionItem[],
): EarnTransactionGroup[] {
  const groups: EarnTransactionGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.dateGroup) {
      last.items.push(item);
    } else {
      groups.push({ date: item.dateGroup, items: [item] });
    }
  }
  return groups;
}
