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
type LifecycleEvent = Extract<
  EarnTransactionEvent,
  { type: "earn_lifecycle_action" }
>;
type YieldPositionEvent = Exclude<
  EarnTransactionEvent,
  AutodepositEvent | LifecycleEvent
>;

describe("earn transaction formatter", () => {
  test("formats Autodeposit and Autoswap lifecycle rows from the activity ledger", () => {
    const baseEvent = {
      amountRaw: BigInt(0),
      confirmedAt: new Date("2026-08-24T07:00:00.000Z"),
      confirmedSlot: BigInt(900),
      id: "earn-activity:1",
      metadata: {},
      signature: "lifecycle-signature",
      type: "earn_lifecycle_action" as const,
    };

    const serialized = [
      "autodeposit_created",
      "autodeposit_closed",
      "autoswap_created",
      "autoswap_closed",
    ].map((actionType) =>
      serializeEarnTransactionEvent({
        ...baseEvent,
        actionType,
      } as LifecycleEvent)
    );

    expect(serialized.map((event) => event.eventType)).toEqual([
      "autodeposit_created",
      "autodeposit_closed",
      "autoswap_created",
      "autoswap_closed",
    ]);
    expect(serialized.map((event) => event.kind)).toEqual([
      "autodeposit_action",
      "autodeposit_action",
      "autoswap_action",
      "autoswap_action",
    ]);
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
      positionId: BigInt(1),
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
      positionId: BigInt(1),
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
  });
});
