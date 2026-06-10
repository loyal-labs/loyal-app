import { describe, expect, test } from "bun:test";

import {
  serializeEarnTransactionEvent,
  type EarnTransactionEvent,
} from "./formatter";

type AutodepositEvent = Extract<
  EarnTransactionEvent,
  { type: "autodeposit_action" }
>;

function createAutodepositEvent(
  overrides: Partial<AutodepositEvent> = {}
) {
  return {
    actionType: "create" as const,
    amountRaw: BigInt(0),
    confirmedAt: new Date("2026-06-09T12:00:00.000Z"),
    confirmedSlot: BigInt(123),
    depositSignature: null,
    id: "autodeposit:create:1",
    policyAccount: "policy",
    recurringDelegation: "recurring",
    signature: "signature",
    type: "autodeposit_action" as const,
    walletBalanceFloorRaw: BigInt(500_000_000),
    ...overrides,
  } satisfies AutodepositEvent;
}

describe("earn transaction formatter", () => {
  test("serializes autodeposit create actions", () => {
    const item = serializeEarnTransactionEvent(createAutodepositEvent());

    expect(item.eventType).toBe("autodeposit_created");
    expect(item.kind).toBe("autodeposit_action");
    expect(item.amount).toBe("$0.00");
    expect(item.source.label).toBe("Autodeposit");
    expect(item.destination.label).toBe("Earn vault");
  });

  test("serializes autodeposit close actions", () => {
    const item = serializeEarnTransactionEvent(
      createAutodepositEvent({
        actionType: "close",
        confirmedSlot: BigInt(456),
        id: "autodeposit:close:1",
      })
    );

    expect(item.eventType).toBe("autodeposit_closed");
    expect(item.kind).toBe("autodeposit_action");
    expect(item.amount).toBe("$0.00");
    expect(item.source.label).toBe("Earn vault");
    expect(item.destination.label).toBe("Autodeposit");
  });

  test("serializes balance sweep executions as positive Earn deposits", () => {
    const item = serializeEarnTransactionEvent(
      createAutodepositEvent({
        actionType: "balance_sweep",
        amountRaw: BigInt(1_234_567),
        id: "autodeposit:sweep:1",
      })
    );

    expect(item.eventType).toBe("balance_sweep");
    expect(item.kind).toBe("balance_sweep");
    expect(item.amount).toBe("+$1.24");
    expect(item.rawAmount).toBe("$1.234567");
    expect(item.source.label).toBe("Main USDC");
    expect(item.destination.label).toBe("Earn vault");
  });
});
