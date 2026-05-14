import type { Transaction } from "@/types/wallet";

import { filterTransactionsForMint } from "../activity";

describe("filterTransactionsForMint", () => {
  it("keeps token transfers, swaps, and shield events for a mint", () => {
    const transactions: Transaction[] = [
      {
        id: "token-transfer",
        type: "incoming",
        amountLamports: 0,
        tokenMint: "mint-sol",
        timestamp: 1,
      },
      {
        id: "swap-from",
        type: "incoming",
        amountLamports: 0,
        swapFromMint: "mint-sol",
        swapToMint: "mint-other",
        timestamp: 2,
      },
      {
        id: "swap-to",
        type: "incoming",
        amountLamports: 0,
        swapFromMint: "mint-other",
        swapToMint: "mint-sol",
        timestamp: 3,
      },
      {
        id: "shield-event",
        type: "incoming",
        amountLamports: 0,
        transferType: "secure",
        tokenMint: "mint-sol",
        timestamp: 4,
      },
      {
        id: "other",
        type: "incoming",
        amountLamports: 0,
        tokenMint: "mint-other",
        timestamp: 5,
      },
    ];

    expect(
      filterTransactionsForMint(transactions, "mint-sol").map(
        (transaction) => transaction.id,
      ),
    ).toEqual(["token-transfer", "swap-from", "swap-to", "shield-event"]);
  });
});
