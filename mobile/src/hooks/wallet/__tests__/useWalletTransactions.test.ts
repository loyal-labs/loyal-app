import { PublicKey } from "@solana/web3.js";

import type { WalletTransfer } from "@/lib/solana/rpc/types";
import { fetchWalletTransfersWithPagination } from "../useWalletTransactions";

const TEST_WALLET = new PublicKey("So11111111111111111111111111111111111111112");

function makeTransfer(signature: string): WalletTransfer {
  return {
    signature,
    slot: 1,
    timestamp: Date.now(),
    direction: "out",
    type: "transfer",
    amountLamports: 1,
    netChangeLamports: -1,
    feeLamports: 0,
    status: "success",
  };
}

describe("fetchWalletTransfersWithPagination", () => {
  it("keeps paging when first signatures page has too few mapped transfers", async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({
        transfers: [makeTransfer("sig-1"), makeTransfer("sig-2")],
        nextCursor: "cursor-1",
      })
      .mockResolvedValueOnce({
        transfers: [makeTransfer("sig-3"), makeTransfer("sig-4")],
        nextCursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        transfers: [makeTransfer("sig-5")],
        nextCursor: undefined,
      });

    const result = await fetchWalletTransfersWithPagination(
      TEST_WALLET,
      fetchPage,
    );

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.map((t) => t.signature)).toEqual([
      "sig-1",
      "sig-2",
      "sig-3",
      "sig-4",
      "sig-5",
    ]);
  });

  it("stops once enough transfers are collected", async () => {
    const pageTransfers = Array.from({ length: 30 }, (_, i) =>
      makeTransfer(`sig-${i + 1}`),
    );
    const secondPageTransfers = Array.from({ length: 30 }, (_, i) =>
      makeTransfer(`sig-${i + 31}`),
    );

    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({
        transfers: pageTransfers,
        nextCursor: "cursor-1",
      })
      .mockResolvedValueOnce({
        transfers: secondPageTransfers,
        nextCursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        transfers: [makeTransfer("sig-999")],
        nextCursor: undefined,
      });

    const result = await fetchWalletTransfersWithPagination(
      TEST_WALLET,
      fetchPage,
    );

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(60);
    expect(result[0].signature).toBe("sig-1");
    expect(result[result.length - 1].signature).toBe("sig-60");
  });
});

