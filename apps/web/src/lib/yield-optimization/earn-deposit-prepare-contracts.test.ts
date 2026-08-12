import { describe, expect, test } from "bun:test";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  hydratePreparedEarnUsdcDeposit,
  parseEarnDepositPrepareRequestBody,
  type WireSmartAccountPreparedEarnUsdcDeposit,
} from "./earn-deposit-prepare-contracts.shared";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("Earn deposit prepare request parsing", () => {
  test("parses a body with an explicit mint", () => {
    expect(
      parseEarnDepositPrepareRequestBody({
        amountRaw: "5000000",
        mint: USDC_MINT,
      })
    ).toEqual({ amountRaw: BigInt(5_000_000), mint: USDC_MINT });
  });

  test("accepts a legacy body without a mint (ASK-2099)", () => {
    // Pre-mint-selection mobile clients send only the amount; requiring the
    // field silently 400'd every mobile deposit.
    expect(
      parseEarnDepositPrepareRequestBody({ amountRaw: "5000000" })
    ).toEqual({ amountRaw: BigInt(5_000_000), mint: null });
  });

  test("still rejects a non-string mint", () => {
    expect(() =>
      parseEarnDepositPrepareRequestBody({ amountRaw: "5000000", mint: 5 })
    ).toThrow("mint must be a mint public key.");
  });
});

describe("Earn deposit prepared-wire hydration", () => {
  test("defaults a legacy wire without liquidityTokenProgram to the classic token program (ASK-2099)", () => {
    // Shipped mobile apps serialize targetReserve without the field; blindly
    // constructing a PublicKey from it 400'd every mobile deposit confirm.
    const wire: WireSmartAccountPreparedEarnUsdcDeposit = {
      kaminoSetupAccountCount: 0,
      kaminoSetupRentLamports: "0",
      kaminoSetupRequired: false,
      nativeSolRequirement: {} as never,
      persistence: {} as never,
      policy: {
        account: "11111111111111111111111111111112",
        id: "7",
        sameMintInstructionConstraintIndexes: [0, 1],
        seed: "7",
      },
      prepared: {
        instructions: [],
        lookupTableAccounts: [],
        operation: "earn-deposit",
        payer: "11111111111111111111111111111113",
        programId: "11111111111111111111111111111114",
        requiresConfirmation: true,
      },
      targetReserve: {
        liquidityMint: USDC_MINT,
        market: "11111111111111111111111111111115",
        obligation: "11111111111111111111111111111116",
        reserve: "11111111111111111111111111111117",
        supplyApyBps: null,
      },
      vault: {
        accountIndex: 1,
        collateralAta: null,
        pubkey: "11111111111111111111111111111118",
        usdcAta: "11111111111111111111111111111119",
      },
    };

    const hydrated = hydratePreparedEarnUsdcDeposit(wire);
    expect(
      hydrated.targetReserve.liquidityTokenProgram.equals(TOKEN_PROGRAM_ID)
    ).toBe(true);
    expect(hydrated.targetReserve.liquidityMint.toBase58()).toBe(USDC_MINT);
  });
});
