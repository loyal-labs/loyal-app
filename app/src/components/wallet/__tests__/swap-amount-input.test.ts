import { describe, expect, test } from "bun:test";

import {
  formatAmountDisplayValue,
  formatAmountInputValue,
  getAmountInputMaxDecimals,
  parseAmountInput,
} from "../swap-amount-input";

describe("swap amount input helpers", () => {
  test("uses token decimals for six-decimal assets like USDC", () => {
    expect(getAmountInputMaxDecimals(6)).toBe(6);
    expect(parseAmountInput("0.0098", getAmountInputMaxDecimals(6))).toBe(
      "0.0098"
    );
  });

  test("preserves support for 18-decimal assets", () => {
    expect(getAmountInputMaxDecimals(18)).toBe(18);
    expect(
      parseAmountInput(
        "0.123456789012345678",
        getAmountInputMaxDecimals(18)
      )
    ).toBe("0.123456789012345678");
  });

  test("formats max values without rounding tiny balances above the limit", () => {
    expect(formatAmountInputValue(0.0098, getAmountInputMaxDecimals(6))).toBe(
      "0.0098"
    );
    expect(
      formatAmountInputValue(0.009899999999, getAmountInputMaxDecimals(6))
    ).toBe("0.009899");
  });

  test("formats tiny scientific-notation values without collapsing them to zero", () => {
    expect(formatAmountInputValue(1e-18, getAmountInputMaxDecimals(18))).toBe(
      "0.000000000000000001"
    );
  });

  test("keeps display formatting aligned with token precision without float noise", () => {
    expect(formatAmountDisplayValue(0.0098, getAmountInputMaxDecimals(6))).toBe(
      "0.0098"
    );
    expect(
      formatAmountDisplayValue(
        0.30000000000000004,
        getAmountInputMaxDecimals(18)
      )
    ).toBe("0.3");
  });
});
