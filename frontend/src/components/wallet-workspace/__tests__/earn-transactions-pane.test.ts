import { describe, expect, test } from "bun:test";

import {
  buildEarnTransactionDetail,
  getEarnTransactionAmountColor,
  getEarnTransactionRowLabel,
  type EarnTransactionItem,
} from "../earn-transactions-pane";

function transaction(overrides: Partial<EarnTransactionItem> = {}) {
  return {
    amount: "+1.25 USDC",
    confirmedSlot: "123",
    dateGroup: "June 1",
    destination: { icon: null, label: "Earn vault" },
    id: "event-id-1",
    kind: "deposit" as const,
    rawAmount: "1.250000 USDC",
    signature: "signature-1",
    source: { icon: null, label: "Main USDC" },
    timestamp: "6:05 PM",
    ...overrides,
  };
}

describe("buildEarnTransactionDetail", () => {
  test("uses the transaction signature for explorer-backed activity ids", () => {
    const detail = buildEarnTransactionDetail(transaction());

    expect(detail.activity.id).toBe("signature-1");
    expect(detail.activity.amount).toBe("+1.25 USDC");
    expect(detail.usdValue).toBe("1.250000 USDC");
    expect(detail.activity.type).toBe("received");
    expect(detail.activity.counterparty).toBe("Main USDC");
  });

  test("maps withdrawals as sent out of the Earn vault", () => {
    const detail = buildEarnTransactionDetail(
      transaction({
        destination: { icon: null, label: "Main USDC" },
        kind: "withdraw",
        amount: "-1.25 USDC",
        signature: "withdraw-signature-1",
        source: { icon: null, label: "Earn vault" },
      })
    );

    expect(detail.activity.id).toBe("withdraw-signature-1");
    expect(detail.activity.amount).toBe("-1.25 USDC");
    expect(detail.activity.type).toBe("sent");
    expect(detail.activity.counterparty).toBe("Main USDC");
  });

  test("maps rebalances as movement details", () => {
    const detail = buildEarnTransactionDetail(
      transaction({
        amount: "1.25 USDC",
        destination: { icon: null, label: "Dest...1111" },
        kind: "rebalance",
        signature: "rebalance-signature-1",
        source: { icon: null, label: "Src...2222" },
      })
    );

    expect(detail.activity.id).toBe("rebalance-signature-1");
    expect(detail.activity.amount).toBe("1.25 USDC");
    expect(detail.activity.type).toBe("sent");
    expect(detail.activity.counterparty).toBe("Moved Src...2222 -> Dest...1111");
  });

  test("maps reconciliations as movement details", () => {
    const detail = buildEarnTransactionDetail(
      transaction({
        amount: "2 USDC",
        destination: { icon: null, label: "Reserve B" },
        kind: "reconciliation",
        signature: "reconciliation-signature-1",
        source: { icon: null, label: "Reserve A" },
      })
    );

    expect(detail.activity.id).toBe("reconciliation-signature-1");
    expect(detail.activity.amount).toBe("2 USDC");
    expect(detail.activity.type).toBe("sent");
    expect(detail.activity.counterparty).toBe("Moved Reserve A -> Reserve B");
  });
});

describe("getEarnTransactionRowLabel", () => {
  test("uses explicit row labels for every Earn transaction kind", () => {
    expect(getEarnTransactionRowLabel("deposit")).toBe("Deposit");
    expect(getEarnTransactionRowLabel("withdraw")).toBe("Withdraw");
    expect(getEarnTransactionRowLabel("rebalance")).toBe("Moved");
    expect(getEarnTransactionRowLabel("reconciliation")).toBe("Updated");
  });
});

describe("getEarnTransactionAmountColor", () => {
  test("colors Earn deposits as positive and withdrawals as normal outflows", () => {
    expect(getEarnTransactionAmountColor({ kind: "deposit" })).toBe("#34C759");
    expect(getEarnTransactionAmountColor({ kind: "withdraw" })).toBe("#000");
  });

  test("keeps hidden balances muted", () => {
    expect(
      getEarnTransactionAmountColor({
        isBalanceHidden: true,
        kind: "deposit",
      })
    ).toBe("#BBBBC0");
  });
});
