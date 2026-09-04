import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { buildEarnAutodepositTargetHistoryEvents } = await import(
  "./earn-autodeposit-repository.server"
);

describe("Earn allowance history", () => {
  test("keeps the original creation proof after the allowance closes", () => {
    const createdAt = new Date("2026-07-14T18:00:00.000Z");
    const closedAt = new Date("2026-07-14T19:00:00.000Z");

    const events = buildEarnAutodepositTargetHistoryEvents({
      closeSignature: "close-signature",
      closeSlot: BigInt(220),
      closedAt,
      firstSeenAt: createdAt,
      id: BigInt(17),
      policyAccount: "policy-account",
      policyConfirmedSlot: BigInt(110),
      policySignature: "create-signature",
      recurringDelegation: "recurring-delegation",
      walletBalanceFloorRaw: BigInt(5_000_000),
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      actionType: "create",
      confirmedAt: createdAt,
      confirmedSlot: BigInt(110),
      signature: "create-signature",
    });
    expect(events[1]).toMatchObject({
      actionType: "close",
      confirmedAt: closedAt,
      confirmedSlot: BigInt(220),
      signature: "close-signature",
    });
  });
});
