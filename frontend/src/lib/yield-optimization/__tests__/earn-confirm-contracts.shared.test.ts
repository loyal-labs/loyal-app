import { describe, expect, test } from "bun:test";
import { LoyalCluster } from "@loyal/actions";
import type {
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcWithdraw,
  SmartAccountPreparedEarnUsdcYieldRoutingPolicy,
} from "@loyal-labs/smart-account-vaults";

import {
  buildEarnDepositConfirmRequestBody,
  buildEarnPolicyConfirmRequestBody,
  buildEarnWithdrawalConfirmRequestBody,
  parseEarnDepositConfirmRequestBody,
  parseEarnPolicyConfirmRequestBody,
  parseEarnWithdrawalConfirmRequestBody,
} from "../earn-confirm-contracts.shared";

const policyPersistence = {
  cluster: LoyalCluster.Devnet,
  liquidityMint: "usdc-mint",
  market: "kamino-market",
  policyAccount: "policy-account",
  policyId: "2",
  policySeed: "2",
  settings: "settings-pda",
  targetReserve: "target-reserve",
  vaultIndex: 1,
  vaultPubkey: "vault-pubkey",
  walletAddress: "wallet-address",
} as const;

const depositPersistence = {
  ...policyPersistence,
  depositMint: "usdc-mint",
  policyInitialization: "reuse" as const,
  principalAmountRaw: "1000000",
  targetSupplyApyBps: null,
};

const withdrawalPersistence = {
  ...policyPersistence,
  mode: "partial" as const,
  withdrawnAmountRaw: "250000",
};

const preparedPolicy = {
  persistence: policyPersistence,
} as SmartAccountPreparedEarnUsdcYieldRoutingPolicy;

const preparedDeposit = {
  persistence: depositPersistence,
} as SmartAccountPreparedEarnUsdcDeposit;

const preparedWithdraw = {
  persistence: withdrawalPersistence,
} as SmartAccountPreparedEarnUsdcWithdraw;

