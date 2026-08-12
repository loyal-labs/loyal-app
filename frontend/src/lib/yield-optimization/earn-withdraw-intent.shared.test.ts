import { describe, expect, test } from "bun:test";

import { parseEarnWithdrawPrepareRequestBody } from "./earn-withdraw-prepare-contracts.shared";

describe("Earn withdrawal intent", () => {
  test("accepts only exact source identity plus raw amount or max", () => {
    expect(
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "20",
        sourceId: "reserve:reserve-a",
      })
    ).toEqual({ amountRaw: BigInt(20), sourceId: "reserve:reserve-a" });
    expect(
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "max",
        sourceId: "idle:pyusd-ata",
      })
    ).toEqual({ amountRaw: "max", sourceId: "idle:pyusd-ata" });
  });

  test("rejects legacy fuzzy source objects", () => {
    expect(() =>
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "20",
        mode: "partial",
        source: { id: "PYUSD", type: "idle" },
      })
    ).toThrow("sourceId must be a non-empty string");
  });
});
