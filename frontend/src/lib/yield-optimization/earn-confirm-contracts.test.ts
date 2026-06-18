import { describe, expect, test } from "bun:test";

import {
  buildEarnDepositConfirmRequestBody,
  buildEarnWithdrawalConfirmRequestBody,
  parseEarnDepositConfirmRequestBody,
  parseEarnWithdrawalConfirmRequestBody,
} from "./earn-confirm-contracts.shared";

describe("Earn deposit confirmation contracts", () => {
  test("uses the explicit policy signature separately from the deposit signature", () => {
    const body = buildEarnDepositConfirmRequestBody({
      confirmedSlot: "123",
      policyConfirmedSlot: "121",
      policySignature: "policy-setup-signature",
      preparedDeposit: {
        persistence: {
          cluster: "mainnet-beta",
          delegatedSigner: "delegate",
          depositMint: "mint",
          liquidityMint: "mint",
          market: "market",
          policyAccount: "policy",
          policyId: "7",
          policyInitialization: "create",
          policySeed: "7",
          principalAmountRaw: "1000000",
          settings: "settings",
          setupPolicyAccount: "setup-policy",
          setupPolicyId: "8",
          setupPolicySeed: "8",
          targetReserve: "reserve",
          targetSupplyApyBps: null,
          vaultIndex: 1,
          vaultPubkey: "vault",
          walletAddress: "wallet",
        },
      } as never,
      setupPolicyConfirmedSlot: "122",
      setupPolicySignature: "setup-policy-signature",
      signature: "deposit-signature",
      smartAccountAddress: "smart-account",
    });

    expect(body.policySignature).toBe("policy-setup-signature");
    expect(body.policyConfirmedSlot).toBe("121");
    expect(body.setupPolicySignature).toBe("setup-policy-signature");
    expect(body.setupPolicyConfirmedSlot).toBe("122");
    expect(body.depositSignature).toBe("deposit-signature");
    const parsed = parseEarnDepositConfirmRequestBody(body);
    expect(parsed.depositSignature).toBe("deposit-signature");
    expect(parsed.policyConfirmedSlot).toBe(BigInt(121));
    expect(parsed.policySignature).toBe("policy-setup-signature");
    expect(parsed.setupPolicyAccount).toBe("setup-policy");
    expect(parsed.setupPolicyConfirmedSlot).toBe(BigInt(122));
    expect(parsed.setupPolicySignature).toBe("setup-policy-signature");
  });
});

