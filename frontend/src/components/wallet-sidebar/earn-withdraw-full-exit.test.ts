import { describe, expect, test } from "bun:test";

import {
  deriveEarnWithdrawMode,
  type EarnWithdrawSourceOption,
  selectEarnFullExitSources,
} from "./earn-detail-view";

// A full exit closes the position + policies and reclaims rent, so it may only
// mean "empty ALL of Earn". These lock down the two halves of that:
//   1. mode "full" is derived against the WHOLE position, never one source
//      (maxing a small source next to a large one must stay partial).
//   2. even a full exit authorizes only the selected source; cleanup is gated
//      separately by a fresh all-source zero proof.
// The single-source path — every ordinary wallet — must be unchanged.

function reserveSource(
  sourceId: string,
  balance: number
): EarnWithdrawSourceOption {
  return {
    amountRaw: String(Math.round(balance * 1_000_000)),
    balance,
    icon: "",
    id: `reserve:${sourceId}`,
    label: `${sourceId} reserve`,
    liquidityMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    market: `market-${sourceId}`,
    reserve: sourceId,
    sourceId,
    tokenAccount: null,
    tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    type: "reserve",
  };
}

const mainReserve = reserveSource("main", 5000);
const secondReserve = reserveSource("second", 50);

describe("Earn withdraw mode derivation", () => {
  test("maxing the only source is a full exit", () => {
    expect(
      deriveEarnWithdrawMode({ amount: 5000, sources: [mainReserve] })
    ).toBe("full");
  });

  test("maxing one of several sources stays partial", () => {
    // The user asked for the $50 source. Draining their $5,000 position too
    // would be a catastrophe, so this must never resolve to a full exit.
    expect(
      deriveEarnWithdrawMode({
        amount: 50,
        sources: [mainReserve, secondReserve],
      })
    ).toBe("partial");
  });

  test("emptying the last source is a full exit", () => {
    expect(
      deriveEarnWithdrawMode({ amount: 50, sources: [secondReserve] })
    ).toBe("full");
  });

  test("sub-cent dust in another reserve keeps the withdrawal partial", () => {
    expect(
      deriveEarnWithdrawMode({
        amount: 50,
        sources: [secondReserve, reserveSource("dust", 0.000_001)],
      })
    ).toBe("partial");
  });
});

describe("Earn full-exit sources", () => {
  test("a single-reserve full exit is unchanged (selected source only)", () => {
    expect(
      selectEarnFullExitSources({
        fullExitSources: [mainReserve],
        mode: "full",
        source: mainReserve,
      })
    ).toEqual([mainReserve]);
  });

  test("a full exit never expands beyond the selected reserve", () => {
    expect(
      selectEarnFullExitSources({
        fullExitSources: [mainReserve, secondReserve],
        mode: "full",
        source: secondReserve,
      })
    ).toEqual([secondReserve]);
  });

  test("a partial withdrawal never unwinds other reserves", () => {
    expect(
      selectEarnFullExitSources({
        fullExitSources: [mainReserve, secondReserve],
        mode: "partial",
        source: secondReserve,
      })
    ).toEqual([]);
  });

  test("an idle-source exit adds no reserve targets", () => {
    const idle: EarnWithdrawSourceOption = {
      ...reserveSource("idle", 10),
      market: null,
      reserve: null,
      tokenAccount: "vault-usdc-ata",
      type: "idle",
    };

    expect(
      selectEarnFullExitSources({
        fullExitSources: [],
        mode: "full",
        source: idle,
      })
    ).toEqual([]);
  });
});
