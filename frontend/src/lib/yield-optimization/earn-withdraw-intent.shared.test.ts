import { describe, expect, test } from "bun:test";

import { parseEarnWithdrawPrepareRequestBody } from "./earn-withdraw-prepare-contracts.shared";

describe("Earn withdrawal intent", () => {
  test("accepts exact source identity plus raw amount or max", () => {
    expect(
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "20",
        sourceId: "reserve:reserve-a",
      })
    ).toEqual({
      amountRaw: BigInt(20),
      sourceId: "reserve:reserve-a",
      legacy: null,
    });
    expect(
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "max",
        sourceId: "idle:pyusd-ata",
      })
    ).toEqual({ amountRaw: "max", sourceId: "idle:pyusd-ata", legacy: null });
  });

  test("keeps accepting legacy source objects the mobile fleet still sends", () => {
    // Rejecting these silently 400'd every shipped mobile withdrawal
    // (ASK-2099). Resolution matches them with the legacy matcher, which
    // refuses ambiguous fuzzy matches instead of guessing.
    const parsed = parseEarnWithdrawPrepareRequestBody({
      amountRaw: "20",
      mode: "partial",
      source: { id: "PYUSD", type: "idle" },
    });
    expect(parsed.sourceId).toBeNull();
    expect(parsed.legacy).toMatchObject({
      mode: "partial",
      source: { id: "PYUSD", type: "idle" },
    });
  });

  test("rejects a body with neither sourceId nor mode", () => {
    expect(() =>
      parseEarnWithdrawPrepareRequestBody({ amountRaw: "20" })
    ).toThrow("sourceId must be a non-empty string");
  });
});
