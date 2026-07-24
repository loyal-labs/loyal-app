import { describe, expect, test } from "bun:test";

import {
  computeUnshieldModifyAmount,
  resolveWalletActionSwapToken,
  toRoundedTokenRawAmount,
} from "../shielding";

describe("toRoundedTokenRawAmount", () => {
  test("keeps decimal drift from reducing Max by one raw unit", () => {
    expect(toRoundedTokenRawAmount(1.005, 6)).toBe(1_005_000n);
  });
});

describe("resolveWalletActionSwapToken", () => {
  test("uses the canonical balance instead of the rounded display amount", () => {
    const token = resolveWalletActionSwapToken(
      {
        id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        symbol: "USDC",
        price: "$1.00",
        amount: "1.1723",
        value: "$1.17",
        icon: "usdc",
      },
      "personal",
      {
        personal: [
          {
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            symbol: "USDC",
            icon: "usdc",
            price: 1,
            balance: 1.172339,
          },
        ],
        vault: [],
      }
    );

    expect(token.balance).toBe(1.172339);
    expect(toRoundedTokenRawAmount(token.balance, 6)).toBe(1_172_339n);
  });

  test("keeps secured and public balances separate for the same mint", () => {
    const token = resolveWalletActionSwapToken(
      {
        id: "usdc-mint-secured",
        symbol: "USDC",
        price: "$1.00",
        amount: "2.0000",
        value: "$2.00",
        icon: "usdc",
        isSecured: true,
      },
      "personal",
      {
        personal: [
          {
            mint: "usdc-mint",
            symbol: "USDC",
            icon: "usdc",
            price: 1,
            balance: 9,
          },
          {
            mint: "usdc-mint",
            symbol: "USDC",
            icon: "usdc",
            price: 1,
            balance: 2.000001,
            isSecured: true,
          },
        ],
        vault: [],
      }
    );

    expect(token.balance).toBe(2.000001);
    expect(token.isSecured).toBe(true);
  });

  test("keeps identical mints scoped to the account that owns the row", () => {
    const row = {
      id: "usdc-mint",
      symbol: "USDC",
      price: "$1.00",
      amount: "3.3333",
      value: "$3.33",
      icon: "usdc",
    };
    const sources = {
      personal: [
        {
          mint: "usdc-mint",
          symbol: "USDC",
          icon: "usdc",
          price: 1,
          balance: 9.000001,
        },
      ],
      vault: [
        {
          mint: "usdc-mint",
          symbol: "USDC",
          icon: "usdc",
          price: 1,
          balance: 2.000001,
        },
      ],
    };

    expect(resolveWalletActionSwapToken(row, "personal", sources).balance).toBe(
      9.000001
    );
    expect(resolveWalletActionSwapToken(row, "vault", sources).balance).toBe(
      2.000001
    );
    expect(resolveWalletActionSwapToken(row, "signer", sources).balance).toBe(
      3.3333
    );
  });
});

describe("computeUnshieldModifyAmount", () => {
  test("burns the live tracked Kamino deposit amount for Max", () => {
    expect(
      computeUnshieldModifyAmount({
        currentDepositRaw: 1_234_567n,
        isMax: true,
        isTrackedKaminoToken: true,
        kaminoQuotedShares: null,
        requestedRawAmount: 1_200_000n,
      })
    ).toBe(1_234_567n);
  });

  test("uses quoted shares for partial tracked Kamino unshield", () => {
    expect(
      computeUnshieldModifyAmount({
        currentDepositRaw: 1_234_567n,
        isMax: false,
        isTrackedKaminoToken: true,
        kaminoQuotedShares: 617_000n,
        requestedRawAmount: 600_000n,
      })
    ).toBe(617_000n);
  });

  test("clamps partial tracked Kamino unshield to the live deposit", () => {
    expect(
      computeUnshieldModifyAmount({
        currentDepositRaw: 1_234_567n,
        isMax: false,
        isTrackedKaminoToken: true,
        kaminoQuotedShares: 1_234_568n,
        requestedRawAmount: 1_200_000n,
      })
    ).toBe(1_234_567n);
  });
});
