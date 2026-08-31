import { describe, expect, test } from "bun:test";

import {
  nativeSwapFixture,
  solTransferFixture,
  swapFixture,
  tokenTransferFixture,
  WALLET_ADDRESS,
} from "../__fixtures__/activity-fixtures";
import { normalizeParsedTransaction } from "../parsers/activity-parser";

describe("normalizeParsedTransaction", () => {
  test("normalizes a sol transfer", () => {
    const activity = normalizeParsedTransaction({
      tx: solTransferFixture(),
      signature: "sol-signature",
      walletAddress: WALLET_ADDRESS,
    });

    expect(activity?.type).toBe("sol_transfer");
    expect(activity?.direction).toBe("out");
    expect(activity?.amountLamports).toBe(500_000_000);
  });

  test("normalizes a token transfer", () => {
    const activity = normalizeParsedTransaction({
      tx: tokenTransferFixture(),
      signature: "token-signature",
      walletAddress: WALLET_ADDRESS,
    });

    expect(activity?.type).toBe("token_transfer");
    expect(activity?.direction).toBe("out");
    expect(activity?.token?.mint).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
    expect(activity?.token?.amount).toBe("2");
  });

  test("normalizes a token swap", () => {
    const activity = normalizeParsedTransaction({
      tx: swapFixture(),
      signature: "swap-signature",
      walletAddress: WALLET_ADDRESS,
    });

    expect(activity?.type).toBe("swap");
    expect(activity?.fromToken?.mint).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
    expect(activity?.toToken?.mint).toBe(
      "DezXAZ8z7PnrnRJjz3wXBoRgixCa6nBoP4R2B8vfG8fX"
    );
  });

  test("normalizes native-to-token swaps", () => {
    const activity = normalizeParsedTransaction({
      tx: nativeSwapFixture(),
      signature: "native-swap-signature",
      walletAddress: WALLET_ADDRESS,
    });

    expect(activity?.type).toBe("swap");
    expect(activity?.fromToken?.mint).toBe(
      "So11111111111111111111111111111111111111112"
    );
    expect(activity?.toToken?.mint).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
  });
});
