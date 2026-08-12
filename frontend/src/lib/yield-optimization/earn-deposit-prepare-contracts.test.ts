import { describe, expect, test } from "bun:test";

import { parseEarnDepositPrepareRequestBody } from "./earn-deposit-prepare-contracts.shared";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("Earn deposit prepare request parsing", () => {
  test("parses a body with an explicit mint", () => {
    expect(
      parseEarnDepositPrepareRequestBody({
        amountRaw: "5000000",
        mint: USDC_MINT,
      })
    ).toEqual({ amountRaw: BigInt(5_000_000), mint: USDC_MINT });
  });

  test("accepts a legacy body without a mint (ASK-2099)", () => {
    // Pre-mint-selection mobile clients send only the amount; requiring the
    // field silently 400'd every mobile deposit.
    expect(
      parseEarnDepositPrepareRequestBody({ amountRaw: "5000000" })
    ).toEqual({ amountRaw: BigInt(5_000_000), mint: null });
  });

  test("still rejects a non-string mint", () => {
    expect(() =>
      parseEarnDepositPrepareRequestBody({ amountRaw: "5000000", mint: 5 })
    ).toThrow("mint must be a mint public key.");
  });
});
