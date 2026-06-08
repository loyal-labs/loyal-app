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

    expect(review.reviewSections).toHaveLength(4);

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
        expect.objectContaining({ label: "Policy" }),
        expect.objectContaining({ label: "Actions", value: "Deposit, withdraw" }),
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
        expect.objectContaining({ label: "Policy" }),
        expect.objectContaining({ label: "Supported lanes", value: "Jupiter" }),
      ])
    );

    expect(transactionOne?.rows?.[0]).toMatchObject({
      label: "Deposit",
      value: expect.stringContaining("Earn vault"),
    });
    expect(transactionTwo?.rows?.[0]).toMatchObject({
      label: "Deposit",
      value: expect.stringContaining("Main Market USDC reserve"),
    });
  });

  test("uses the Main Market USDC reserve without best-reserve data", () => {
    const review = buildEarnDepositReviewItem({
      draft: makeDraft(),
    });

    const reserveTransfer = review.reviewSections?.find(
      (section) => section.title === "Transaction #2"
    )?.rows?.[0]?.value;

    expect(review.destinationLabel).toBe("Earn vault");
    expect(reserveTransfer).toContain("Main Market USDC reserve");
    expect(reserveTransfer).toContain("D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59");
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
    expect(review.reviewSections).toHaveLength(1);
    expect(review.reviewSections?.[0]?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Withdraw",
          value: expect.stringContaining("Earn vault"),
        }),
        expect.objectContaining({
          label: "Destination",
          value: expect.stringContaining("Main"),
        }),
      ])
    );
  });

  test("labels full withdraw drafts as withdraw all", () => {
    const review = buildEarnWithdrawReviewItem({
      draft: makeWithdrawDraft({ mode: "full" }),
    });

    expect(review.title).toBe("Withdraw all");
    expect(review.reviewSections?.[0]?.rows[0]).toMatchObject({
      label: "Withdraw",
      value: expect.stringContaining("Withdraw all"),
    });
  });
});
