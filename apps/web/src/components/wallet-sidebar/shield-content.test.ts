import { describe, expect, test } from "bun:test";

import {
  formatShieldAmountInputValue,
  isShieldAmountOverBalance,
} from "./shield-amount";

describe("ShieldContent amount helpers", () => {
  test("does not mark its own USDC Max value as insufficient from float drift", () => {
    const sourceBalance = 0.6372369999999999;
    const maxInput = formatShieldAmountInputValue(sourceBalance, "USDC");

    expect(maxInput).toBe("0.637237");
    expect(
      isShieldAmountOverBalance({
        amount: Number.parseFloat(maxInput),
        sourceBalance,
        tokenSymbol: "USDC",
      })
    ).toBe(false);
  });

  test("still marks amounts above the token raw balance as insufficient", () => {
    expect(
      isShieldAmountOverBalance({
        amount: 0.637238,
        sourceBalance: 0.6372369999999999,
        tokenSymbol: "USDC",
      })
    ).toBe(true);
  });
});
