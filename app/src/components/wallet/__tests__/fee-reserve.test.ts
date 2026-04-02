import { describe, expect, test } from "bun:test";

import { NATIVE_SOL_MINT, SOLANA_FEE_SOL } from "@/lib/constants";

import {
  getMaxAmountWithFeeReserve,
  getSendFeeReserveSol,
  getSwapFeeReserveSol,
  getSwapFlowFeeProfile,
  hasEnoughSolForFee,
} from "../fee-reserve";

describe("wallet fee reserve helpers", () => {
  test("uses a single fee for direct SOL sends", () => {
    expect(getSendFeeReserveSol("direct-sol-send")).toBe(SOLANA_FEE_SOL);
  });

  test("reserves three fees for private sends", () => {
    expect(getSendFeeReserveSol("private-send")).toBe(SOLANA_FEE_SOL * 3);
  });

  test("maps secure native SOL shield flow to the highest fee reserve path", () => {
    expect(
      getSwapFlowFeeProfile({
        activeTab: "secure",
        secureDirection: "shield",
        amountMint: NATIVE_SOL_MINT,
      })
    ).toEqual({
      flow: "shield-native-sol",
      amountAndFeeUseSameSolBalance: true,
    });
    expect(getSwapFeeReserveSol("shield-native-sol")).toBe(SOLANA_FEE_SOL * 6);
  });

  test("treats unshielded native SOL fees as coming from the regular wallet", () => {
    expect(
      getSwapFlowFeeProfile({
        activeTab: "secure",
        secureDirection: "unshield",
        amountMint: NATIVE_SOL_MINT,
      })
    ).toEqual({
      flow: "unshield-native-sol",
      amountAndFeeUseSameSolBalance: false,
    });
    expect(getSwapFeeReserveSol("unshield-native-sol")).toBe(
      SOLANA_FEE_SOL * 5
    );
  });

  test("subtracts the fee reserve when amount and fees use the same SOL balance", () => {
    expect(
      getMaxAmountWithFeeReserve({
        assetBalance: 1,
        feePayerSolBalance: 1,
        feeReserveSol: SOLANA_FEE_SOL * 2,
        amountAndFeeUseSameSolBalance: true,
      })
    ).toBe(1 - SOLANA_FEE_SOL * 2);
  });

  test("caps max amount at zero when a separate SOL fee payer cannot cover fees", () => {
    expect(
      getMaxAmountWithFeeReserve({
        assetBalance: 25,
        feePayerSolBalance: SOLANA_FEE_SOL * 2,
        feeReserveSol: SOLANA_FEE_SOL * 3,
        amountAndFeeUseSameSolBalance: false,
      })
    ).toBe(0);
    expect(hasEnoughSolForFee(SOLANA_FEE_SOL * 2, SOLANA_FEE_SOL * 3)).toBe(
      false
    );
  });

  test("allows the full asset balance when fees are paid from a separate SOL balance", () => {
    expect(
      getMaxAmountWithFeeReserve({
        assetBalance: 25,
        feePayerSolBalance: SOLANA_FEE_SOL * 4,
        feeReserveSol: SOLANA_FEE_SOL * 3,
        amountAndFeeUseSameSolBalance: false,
      })
    ).toBe(25);
  });
});
