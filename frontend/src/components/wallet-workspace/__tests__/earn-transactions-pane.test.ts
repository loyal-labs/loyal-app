import { describe, expect, test } from "bun:test";

import {
  buildEarnTransactionDetail,
  type EarnTransactionItem,
} from "../earn-transactions-pane";

function transaction(overrides: Partial<EarnTransactionItem> = {}) {
  return {
    amount: "-1.25 USDC",
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
    expect(detail.activity.amount).toBe("-1.25 USDC");
    expect(detail.usdValue).toBe("1.250000 USDC");
    expect(detail.activity.type).toBe("sent");
    expect(detail.activity.counterparty).toBe("Earn vault");
  });

  test("maps withdrawals as received from the Earn vault", () => {
    const detail = buildEarnTransactionDetail(
      transaction({
        destination: { icon: null, label: "Main USDC" },
        kind: "withdraw",
        amount: "+1.25 USDC",
        signature: "withdraw-signature-1",
        source: { icon: null, label: "Earn vault" },
      })
    );

    expect(detail.activity.id).toBe("withdraw-signature-1");
    expect(detail.activity.amount).toBe("+1.25 USDC");
    expect(detail.activity.type).toBe("received");
    expect(detail.activity.counterparty).toBe("Earn vault");
  });
});
