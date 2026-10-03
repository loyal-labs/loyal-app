import { describe, expect, test } from "bun:test";

import {
  hasCollateralUnitAmountSemantics,
  resolveYieldVaultExposureLiquidityAmountRaw,
  YieldVaultExposureUnitError,
} from "./yield-vault-exposure-units.shared";

const RESERVE = "reserve-a";
const SNAPSHOT_ID = BigInt(4242);

function expectExposureUnitError(
  run: () => unknown
): YieldVaultExposureUnitError {
  expect(run).toThrow(YieldVaultExposureUnitError);
  let caught: unknown = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  return caught as YieldVaultExposureUnitError;
}

describe("resolveYieldVaultExposureLiquidityAmountRaw", () => {
  test("passes liquidity-unit amounts through unchanged", () => {
    const amountRaw = BigInt(1_234_567);
    for (const planningMetadata of [
      { amountSemantics: "kamino_redeemable_liquidity" },
      { amount_semantics: "kamino_redeemable_liquidity" },
      {
        amountSemantics: "kamino_redeemable_liquidity",
        amount_semantics: "kamino_redeemable_liquidity",
      },
    ]) {
      expect(
        resolveYieldVaultExposureLiquidityAmountRaw({
          amountRaw,
          planningMetadata,
          reserve: RESERVE,
          snapshotId: SNAPSHOT_ID,
        })
      ).toBe(amountRaw);
    }
  });

  test("rejects invalid raw amounts even with known liquidity units", () => {
    for (const amountRaw of [-BigInt(1), BigInt("9223372036854775808")]) {
      expect(() =>
        resolveYieldVaultExposureLiquidityAmountRaw({
          amountRaw,
          planningMetadata: { amountSemantics: "kamino_redeemable_liquidity" },
          reserve: RESERVE,
        })
      ).toThrow("yield_vault_exposure_amount_out_of_range");
    }
  });

  test("rejects malformed aliases beside valid evidence", () => {
    expect(() =>
      resolveYieldVaultExposureLiquidityAmountRaw({
        amountRaw: BigInt(1),
        reserve: RESERVE,
        planningMetadata: {
          amountSemantics: "kamino_redeemable_liquidity",
          amount_semantics: 17,
        },
      })
    ).toThrow("yield_vault_exposure_amount_units_unknown");
  });

  test("converts collateral-unit amounts with the conversion recorded on the snapshot", () => {
    const amountRaw = BigInt(50_000_000); // 50 collateral units (8 decimals)
    const redeemableRaw = "49312500"; // 49.3125 liquidity (6 decimals)
    for (const planningMetadata of [
      {
        amountSemantics: "kamino_obligation_collateral_deposited_amount",
        redeemable_liquidity_amount_raw: redeemableRaw,
      },
      {
        amount_semantics: "kamino_obligation_collateral_deposited_amount",
        redeemable_source_liquidity_amount_raw: redeemableRaw,
      },
      {
        amountSemantics: "kamino_obligation_collateral_deposited_amount",
        amount_semantics: "kamino_obligation_collateral_deposited_amount",
        redeemable_liquidity_amount_raw: redeemableRaw,
        redeemable_source_liquidity_amount_raw: redeemableRaw,
      },
    ]) {
      expect(
        resolveYieldVaultExposureLiquidityAmountRaw({
          amountRaw,
          planningMetadata,
          reserve: RESERVE,
          snapshotId: SNAPSHOT_ID,
        })
      ).toBe(BigInt(redeemableRaw));
    }
  });

  test("never converts the collateral amount itself as liquidity", () => {
    // The historical defect: collateral raw read as six-decimal USDC raw
    // overstates exposure by the collateral:liquidity ratio.
    const error = expectExposureUnitError(() =>
      resolveYieldVaultExposureLiquidityAmountRaw({
        amountRaw: BigInt(50_000_000),
        planningMetadata: {
          amountSemantics: "kamino_obligation_collateral_deposited_amount",
        },
        reserve: RESERVE,
        snapshotId: SNAPSHOT_ID,
      })
    );
    expect(error.message).toBe(
      "yield_vault_exposure_conversion_evidence_missing"
    );
    expect(error.reserve).toBe(RESERVE);
    expect(error.snapshotId).toBe(SNAPSHOT_ID);
  });

  test("rejects amounts whose unit is missing or unrecognized", () => {
    for (const planningMetadata of [
      null,
      undefined,
      {},
      { amountSemantics: "some_future_semantics" },
    ]) {
      const error = expectExposureUnitError(() =>
        resolveYieldVaultExposureLiquidityAmountRaw({
          amountRaw: BigInt(100),
          planningMetadata,
          reserve: RESERVE,
          snapshotId: SNAPSHOT_ID,
        })
      );
      expect(error.message).toBe("yield_vault_exposure_amount_units_unknown");
    }
  });

  test("rejects contradictory amount-semantics aliases instead of picking one", () => {
    const error = expectExposureUnitError(() =>
      resolveYieldVaultExposureLiquidityAmountRaw({
        amountRaw: BigInt(100),
        planningMetadata: {
          amountSemantics: "kamino_redeemable_liquidity",
          amount_semantics: "kamino_obligation_collateral_deposited_amount",
        },
        reserve: RESERVE,
        snapshotId: SNAPSHOT_ID,
      })
    );
    expect(error.message).toBe("yield_vault_exposure_amount_units_unknown");
  });

  test("rejects contradictory conversion-evidence aliases instead of picking one", () => {
    const error = expectExposureUnitError(() =>
      resolveYieldVaultExposureLiquidityAmountRaw({
        amountRaw: BigInt(100),
        planningMetadata: {
          amountSemantics: "kamino_obligation_collateral_deposited_amount",
          redeemable_liquidity_amount_raw: "1000",
          redeemable_source_liquidity_amount_raw: "2000",
        },
        reserve: RESERVE,
        snapshotId: SNAPSHOT_ID,
      })
    );
    expect(error.message).toBe(
      "yield_vault_exposure_conversion_evidence_missing"
    );
  });

  test("rejects malformed conversion evidence", () => {
    for (const conversionRaw of ["", "-1000", "1.5", "1e9", " 1000", "abc"]) {
      const error = expectExposureUnitError(() =>
        resolveYieldVaultExposureLiquidityAmountRaw({
          amountRaw: BigInt(100),
          planningMetadata: {
            amountSemantics: "kamino_obligation_collateral_deposited_amount",
            redeemable_liquidity_amount_raw: conversionRaw,
          },
          reserve: RESERVE,
          snapshotId: SNAPSHOT_ID,
        })
      );
      expect(error.message).toBe(
        "yield_vault_exposure_conversion_evidence_missing"
      );
    }
  });

  test("rejects conversion evidence outside the Postgres BIGINT envelope", () => {
    const error = expectExposureUnitError(() =>
      resolveYieldVaultExposureLiquidityAmountRaw({
        amountRaw: BigInt(100),
        planningMetadata: {
          amountSemantics: "kamino_obligation_collateral_deposited_amount",
          redeemable_liquidity_amount_raw: "9223372036854775808",
        },
        reserve: RESERVE,
        snapshotId: SNAPSHOT_ID,
      })
    );
    expect(error.message).toBe(
      "yield_vault_exposure_conversion_evidence_out_of_range"
    );
  });

  test("accepts conversion evidence at the Postgres BIGINT bound", () => {
    expect(
      resolveYieldVaultExposureLiquidityAmountRaw({
        amountRaw: BigInt(100),
        planningMetadata: {
          amountSemantics: "kamino_obligation_collateral_deposited_amount",
          redeemable_liquidity_amount_raw: "9223372036854775807",
        },
        reserve: RESERVE,
        snapshotId: null,
      })
    ).toBe(BigInt("9223372036854775807"));
  });
});

describe("hasCollateralUnitAmountSemantics", () => {
  test("recognizes collateral-unit snapshots under both alias spellings", () => {
    expect(
      hasCollateralUnitAmountSemantics({
        amountSemantics: "kamino_obligation_collateral_deposited_amount",
      })
    ).toBe(true);
    expect(
      hasCollateralUnitAmountSemantics({
        amount_semantics: "kamino_obligation_collateral_deposited_amount",
      })
    ).toBe(true);
  });

  test("is false for liquidity semantics, other semantics, and absent metadata", () => {
    expect(
      hasCollateralUnitAmountSemantics({
        amountSemantics: "kamino_redeemable_liquidity",
      })
    ).toBe(false);
    expect(hasCollateralUnitAmountSemantics({})).toBe(false);
    expect(hasCollateralUnitAmountSemantics(null)).toBe(false);
  });
});
