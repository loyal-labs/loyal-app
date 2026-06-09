import { describe, expect, test } from "bun:test";

import {
  serializeEarnTransactionEvent,
  type SerializedEarnTransaction,
} from "../formatter";

function event(
  overrides: Partial<Parameters<typeof serializeEarnTransactionEvent>[0]> = {}
) {
  const amountRaw = overrides.amountRaw ?? BigInt(1_250_000);
  return {
    amountRaw,
    confirmedAt: new Date("2026-06-01T18:05:00.000Z"),
    confirmedSlot: BigInt(111),
    id: BigInt(1),
    liquidityMint: "USDC-mint",
    market: "Main",
    principalDeltaRaw:
      overrides.principalDeltaRaw !== undefined
        ? overrides.principalDeltaRaw
        : amountRaw,
    reserve: "reserve-1",
    signature: "deposit-sig-1",
    type: "deposit" as const,
    ...overrides,
  };
}

function pickContract(transaction: SerializedEarnTransaction) {
  return {
    amount: transaction.amount,
    destination: transaction.destination,
    kind: transaction.kind,
    rawAmount: transaction.rawAmount,
    source: transaction.source,
  };
}

describe("serializeEarnTransactionEvent", () => {
  test("formats deposits from Main USDC into the Earn vault", () => {
    expect(pickContract(serializeEarnTransactionEvent(event()))).toEqual({
      amount: "+1.25 USDC",
      destination: { icon: null, label: "Earn vault" },
      kind: "deposit",
      rawAmount: "1.250000 USDC",
      source: { icon: "/agents/Agent-01.svg", label: "Main USDC" },
    });
  });

  test("formats withdrawals from the Earn vault back to Main USDC", () => {
    expect(
      pickContract(
        serializeEarnTransactionEvent(
          event({
            amountRaw: BigInt(2_500_000),
            signature: "withdraw-sig-1",
            type: "withdrawal" as const,
          })
        )
      )
    ).toEqual({
      amount: "-2.50 USDC",
      destination: { icon: "/agents/Agent-01.svg", label: "Main USDC" },
      kind: "withdraw",
      rawAmount: "2.500000 USDC",
      source: { icon: null, label: "Earn vault" },
    });
  });

  test("keeps dust visible without rounding to zero", () => {
    const transaction = serializeEarnTransactionEvent(
      event({
        amountRaw: BigInt(1),
        signature: "dust-deposit-sig-1",
      })
    );

    expect(transaction.amount).toBe("+0.01 USDC");
    expect(transaction.rawAmount).toBe("0.000001 USDC");
  });

  test("rounds display amounts up to two decimal places", () => {
    const transaction = serializeEarnTransactionEvent(
      event({
        amountRaw: BigInt(5_008_000),
        signature: "fractional-deposit-sig-1",
      })
    );

    expect(transaction.amount).toBe("+5.01 USDC");
    expect(transaction.rawAmount).toBe("5.008000 USDC");
  });

  test("formats top-up deposits from the principal delta, not the cumulative holding", () => {
    const transaction = serializeEarnTransactionEvent(
      event({
        amountRaw: BigInt(7_008_000),
        principalDeltaRaw: BigInt(2_000_000),
        signature: "top-up-deposit-sig-1",
      })
    );

    expect(transaction.amount).toBe("+2.00 USDC");
    expect(transaction.rawAmount).toBe("2.000000 USDC");
  });

  test("keeps two display decimals for whole amounts", () => {
    const transaction = serializeEarnTransactionEvent(
      event({
        amountRaw: BigInt(5_000_000),
        signature: "whole-deposit-sig-1",
      })
    );

    expect(transaction.amount).toBe("+5.00 USDC");
    expect(transaction.rawAmount).toBe("5.000000 USDC");
  });

  test("formats reserve-to-reserve movement events by short reserve labels", () => {
    expect(
      pickContract(
        serializeEarnTransactionEvent(
          event({
            destinationReserve: "LongDestinationReserve111111",
            signature: "rebalance-sig-1",
            sourceReserve: "LongSourceReserve222222",
            type: "rebalance" as const,
          })
        )
      )
    ).toEqual({
      amount: "1.25 USDC",
      destination: { icon: null, label: "Long...1111" },
      kind: "rebalance",
      rawAmount: "1.250000 USDC",
      source: { icon: null, label: "Long...2222" },
    });
  });

  test("formats reconciliation events as neutral reserve updates", () => {
    expect(
      pickContract(
        serializeEarnTransactionEvent(
          event({
            amountRaw: BigInt(2_000_000),
            destinationReserve: "ShortDest",
            signature: "reconciliation-sig-1",
            sourceReserve: "ShortSource",
            type: "reconciliation" as const,
          })
        )
      )
    ).toEqual({
      amount: "2.00 USDC",
      destination: { icon: null, label: "ShortDest" },
      kind: "reconciliation",
      rawAmount: "2.000000 USDC",
      source: { icon: null, label: "Shor...urce" },
    });
  });
});
