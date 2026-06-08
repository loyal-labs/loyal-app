import { describe, expect, test } from "bun:test";

import { getSendMethod, SEND_METHODS } from "../wallet-analytics";

describe("getSendMethod", () => {
  test("returns wallet_address for valid Solana addresses", () => {
    expect(getSendMethod("11111111111111111111111111111111")).toBe(
      SEND_METHODS.walletAddress
    );
  });

  test("returns telegram for valid Telegram usernames", () => {
    expect(getSendMethod("@askloyal")).toBe(SEND_METHODS.telegram);
  });

  test("returns unknown for invalid recipients", () => {
    expect(getSendMethod("not-a-recipient")).toBe(SEND_METHODS.unknown);
  });
});
