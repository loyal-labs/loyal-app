import { describe, expect, test } from "bun:test";
import {
  assertExpectedMoneyState,
  KAMINO_INTEREST_TOLERANCE_RAW,
  reconcileMove,
} from "./move-reconciliation";
import {
  AUTODEPOSIT_STAGE_BY_SDK_STAGE,
  SPONSOR_SETUP_STAGES,
} from "./sponsor-protocol";
import { SponsorRequestError } from "./sponsor-validation";

const state = (wallet: bigint, smart: bigint, kamino: bigint) => ({
  walletUsdcRaw: wallet,
  smartAccountUsdcRaw: smart,
  kaminoUsdcRaw: kamino,
});

describe("expected money state", () => {
  test("accepts an exact match", () => {
    expect(() =>
      assertExpectedMoneyState(state(5n, 2n, 3n), state(5n, 2n, 3n))
    ).not.toThrow();
  });

  test("tolerates small Kamino interest drift but not wallet drift", () => {
    expect(() =>
      assertExpectedMoneyState(
        state(5n, 2n, 3n + KAMINO_INTEREST_TOLERANCE_RAW),
        state(5n, 2n, 3n)
      )
    ).not.toThrow();
    expect(() =>
      assertExpectedMoneyState(
        state(5n, 2n, 3n + KAMINO_INTEREST_TOLERANCE_RAW + 1n),
        state(5n, 2n, 3n)
      )
    ).toThrow(SponsorRequestError);
    expect(() =>
      assertExpectedMoneyState(state(6n, 2n, 3n), state(5n, 2n, 3n))
    ).toThrow(SponsorRequestError);
  });
});

describe("move reconciliation", () => {
  test("accepts the four fixed movements", () => {
    expect(() =>
      reconcileMove(
        "wallet_to_smart_account",
        state(3_000_000n, 0n, 0n),
        state(1_000_000n, 2_000_000n, 0n)
      )
    ).not.toThrow();
    expect(() =>
      reconcileMove(
        "smart_account_to_kamino",
        state(1_000_000n, 2_000_000n, 0n),
        state(1_000_000n, 0n, 1_999_999n)
      )
    ).not.toThrow();
    expect(() =>
      reconcileMove(
        "kamino_to_smart_account",
        state(1_000_000n, 0n, 2_000_000n),
        state(1_000_000n, 1_000_001n, 999_999n)
      )
    ).not.toThrow();
    expect(() =>
      reconcileMove(
        "smart_account_to_wallet",
        state(1_000_000n, 1_000_000n, 1_000_000n),
        state(2_000_000n, 0n, 1_000_000n)
      )
    ).not.toThrow();
  });

  test("keeps the landed signature on a reconciliation failure", () => {
    let caught: unknown;
    try {
      reconcileMove(
        "wallet_to_smart_account",
        state(3_000_000n, 0n, 0n),
        state(3_000_000n, 0n, 0n),
        "signature123"
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SponsorRequestError);
    expect((caught as SponsorRequestError).signature).toBe("signature123");
    expect((caught as SponsorRequestError).status).toBe(502);
  });
});

describe("sponsor protocol", () => {
  test("the shared autodeposit stage map covers exactly the four autodeposit stages", () => {
    const mapped: string[] = Object.values(AUTODEPOSIT_STAGE_BY_SDK_STAGE);
    const autodepositStages: string[] = SPONSOR_SETUP_STAGES.filter((stage) =>
      stage.startsWith("autodeposit-")
    );
    expect(new Set(mapped)).toEqual(new Set(autodepositStages));
    expect(mapped).toHaveLength(autodepositStages.length);
  });
});
