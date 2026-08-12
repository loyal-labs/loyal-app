import { describe, expect, test } from "bun:test";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  hydratePreparedEarnUsdcWithdraw,
  parseEarnWithdrawPrepareRequestBody,
  type WireSmartAccountPreparedEarnUsdcWithdraw,
} from "./earn-withdraw-prepare-contracts.shared";

// The parser accepts two wire shapes: the current `{ amountRaw, sourceId }`
// and the legacy `{ amountRaw, mode, source }` every shipped mobile client
// still sends. Rejecting the legacy shape silently 400'd the whole mobile
// withdraw fleet (ASK-2099).
describe("Earn withdraw prepare request parsing", () => {
  test("parses the current sourceId body", () => {
    expect(
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "300000",
        sourceId: "reserve:abc",
      })
    ).toEqual({
      amountRaw: BigInt(300_000),
      sourceId: "reserve:abc",
      legacy: null,
    });
  });

  test("parses a max sourceId body", () => {
    expect(
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "max",
        sourceId: "idle:abc",
      })
    ).toEqual({ amountRaw: "max", sourceId: "idle:abc", legacy: null });
  });

  test("parses a legacy partial body with a source object (ASK-2099)", () => {
    expect(
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "300000",
        mode: "partial",
        source: {
          amountRaw: "400000",
          id: "reserve-pubkey",
          reserve: "reserve-pubkey",
          type: "reserve",
        },
      })
    ).toEqual({
      amountRaw: BigInt(300_000),
      sourceId: null,
      legacy: {
        mode: "partial",
        source: {
          amountRaw: "400000",
          id: "reserve-pubkey",
          liquidityMint: undefined,
          market: undefined,
          mint: undefined,
          reserve: "reserve-pubkey",
          tokenAccount: undefined,
          type: "reserve",
        },
      },
    });
  });

  test("parses a legacy full body with a null source (ASK-2099)", () => {
    expect(
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "1000000",
        mode: "full",
        source: null,
      })
    ).toEqual({
      amountRaw: BigInt(1_000_000),
      sourceId: null,
      legacy: { mode: "full", source: null },
    });
  });

  test("still rejects a body with neither sourceId nor mode", () => {
    expect(() =>
      parseEarnWithdrawPrepareRequestBody({ amountRaw: "1000" })
    ).toThrow("sourceId must be a non-empty string.");
  });

  test("rejects a legacy body with a max amount", () => {
    expect(() =>
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "max",
        mode: "full",
        source: null,
      })
    ).toThrow("amountRaw must be an unsigned integer string.");
  });

  test("rejects a legacy body with a malformed source", () => {
    expect(() =>
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "1000",
        mode: "partial",
        source: { id: "", type: "reserve" },
      })
    ).toThrow("source.id must be a non-empty string.");
  });
});

describe("Earn withdraw prepared-wire hydration", () => {
  test("defaults a legacy wire without liquidityTokenProgram to the classic token program (ASK-2099)", () => {
    // Shipped mobile apps serialize targetReserve without the field; blindly
    // constructing a PublicKey from it 400'd every mobile withdraw confirm.
    const wire: WireSmartAccountPreparedEarnUsdcWithdraw = {
      amountRaw: "1000000",
      mode: "partial",
      persistence: {} as never,
      policy: {
        account: "11111111111111111111111111111112",
        id: "7",
        sameMintInstructionConstraintIndexes: [0, 1],
        seed: "7",
        withdrawInstructionConstraintIndex: 0,
      },
      prepared: {
        instructions: [],
        lookupTableAccounts: [],
        operation: "earn-withdraw",
        payer: "11111111111111111111111111111113",
        programId: "11111111111111111111111111111114",
        requiresConfirmation: true,
      },
      targetReserve: {
        liquidityMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        market: "11111111111111111111111111111115",
        obligation: "11111111111111111111111111111116",
        reserve: "11111111111111111111111111111117",
      },
      vault: {
        accountIndex: 1,
        collateralAta: null,
        pubkey: "11111111111111111111111111111118",
        usdcAta: "11111111111111111111111111111119",
      },
    };

    const hydrated = hydratePreparedEarnUsdcWithdraw(wire);
    expect(
      hydrated.targetReserve?.liquidityTokenProgram.equals(TOKEN_PROGRAM_ID)
    ).toBe(true);
  });
});
