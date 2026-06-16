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
    expect(parseEarnDepositConfirmRequestBody(body)).toMatchObject({
      depositSignature: "deposit-signature",
      policyConfirmedSlot: BigInt(121),
      policySignature: "policy-setup-signature",
      setupPolicyAccount: "setup-policy",
      setupPolicyConfirmedSlot: BigInt(122),
      setupPolicyId: BigInt(8),
      setupPolicySeed: BigInt(8),
      setupPolicySignature: "setup-policy-signature",
    });
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

    expect(body.autodepositClose).toMatchObject({
      closeSignature: "autodeposit-close-signature",
      confirmedSlot: "122",
      delegatedSigner: "autodeposit-delegate",
      policyAccount: "autodeposit-policy",
      recurringDelegation: "recurring-delegation",
    });
    expect(parseEarnWithdrawalConfirmRequestBody(body)).toMatchObject({
      autodepositClose: {
        closeSignature: "autodeposit-close-signature",
        confirmedSlot: BigInt(122),
        delegatedSigner: "autodeposit-delegate",
        policyAccount: "autodeposit-policy",
        recurringDelegation: "recurring-delegation",
      },
      confirmedSlot: BigInt(123),
      mode: "full",
      withdrawalSignature: "withdrawal-signature",
    });
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
    expect(parsed).toMatchObject({
      mode: "partial",
    });
  });
});
