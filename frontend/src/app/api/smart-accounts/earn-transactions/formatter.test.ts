import { describe, expect, test } from "bun:test";
import {
  KAMINO_MAIN_MARKET,
  KAMINO_ONRE_MARKET,
  STABLECOIN_MINTS,
} from "@loyal-labs/actions";

import {
  collapseDuplicateEarnRebalanceTransactions,
  serializeEarnTransactionEvent,
  type EarnTransactionEvent,
} from "./formatter";

type AutodepositEvent = Extract<
  EarnTransactionEvent,
  { type: "autodeposit_action" }
>;
type YieldPositionEvent = Exclude<EarnTransactionEvent, AutodepositEvent>;

function createAutodepositEvent(overrides: Partial<AutodepositEvent> = {}) {
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
    expect(item.confirmedAt).toBe("2026-06-09T12:00:00.000Z");
    expect(item.amount).toBe("$0.00");
    expect(item.source.label).toBe("Main USDC");
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

  test("serializes rebalances with market labels and principal USDC amounts", () => {
    const usdcMint = STABLECOIN_MINTS.USDC.toBase58();
    const item = serializeEarnTransactionEvent({
      amountRaw: BigInt(4_211_753),
      confirmedAt: new Date("2026-06-16T13:58:00.000Z"),
      confirmedSlot: BigInt(789),
      destinationLiquidityMint: usdcMint,
      destinationMarket: KAMINO_ONRE_MARKET.toBase58(),
      destinationReserve: "onre-reserve",
      eventType: "rebalance_confirmed",
      id: BigInt(1),
      liquidityMint: usdcMint,
      market: KAMINO_ONRE_MARKET.toBase58(),
      principalAmountRaw: BigInt(5_000_000),
      principalDeltaRaw: null,
      reserve: "onre-reserve",
      signature: "rebalance-signature",
      sourceLiquidityMint: usdcMint,
      sourceMarket: KAMINO_MAIN_MARKET.toBase58(),
      sourceReserve: "main-reserve",
      type: "rebalance",
    } satisfies YieldPositionEvent);

    expect(item.kind).toBe("rebalance");
    expect(item.id).toBe("rebalance-signature:1");
    expect(item.amount).toBe("$5.00");
    expect(item.rawAmount).toBe("$5.000000");
    expect(item.source.label).toBe("Main USDC");
    expect(item.destination.label).toBe("OnRe USDC");
  });

  test("collapses duplicate rebalance rows from the same signature", () => {
    const usdcMint = STABLECOIN_MINTS.USDC.toBase58();
    const mainToOnre = serializeEarnTransactionEvent({
      amountRaw: BigInt(4_211_753),
      confirmedAt: new Date("2026-06-16T13:58:00.000Z"),
      confirmedSlot: BigInt(789),
      destinationLiquidityMint: usdcMint,
      destinationMarket: KAMINO_ONRE_MARKET.toBase58(),
      destinationReserve: "onre-reserve",
      eventType: "rebalance_confirmed",
      id: BigInt(1),
      liquidityMint: usdcMint,
      market: KAMINO_ONRE_MARKET.toBase58(),
      principalAmountRaw: BigInt(5_000_000),
      principalDeltaRaw: null,
      reserve: "onre-reserve",
      signature: "rebalance-signature",
      sourceLiquidityMint: usdcMint,
      sourceMarket: KAMINO_MAIN_MARKET.toBase58(),
      sourceReserve: "main-reserve",
      type: "rebalance",
    } satisfies YieldPositionEvent);
    const onreToOnre = serializeEarnTransactionEvent({
      amountRaw: BigInt(4_211_753),
      confirmedAt: new Date("2026-06-16T13:58:00.000Z"),
      confirmedSlot: BigInt(789),
      destinationLiquidityMint: usdcMint,
      destinationMarket: KAMINO_ONRE_MARKET.toBase58(),
      destinationReserve: "onre-reserve",
      eventType: "rebalance_confirmed",
      id: BigInt(2),
      liquidityMint: usdcMint,
      market: KAMINO_ONRE_MARKET.toBase58(),
      principalAmountRaw: BigInt(5_000_000),
      principalDeltaRaw: null,
      reserve: "onre-reserve",
      signature: "rebalance-signature",
      sourceLiquidityMint: usdcMint,
      sourceMarket: KAMINO_ONRE_MARKET.toBase58(),
      sourceReserve: "onre-reserve",
      type: "rebalance",
    } satisfies YieldPositionEvent);

    const collapsed = collapseDuplicateEarnRebalanceTransactions([
      onreToOnre,
      mainToOnre,
    ]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.id).toBe(mainToOnre.id);
    expect(collapsed[0]?.source.label).toBe("Main USDC");
    expect(collapsed[0]?.destination.label).toBe("OnRe USDC");
  });
});
