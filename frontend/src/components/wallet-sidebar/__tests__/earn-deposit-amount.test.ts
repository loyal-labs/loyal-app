import { describe, expect, test } from "bun:test";

import { clampDepositAmountInput } from "../earn-detail-view";

describe("clampDepositAmountInput", () => {
  test("caps typed values at the available balance", () => {
    expect(clampDepositAmountInput("2000", 1280)).toBe("1,280");
  });

  test("caps pasted decimal values at the available balance", () => {
    expect(clampDepositAmountInput("20.000001", 20)).toBe("20");
  });

  test("keeps valid in-balance input unchanged", () => {
    expect(clampDepositAmountInput("12.34", 20)).toBe("12.34");
  });

  test("rejects non-numeric input", () => {
    expect(clampDepositAmountInput("12a", 20)).toBeNull();
  });
});
