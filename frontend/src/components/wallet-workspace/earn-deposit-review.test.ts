import { describe, expect, test } from "bun:test";
import type {
  SmartAccountPreparedEarnUsdcAutodepositSetup,
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcWithdraw,
} from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import type {
  EarnAutodepositDraft,
  EarnDepositDraft,
  EarnWithdrawDraft,
} from "@/components/wallet-sidebar/earn-detail-view";

import {
  buildEarnAutodepositSetupReviewItem,
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

const autodepositDraft = {
  amount: 100,
  amountLabel: "100.00",
  keepAmount: 500,
  keepAmountLabel: "500.00",
  nonce: BigInt(42),
  requiresSignature: true,
  source,
  symbol: "USDC",
  tokenDecimals: 6,
} satisfies EarnAutodepositDraft;

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

function createPreparedAutodepositSetup(
  stage: SmartAccountPreparedEarnUsdcAutodepositSetup["stage"]
): SmartAccountPreparedEarnUsdcAutodepositSetup {
  return {
    persistence: {
      policyAccount: PUBLIC_KEY.toBase58(),
      recurringDelegation: PUBLIC_KEY.toBase58(),
    },
    stage,
  } as SmartAccountPreparedEarnUsdcAutodepositSetup;
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

describe("Earn Autodeposit review", () => {
  test("cold-start approval one initializes only the allowance authority", () => {
    const item = buildEarnAutodepositSetupReviewItem({
      draft: autodepositDraft,
      preparedSetup: createPreparedAutodepositSetup(
        "initialize_subscription_authority"
      ),
      stage: "policy",
    });

    expect(item.pages?.[0]?.title).toBe("Approval 1 of 3");
    expect(item.pages?.[0]?.heading).toBe("Initialize allowance authority");
    expect(textOf(item.pages?.[0])).not.toContain("policy");
    expect(textOf(item.reviewSections?.[0])).toContain(
      "Initialize allowance authority"
    );
  });

  test("middle approval creates the policy by itself", () => {
    const item = buildEarnAutodepositSetupReviewItem({
      draft: autodepositDraft,
      preparedSetup: createPreparedAutodepositSetup("create_policy"),
      stage: "policy",
    });

    expect(item.pages?.[0]?.title).toBe("Approval 2 of 3");
    expect(item.pages?.[0]?.heading).toBe("Create policy");
    expect(textOf(item.pages?.[0])).toContain("Create Autodeposit policy");
    expect(item.primaryActionLabel).toBe("Create policy");
  });

  test("final approval creates recurring allowance", () => {
    const item = buildEarnAutodepositSetupReviewItem({
      draft: autodepositDraft,
      preparedSetup: createPreparedAutodepositSetup(
        "create_recurring_delegation"
      ),
      stage: "delegation",
    });

    expect(item.pages?.[0]?.title).toBe("Approval 3 of 3");
    expect(item.pages?.[0]?.heading).toBe("Create recurring allowance");
    expect(textOf(item.pages?.[0])).toContain("Create recurring allowance");
    expect(item.primaryActionLabel).toBe("Create allowance");
  });
});
