import { Keypair } from "@solana/web3.js";
import { describe, expect, test } from "bun:test";
import {
  assertCreatedSettingsBoundary,
  shouldReprepareCreation,
} from "./smart-account";

describe("global Settings index collision recovery", () => {
  test("reprepares fresh bytes only for a pre-submission failure with attempts left", () => {
    expect(
      shouldReprepareCreation({
        error: new Error("Account already in use"),
        attempt: 0,
        maxAttempts: 2,
      })
    ).toBe(true);
    expect(
      shouldReprepareCreation({
        error: Object.assign(new Error("outcome unresolved"), {
          transactionWasSubmitted: true,
        }),
        attempt: 0,
        maxAttempts: 2,
      })
    ).toBe(false);
    expect(
      shouldReprepareCreation({
        error: new Error("User rejected the request"),
        attempt: 0,
        maxAttempts: 2,
      })
    ).toBe(false);
    expect(
      shouldReprepareCreation({
        error: new Error("RPC response was lost"),
        attempt: 0,
        maxAttempts: 2,
      })
    ).toBe(false);
    expect(
      shouldReprepareCreation({
        error: new Error("Settings account already exists"),
        attempt: 1,
        maxAttempts: 2,
      })
    ).toBe(false);
  });

  test("accepts only the exact one-of-one all-permissions Privy root signer", () => {
    const wallet = Keypair.generate().publicKey;
    expect(() =>
      assertCreatedSettingsBoundary({
        wallet,
        threshold: 1,
        timeLock: 0,
        signers: [{ key: wallet, permissionMask: 0b111 }],
      })
    ).not.toThrow();
    expect(() =>
      assertCreatedSettingsBoundary({
        wallet,
        threshold: 2,
        timeLock: 0,
        signers: [{ key: wallet, permissionMask: 0b111 }],
      })
    ).toThrow("threshold");
    expect(() =>
      assertCreatedSettingsBoundary({
        wallet,
        threshold: 1,
        timeLock: 0,
        signers: [
          { key: wallet, permissionMask: 0b111 },
          { key: Keypair.generate().publicKey, permissionMask: 0b111 },
        ],
      })
    ).toThrow("exactly one");
    expect(() =>
      assertCreatedSettingsBoundary({
        wallet,
        threshold: 1,
        timeLock: 0,
        signers: [{ key: wallet, permissionMask: 0b001 }],
      })
    ).toThrow("permissions");
  });
});
