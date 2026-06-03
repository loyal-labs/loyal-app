import { describe, expect, test } from "bun:test";

import type {
  EarnDepositDraft,
  EarnWithdrawDraft,
} from "@/components/wallet-sidebar/earn-detail-view";
import { STABLECOIN_MINTS } from "@loyal/actions/constants";
import { Stablecoin } from "@loyal/actions/types";

import {
  buildEarnDepositReviewItem,
  buildEarnWithdrawReviewItem,
} from "../earn-deposit-review";

function makeDraft(): EarnDepositDraft {
  return {
    amount: 125.5,
    amountLabel: "125.5",
    forecastApyBps: 1197,
    source: {
      addressLabel: "2Lzb...UQUu",
      balance: 1000,
      balanceFraction: "00",
      balanceWhole: "1,000",
      decimals: 6,
      icon: "/agents/Agent-01.svg",
      id: "main",
      label: "Main",
      mint: "usdc-mint",
    },
    symbol: "USDC",
    tokenDecimals: 6,
    tokenMint: "usdc-mint",
  };
}

function makeWithdrawDraft(
  overrides: Partial<EarnWithdrawDraft> = {}
): EarnWithdrawDraft {
  return {
    amount: 25.25,
    amountLabel: "25.25",
    destination: {
      addressLabel: "2Lzb...UQUu",
      balance: 1000,
      balanceFraction: "00",
      balanceWhole: "1,000",
      decimals: 6,
      icon: "/agents/Agent-01.svg",
      id: "main",
      label: "Main",
      mint: "usdc-mint",
    },
    mode: "partial",
    symbol: "USDC",
    tokenDecimals: 6,
    ...overrides,
  };
}

describe("buildEarnDepositReviewItem", () => {
  test("projects a valid USDC earn draft into signing review sections", () => {
    const review = buildEarnDepositReviewItem({
      draft: makeDraft(),
    });

    expect(review.title).toBe("Deposit");
    expect(review.amount).toBe("125.5");
    expect(review.symbol).toBe("USDC");
    expect(review.summaryLabel).toBe("Launch yield optimization policy");
    expect(review.destinationLabel).toBe("Earn vault");
    expect(review.sourceLabel).toBe("Main");
    expect(review.secondaryActionLabel).toBe("Cancel");
    expect(review.primaryActionLabel).toBe("Continue");

    expect(review.reviewSections?.map((section) => section.title)).toEqual([
      "Transaction #1",
      "Policy #1",
      "Policy #2",
      "Transaction #2",
    ]);

    const policyOne = review.reviewSections?.find(
      (section) => section.title === "Policy #1"
    );
    const policyTwo = review.reviewSections?.find(
      (section) => section.title === "Policy #2"
    );
    const transactionOne = review.reviewSections?.find(
      (section) => section.title === "Transaction #1"
    );
    const transactionTwo = review.reviewSections?.find(
      (section) => section.title === "Transaction #2"
    );
    const usdcMint = STABLECOIN_MINTS[Stablecoin.USDC].toBase58();

    expect(policyOne?.rows).toEqual(
      expect.arrayContaining([
        { label: "Policy", value: "Kamino yield policy" },
        { label: "Actions", value: "Deposit, withdraw" },
        expect.objectContaining({
          label: "Markets",
          value: "Kamino markets: Main, Figure, Maple, OnRe, Ethena",
        }),
        expect.objectContaining({
          label: "Mints",
          value: expect.stringContaining(
            `USDC (${usdcMint.slice(0, 4)}...${usdcMint.slice(-4)})`
          ),
        }),
      ])
    );
    expect(policyTwo?.rows).toEqual(
      expect.arrayContaining([
        { label: "Policy", value: "Swap policy" },
        { label: "Actions", value: "Swap" },
        { label: "Supported lanes", value: "Jupiter" },
        expect.objectContaining({
          label: "Mints",
          value: expect.stringContaining("USDC (EPjF...Dt1v)"),
        }),
      ])
    );

    expect(transactionOne?.rows).toEqual([
      {
        label: "Deposit",
        value: "Deposit $125.5 USDC into Earn vault",
      },
    ]);
    expect(transactionTwo?.rows).toEqual([
      {
        label: "Deposit",
        value:
          "Earn vault sends $125.5 USDC to Main Market USDC reserve (D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59)",
      },
    ]);
  });

  test("uses the Main Market USDC reserve without best-reserve data", () => {
    const review = buildEarnDepositReviewItem({
      draft: makeDraft(),
    });

    expect(review.destinationLabel).toBe("Earn vault");
    expect(review.summaryLabel).toBe("Launch yield optimization policy");
    expect(
      review.reviewSections?.find(
        (section) => section.title === "Transaction #1"
      )?.rows
    ).toEqual([
      {
        label: "Deposit",
        value: "Deposit $125.5 USDC into Earn vault",
      },
    ]);
    expect(
      review.reviewSections?.find(
        (section) => section.title === "Transaction #2"
      )?.rows
    ).toEqual([
      {
        label: "Deposit",
        value:
          "Earn vault sends $125.5 USDC to Main Market USDC reserve (D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59)",
      },
    ]);
  });
});

describe("buildEarnWithdrawReviewItem", () => {
  test("projects a partial withdraw draft into review sections", () => {
    const review = buildEarnWithdrawReviewItem({
      draft: makeWithdrawDraft(),
    });

    expect(review.title).toBe("Withdraw");
    expect(review.amount).toBe("25.25");
    expect(review.symbol).toBe("USDC");
    expect(review.summaryLabel).toBe("Withdraw from Earn vault");
    expect(review.sourceLabel).toBe("Earn vault");
    expect(review.destinationLabel).toBe("Main");
    expect(review.reviewSections?.map((section) => section.title)).toEqual([
      "Transaction #1",
    ]);
    expect(review.reviewSections?.[0]?.rows).toEqual([
      {
        label: "Withdraw",
        value: "Withdraw $25.25 USDC from Earn vault",
      },
      {
        label: "Destination",
        value: "Main (2Lzb...UQUu)",
      },
    ]);
  });

  test("labels full withdraw drafts as withdraw all", () => {
    const review = buildEarnWithdrawReviewItem({
      draft: makeWithdrawDraft({ mode: "full" }),
    });

    expect(review.title).toBe("Withdraw all");
    expect(review.reviewSections?.[0]?.rows[0]).toEqual({
      label: "Withdraw",
      value: "Withdraw all $25.25 USDC from Earn vault",
    });
  });
});