describe("earn confirm shared contracts", () => {
  test("builds the current policy confirm request body shape", () => {
    expect(
      buildEarnPolicyConfirmRequestBody({
        confirmedSlot: "123",
        preparedPolicy,
        signature: "policy-sig",
      })
    ).toEqual({
      ...policyPersistence,
      confirmedSlot: "123",
      policySignature: "policy-sig",
    });
  });

  test("builds the current deposit confirm request body shape", () => {
    expect(
      buildEarnDepositConfirmRequestBody({
        confirmedSlot: "123",
        policySignature: "policy-sig",
        preparedDeposit,
        signature: "deposit-sig",
        smartAccountAddress: "smart-account",
      })
    ).toEqual({
      ...depositPersistence,
      confirmedSlot: "123",
      depositSignature: "deposit-sig",
      policySignature: "policy-sig",
      smartAccountAddress: "smart-account",
    });
  });

  test("defaults deposit policy signature to the deposit signature", () => {
    expect(
      buildEarnDepositConfirmRequestBody({
        confirmedSlot: "123",
        preparedDeposit,
        signature: "deposit-sig",
        smartAccountAddress: "smart-account",
      }).policySignature
    ).toBe("deposit-sig");
  });

  test("builds the current withdrawal confirm request body shape", () => {
    expect(
      buildEarnWithdrawalConfirmRequestBody({
        confirmedSlot: "123",
        preparedWithdraw,
        signature: "withdrawal-sig",
        smartAccountAddress: "smart-account",
      })
    ).toEqual({
      ...withdrawalPersistence,
      confirmedSlot: "123",
      smartAccountAddress: "smart-account",
      withdrawalSignature: "withdrawal-sig",
    });
  });

  test("parses policy confirm integer strings as bigint", () => {
    expect(
      parseEarnPolicyConfirmRequestBody({
        ...policyPersistence,
        confirmedSlot: "123",
        policySignature: "policy-sig",
      })
    ).toMatchObject({
      confirmedSlot: BigInt(123),
      policyId: BigInt(2),
      policySeed: BigInt(2),
    });
  });

  test("parses deposit confirm integer strings as bigint", () => {
    expect(
      parseEarnDepositConfirmRequestBody({
        ...depositPersistence,
        confirmedSlot: "123",
        depositSignature: "deposit-sig",
        policySignature: "policy-sig",
        smartAccountAddress: "smart-account",
        targetSupplyApyBps: "523",
      })
    ).toMatchObject({
      confirmedSlot: BigInt(123),
      policyId: BigInt(2),
      policySeed: BigInt(2),
      principalAmountRaw: BigInt(1_000_000),
      targetSupplyApyBps: BigInt(523),
    });
  });

  test("parses withdrawal confirm integer strings as bigint", () => {
    expect(
      parseEarnWithdrawalConfirmRequestBody({
        ...withdrawalPersistence,
        confirmedSlot: "123",
        smartAccountAddress: "smart-account",
        withdrawalSignature: "withdrawal-sig",
      })
    ).toMatchObject({
      confirmedSlot: BigInt(123),
      policyId: BigInt(2),
      policySeed: BigInt(2),
      withdrawnAmountRaw: BigInt(250_000),
    });
  });

  test("deposit parser accepts only create or reuse policy initialization", () => {
    expect(
      parseEarnDepositConfirmRequestBody({
        ...depositPersistence,
        confirmedSlot: "123",
        depositSignature: "deposit-sig",
        policyInitialization: "create",
        policySignature: "policy-sig",
        smartAccountAddress: "smart-account",
      }).policyInitialization
    ).toBe("create");

    expect(() =>
      parseEarnDepositConfirmRequestBody({
        ...depositPersistence,
        confirmedSlot: "123",
        depositSignature: "deposit-sig",
        policyInitialization: "split",
        policySignature: "policy-sig",
        smartAccountAddress: "smart-account",
      })
    ).toThrow("policyInitialization must be create or reuse.");
  });

  test("withdrawal parser accepts only partial or full mode", () => {
    expect(
      parseEarnWithdrawalConfirmRequestBody({
        ...withdrawalPersistence,
        confirmedSlot: "123",
        mode: "full",
        smartAccountAddress: "smart-account",
        withdrawalSignature: "withdrawal-sig",
      }).mode
    ).toBe("full");

    expect(() =>
      parseEarnWithdrawalConfirmRequestBody({
        ...withdrawalPersistence,
        confirmedSlot: "123",
        mode: "all",
        smartAccountAddress: "smart-account",
        withdrawalSignature: "withdrawal-sig",
      })
    ).toThrow("mode must be partial or full.");
  });

  test("preserves current validation messages for invalid or missing fields", () => {
    expect(() => parseEarnPolicyConfirmRequestBody(null)).toThrow(
      "Request body must be an object."
    );
    expect(() =>
      parseEarnPolicyConfirmRequestBody({
        ...policyPersistence,
        confirmedSlot: "123",
        policySignature: "policy-sig",
        vaultIndex: "1",
      })
    ).toThrow("vaultIndex must be an integer between 0 and 32767.");
    expect(() =>
      parseEarnPolicyConfirmRequestBody({
        ...policyPersistence,
        confirmedSlot: "abc",
        policySignature: "policy-sig",
      })
    ).toThrow("confirmedSlot must be an unsigned integer string.");
    expect(() =>
      parseEarnPolicyConfirmRequestBody({
        ...policyPersistence,
        confirmedSlot: "123",
        market: 1,
        policySignature: "policy-sig",
      })
    ).toThrow("market must be a string when provided.");
    expect(() =>
      parseEarnPolicyConfirmRequestBody({
        ...policyPersistence,
        confirmedSlot: "123",
        policySignature: "",
      })
    ).toThrow("policySignature must be a non-empty string.");
  });
});
