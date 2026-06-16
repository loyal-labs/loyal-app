import { describe, expect, test } from "bun:test";
import type {
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcWithdraw,
} from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import type {
  EarnDepositDraft,
  EarnWithdrawDraft,
} from "@/components/wallet-sidebar/earn-detail-view";

import {
  buildEarnDepositReviewItem,
  buildEarnWithdrawReviewItem,
} from "./earn-deposit-review";

const PUBLIC_KEY = new PublicKey("11111111111111111111111111111111");

const source = {
  addressLabel: "BAqg...6qZZ",
  balance: 100,
  balanceFraction: "00",
  balanceWhole: "100",
  decimals: 6,
  icon: "/wallet-workspace/earn-coin-icon.svg",
  id: "main",
  label: "Main",
  mint: PUBLIC_KEY.toBase58(),
};

const depositDraft = {
  amount: 10,
  amountLabel: "10.00",
  forecastApyBps: 500,
  source,
  symbol: "USDC",
  tokenDecimals: 6,
  tokenMint: PUBLIC_KEY.toBase58(),
} satisfies EarnDepositDraft;

const partialWithdrawDraft = {
  amount: 5,
  amountLabel: "5.00",
  destination: source,
  mode: "partial",
  symbol: "USDC",
  tokenDecimals: 6,
} satisfies EarnWithdrawDraft;

function textOf(value: unknown): string {
  return JSON.stringify(value);
}

function createPreparedDeposit(args: {
  finalize?: boolean;
  policyInitialization: "create" | "reuse";
  setup?: boolean;
}): SmartAccountPreparedEarnUsdcDeposit {
  return {
    kaminoSetupRequired: false,
    persistence: {
      liquidityMint: PUBLIC_KEY.toBase58(),
      market: PUBLIC_KEY.toBase58(),
      policyInitialization: args.policyInitialization,
      targetReserve: PUBLIC_KEY.toBase58(),
    },
    policy: {
      account: PUBLIC_KEY,
      seed: BigInt(7),
    },
    policyFinalizePrepared: args.finalize ? ({} as never) : null,
    policySetupPrepared: args.setup ? ({} as never) : null,
    targetReserve: {
      liquidityMint: PUBLIC_KEY,
      market: PUBLIC_KEY,
      obligation: PUBLIC_KEY,
      reserve: PUBLIC_KEY,
    },
  } as SmartAccountPreparedEarnUsdcDeposit;
}

function createPreparedWithdraw(): SmartAccountPreparedEarnUsdcWithdraw {
  return {
    targetReserve: {
      liquidityMint: PUBLIC_KEY,
      market: PUBLIC_KEY,
      obligation: PUBLIC_KEY,
      reserve: PUBLIC_KEY,
    },
  } as SmartAccountPreparedEarnUsdcWithdraw;
}

describe("Earn deposit review", () => {
  test("first deposit without finalize shows setup then deposit approvals", () => {
    const item = buildEarnDepositReviewItem({
      draft: depositDraft,
      preparedDeposit: createPreparedDeposit({
        policyInitialization: "create",
        setup: true,
      }),
      stage: "policy",
    });

    expect(item.pages?.[0]?.title).toBe("Approval 1 of 2");
    expect(item.reviewSections?.map((section) => section.title)).toEqual([
      "Approval #1",
      "Approval #2",
    ]);
    expect(textOf(item)).not.toContain("Jupiter");
    expect(textOf(item)).not.toContain("Main Market USDC");
    expect(textOf(item)).toContain("Safe same-mint USDC");
  });

  test("first deposit with finalize shows setup, finalize, and deposit approvals", () => {
    const item = buildEarnDepositReviewItem({
      draft: depositDraft,
      preparedDeposit: createPreparedDeposit({
        finalize: true,
        policyInitialization: "create",
        setup: true,
      }),
      stage: "policy-finalize",
    });

    expect(item.pages?.[0]?.title).toBe("Approval 2 of 3");
    expect(item.reviewSections?.map((section) => section.title)).toEqual([
      "Approval #1",
      "Approval #2",
      "Approval #3",
    ]);
    expect(textOf(item)).toContain("Set up Earn obligation");
  });

  test("top-up deposit shows a single deposit approval", () => {
    const item = buildEarnDepositReviewItem({
      draft: depositDraft,
      preparedDeposit: createPreparedDeposit({
        policyInitialization: "reuse",
      }),
      stage: "deposit",
    });

    expect(item.pages?.[0]?.title).toBe("Deposit");
    expect(item.reviewSections?.map((section) => section.title)).toEqual([
      "Transaction #1",
    ]);
    expect(item.primaryActionLabel).toBe("Deposit $10.00");
  });
});

describe("Earn withdrawal review", () => {
  test("partial withdrawal shows one withdrawal approval", () => {
    const item = buildEarnWithdrawReviewItem({
      draft: partialWithdrawDraft,
      preparedWithdraw: createPreparedWithdraw(),
      stage: "withdraw",
    });

    expect(item.reviewSections?.map((section) => section.title)).toEqual([
      "Transaction #1",
    ]);
    expect(textOf(item)).not.toContain("Autodeposit");
    expect(textOf(item)).toContain("Withdraw same-mint USDC");
  });

  test("full withdrawal without Autodeposit close shows one cleanup approval", () => {
    const item = buildEarnWithdrawReviewItem({
      draft: { ...partialWithdrawDraft, amountLabel: "10.00", mode: "full" },
      hasAutodepositTeardown: false,
      preparedWithdraw: createPreparedWithdraw(),
      stage: "withdraw",
    });

    expect(item.reviewSections?.map((section) => section.title)).toEqual([
      "Transaction #1",
    ]);
    expect(textOf(item)).toContain("remove the Earn policy");
  });

  test("full withdrawal with Autodeposit close shows close then final withdraw approvals", () => {
    const item = buildEarnWithdrawReviewItem({
      draft: { ...partialWithdrawDraft, amountLabel: "10.00", mode: "full" },
      hasAutodepositTeardown: true,
      preparedWithdraw: createPreparedWithdraw(),
      stage: "autodeposit",
    });

    expect(item.pages?.[0]?.title).toBe("Approval 1 of 2");
    expect(item.reviewSections?.map((section) => section.title)).toEqual([
      "Approval #1",
      "Approval #2",
    ]);
    expect(textOf(item)).toContain("Close recurring allowance");
  });
});
