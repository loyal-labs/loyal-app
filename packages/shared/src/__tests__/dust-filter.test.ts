import { describe, expect, test } from "bun:test";

import {
  isDustSolTransfer,
  isDustTokenTransfer,
  SOL_DUST_THRESHOLD_LAMPORTS,
} from "../dust-filter";

describe("isDustSolTransfer", () => {
  test("suppresses unsigned SOL-only inbound below threshold", () => {
    expect(
      isDustSolTransfer({
        isUserSigned: false,
        hasTokenChange: false,
        lamports: 9_999,
      }),
    ).toBe(true);
  });

  test("keeps unsigned SOL-only inbound at or above threshold", () => {
    expect(
      isDustSolTransfer({
        isUserSigned: false,
        hasTokenChange: false,
        lamports: SOL_DUST_THRESHOLD_LAMPORTS,
      }),
    ).toBe(false);
  });

  test("never filters user-signed transactions", () => {
    expect(
      isDustSolTransfer({
        isUserSigned: true,
        hasTokenChange: false,
        lamports: 1,
      }),
    ).toBe(false);
  });

  test("never filters transfers that also move tokens", () => {
    expect(
      isDustSolTransfer({
        isUserSigned: false,
        hasTokenChange: true,
        lamports: 1,
      }),
    ).toBe(false);
  });
});

describe("isDustTokenTransfer", () => {
  test("suppresses 1-raw-unit inbound USDC (classic address poisoning)", () => {
    expect(
      isDustTokenTransfer({
        isUserSigned: false,
        direction: "in",
        rawAmount: BigInt(1),
        decimals: 6,
      }),
    ).toBe(true);
  });

  test("keeps 0.01 USDC inbound (10_000 raw units)", () => {
    expect(
      isDustTokenTransfer({
        isUserSigned: false,
        direction: "in",
        rawAmount: BigInt(10_000),
        decimals: 6,
      }),
    ).toBe(false);
  });

  test("never filters outbound token transfers", () => {
    expect(
      isDustTokenTransfer({
        isUserSigned: false,
        direction: "out",
        rawAmount: BigInt(1),
        decimals: 6,
      }),
    ).toBe(false);
  });

  test("never filters user-signed token transfers, even tiny inbound", () => {
    expect(
      isDustTokenTransfer({
        isUserSigned: true,
        direction: "in",
        rawAmount: BigInt(1),
        decimals: 6,
      }),
    ).toBe(false);
  });

  test("zero-decimal tokens pass through unless the amount is zero", () => {
    expect(
      isDustTokenTransfer({
        isUserSigned: false,
        direction: "in",
        rawAmount: BigInt(1),
        decimals: 0,
      }),
    ).toBe(false);

    expect(
      isDustTokenTransfer({
        isUserSigned: false,
        direction: "in",
        rawAmount: BigInt(0),
        decimals: 0,
      }),
    ).toBe(false);
  });

  test("handles 9-decimal tokens (e.g., SPL wrapped SOL) at the threshold", () => {
    // threshold 0.0001 -> 100_000 raw for 9 decimals
    expect(
      isDustTokenTransfer({
        isUserSigned: false,
        direction: "in",
        rawAmount: BigInt(99_999),
        decimals: 9,
      }),
    ).toBe(true);

    expect(
      isDustTokenTransfer({
        isUserSigned: false,
        direction: "in",
        rawAmount: BigInt(100_000),
        decimals: 9,
      }),
    ).toBe(false);
  });
});