describe("Earn withdrawal confirmation contracts", () => {
  test("preserves bundled autodeposit close metadata through build and parse", () => {
    const body = buildEarnWithdrawalConfirmRequestBody({
      autodepositCloseConfirmedSlot: "122",
      autodepositCloseSignature: "autodeposit-close-signature",
      confirmedSlot: "123",
      preparedWithdraw: {
        persistence: {
          autodepositClose: {
            cluster: "mainnet-beta",
            delegatedSigner: "autodeposit-delegate",
            policyAccount: "autodeposit-policy",
            recurringDelegation: "recurring-delegation",
            settings: "settings",
            vaultIndex: 1,
            vaultPubkey: "vault",
            walletAddress: "wallet",
          },
          cluster: "mainnet-beta",
          delegatedSigner: "yield-delegate",
          liquidityMint: "mint",
          market: "market",
          mode: "full",
          policyAccount: "yield-policy",
          policyId: "7",
          policySeed: "7",
          settings: "settings",
          targetReserve: "reserve",
          vaultIndex: 1,
          vaultPubkey: "vault",
          walletAddress: "wallet",
          withdrawnAmountRaw: "1000000",
        },
      } as never,
      signature: "withdrawal-signature",
      smartAccountAddress: "smart-account",
    });

    expect(body.autodepositClose?.closeSignature).toBe(
      "autodeposit-close-signature"
    );
    expect(body.autodepositClose?.recurringDelegation).toBe(
      "recurring-delegation"
    );
    const parsed = parseEarnWithdrawalConfirmRequestBody(body);
    expect(parsed.autodepositClose?.closeSignature).toBe(
      "autodeposit-close-signature"
    );
    expect(parsed.autodepositClose?.confirmedSlot).toBe(BigInt(122));
    expect(parsed.autodepositClose?.policyAccount).toBe("autodeposit-policy");
    expect(parsed.confirmedSlot).toBe(BigInt(123));
    expect(parsed.mode).toBe("full");
    expect(parsed.withdrawalSignature).toBe("withdrawal-signature");
  });

  test("parses withdrawals without bundled autodeposit close metadata", () => {
    const parsed = parseEarnWithdrawalConfirmRequestBody({
      cluster: "mainnet-beta",
      confirmedSlot: "123",
      delegatedSigner: "yield-delegate",
      liquidityMint: "mint",
      market: "market",
      mode: "partial",
      policyAccount: "yield-policy",
      policyId: "7",
      policySeed: "7",
      settings: "settings",
      smartAccountAddress: "smart-account",
      targetReserve: "reserve",
      vaultIndex: 1,
      vaultPubkey: "vault",
      walletAddress: "wallet",
      withdrawalSignature: "withdrawal-signature",
      withdrawnAmountRaw: "1000000",
    });

    expect(parsed.autodepositClose).toBeUndefined();
    expect(parsed.mode).toBe("partial");
  });

  test("builds confirmation bodies from the selected withdraw step", () => {
    const body = buildEarnWithdrawalConfirmRequestBody({
      confirmedSlot: "123",
      preparedStep: {
        persistence: {
          accountingReserve: "accounting-reserve",
          cluster: "mainnet-beta",
          delegatedSigner: "yield-delegate",
          executionReserve: "execution-reserve",
          isFinalStep: false,
          liquidityMint: "mint",
          market: "market",
          mode: "partial",
          policyAccount: "yield-policy",
          policyId: "7",
          policySeed: "7",
          settings: "settings",
          stepCount: 2,
          stepIndex: 0,
          targetReserve: "accounting-reserve",
          vaultIndex: 1,
          vaultPubkey: "vault",
          walletAddress: "wallet",
          withdrawnAmountRaw: "400000",
        },
      } as never,
      preparedWithdraw: {
        persistence: {
          cluster: "mainnet-beta",
          delegatedSigner: "yield-delegate",
          liquidityMint: "mint",
          market: "market",
          mode: "full",
          policyAccount: "yield-policy",
          policyId: "7",
          policySeed: "7",
          settings: "settings",
          targetReserve: "final-reserve",
          vaultIndex: 1,
          vaultPubkey: "vault",
          walletAddress: "wallet",
          withdrawnAmountRaw: "1000000",
        },
      } as never,
      signature: "withdrawal-step-signature",
      smartAccountAddress: "smart-account",
    });

    expect(body.mode).toBe("partial");
    expect(body.stepIndex).toBe(0);
    expect(body.stepCount).toBe(2);
    expect(body.targetReserve).toBe("accounting-reserve");
    expect(body.withdrawnAmountRaw).toBe("400000");
    const parsed = parseEarnWithdrawalConfirmRequestBody(body);
    expect(parsed.accountingReserve).toBe("accounting-reserve");
    expect(parsed.executionReserve).toBe("execution-reserve");
    expect(parsed.isFinalStep).toBe(false);
    expect(parsed.mode).toBe("partial");
    expect(parsed.stepIndex).toBe(0);
    expect(parsed.withdrawnAmountRaw).toBe(BigInt(400_000));
  });

  test("parses selected source metadata", () => {
    const parsed = parseEarnWithdrawalConfirmRequestBody({
      cluster: "mainnet-beta",
      confirmedSlot: "123",
      delegatedSigner: "yield-delegate",
      liquidityMint: "mint",
      market: "market",
      mode: "full",
      policyAccount: "yield-policy",
      policyId: "7",
      policySeed: "7",
      settings: "settings",
      smartAccountAddress: "smart-account",
      sourceAmountRaw: "250000",
      sourceId: "idle-token-account",
      sourceMetadata: { tokenAccount: "idle-token-account" },
      sourceMint: "mint",
      sourceTokenAccount: "idle-token-account",
      sourceType: "idle",
      targetReserve: "reserve",
      vaultIndex: 1,
      vaultPubkey: "vault",
      walletAddress: "wallet",
      withdrawalSignature: "withdrawal-signature",
      withdrawnAmountRaw: "250000",
    });

    expect(parsed.sourceType).toBe("idle");
    expect(parsed.sourceId).toBe("idle-token-account");
    expect(parsed.sourceAmountRaw).toBe(BigInt(250_000));
    expect(parsed.sourceMetadata?.tokenAccount).toBe("idle-token-account");
  });
});
