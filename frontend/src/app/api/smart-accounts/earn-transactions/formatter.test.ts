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

describe("earn transaction formatter", () => {
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
  });
});
