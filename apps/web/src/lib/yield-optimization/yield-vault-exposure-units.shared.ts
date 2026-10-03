// Unit-resolution contract for yield vault exposure amounts, shared by the
// personal earnings reader and the position projection. Kept dependency-free
// (no "server-only", no imports) so the money-unit rules are testable in
// isolation.
//
// Kamino fleet snapshots publish a position's obligation collateral amount in
// amount_raw and the liquidity that collateral redeems to beside it in
// planning metadata. Personal earnings accrue on liquidity exposure
// (six-decimal stablecoin raw), so a collateral-unit amount must be converted
// with the conversion recorded on its own snapshot — current share prices
// cannot repair historical evidence. A funded amount whose units or recorded
// conversion are missing, contradictory, or out of range is rejected: it must
// not be read as USDC exposure, and it must not silently become zero.

export class YieldVaultExposureUnitError extends Error {
  readonly reserve: string;
  readonly snapshotId: bigint | null;

  constructor(
    message: string,
    evidence: { reserve: string; snapshotId?: bigint | null }
  ) {
    super(message);
    this.name = "YieldVaultExposureUnitError";
    this.reserve = evidence.reserve;
    this.snapshotId = evidence.snapshotId ?? null;
  }
}

const REDEEMABLE_LIQUIDITY_AMOUNT_SEMANTICS = new Set([
  "kamino_redeemable_liquidity",
]);

export const COLLATERAL_UNIT_AMOUNT_SEMANTICS = new Set([
  "kamino_obligation_collateral_deposited_amount",
]);

// Both spellings are published in the wild; when both appear they must agree.
const AMOUNT_SEMANTICS_METADATA_KEYS = [
  "amountSemantics",
  "amount_semantics",
] as const;

const REDEEMABLE_LIQUIDITY_RAW_METADATA_KEYS = [
  "redeemable_liquidity_amount_raw",
  "redeemable_source_liquidity_amount_raw",
] as const;

// Liquidity raw is a non-negative six-decimal stablecoin quantity. The pattern
// rejects signs, exponents, and separators, so BigInt() below cannot see a
// negative or fractional value.
const EXPOSURE_LIQUIDITY_RAW_PATTERN = /^[0-9]+$/;

// Postgres BIGINT upper bound: the resolved value is compared and persisted in
// BIGINT columns, so a conversion beyond it is unusable evidence, not a huge
// position.
const MAX_POSTGRES_BIGINT_RAW = BigInt("9223372036854775807");

type MetadataValueResolution =
  | { readonly kind: "absent" }
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "contradictory" };

function resolveMetadataStringValue(
  metadata: Record<string, unknown> | null | undefined,
  keys: readonly string[]
): MetadataValueResolution {
  if (!metadata) {
    return { kind: "absent" };
  }

  let value: string | null = null;
  for (const key of keys) {
    const raw = metadata[key];
    if (raw === undefined || raw === null) {
      continue;
    }
    if (typeof raw !== "string" || raw.length === 0) {
      return { kind: "contradictory" };
    }
    if (value !== null && value !== raw) {
      return { kind: "contradictory" };
    }
    value = raw;
  }

  return value === null ? { kind: "absent" } : { kind: "value", value };
}

export function hasCollateralUnitAmountSemantics(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  const semantics = resolveMetadataStringValue(
    metadata,
    AMOUNT_SEMANTICS_METADATA_KEYS
  );
  return (
    semantics.kind === "value" &&
    COLLATERAL_UNIT_AMOUNT_SEMANTICS.has(semantics.value)
  );
}

export function resolveYieldVaultExposureLiquidityAmountRaw(args: {
  amountRaw: bigint;
  planningMetadata: Record<string, unknown> | null | undefined;
  reserve: string;
  snapshotId?: bigint | null;
}): bigint {
  if (args.amountRaw < BigInt(0) || args.amountRaw > MAX_POSTGRES_BIGINT_RAW) {
    throw new YieldVaultExposureUnitError(
      "yield_vault_exposure_amount_out_of_range",
      { reserve: args.reserve, snapshotId: args.snapshotId }
    );
  }
  const semantics = resolveMetadataStringValue(
    args.planningMetadata,
    AMOUNT_SEMANTICS_METADATA_KEYS
  );
  // Contradictory alias spellings leave the amount's unit undecidable: the
  // snapshot cannot be trusted to say whether it holds liquidity or collateral.
  if (semantics.kind === "contradictory") {
    throw new YieldVaultExposureUnitError(
      "yield_vault_exposure_amount_units_unknown",
      { reserve: args.reserve, snapshotId: args.snapshotId }
    );
  }
  if (
    semantics.kind === "value" &&
    REDEEMABLE_LIQUIDITY_AMOUNT_SEMANTICS.has(semantics.value)
  ) {
    return args.amountRaw;
  }
  if (semantics.kind !== "value") {
    throw new YieldVaultExposureUnitError(
      "yield_vault_exposure_amount_units_unknown",
      { reserve: args.reserve, snapshotId: args.snapshotId }
    );
  }
  if (!COLLATERAL_UNIT_AMOUNT_SEMANTICS.has(semantics.value)) {
    throw new YieldVaultExposureUnitError(
      "yield_vault_exposure_amount_units_unknown",
      { reserve: args.reserve, snapshotId: args.snapshotId }
    );
  }

  const conversion = resolveMetadataStringValue(
    args.planningMetadata,
    REDEEMABLE_LIQUIDITY_RAW_METADATA_KEYS
  );
  if (
    conversion.kind !== "value" ||
    !EXPOSURE_LIQUIDITY_RAW_PATTERN.test(conversion.value)
  ) {
    throw new YieldVaultExposureUnitError(
      "yield_vault_exposure_conversion_evidence_missing",
      { reserve: args.reserve, snapshotId: args.snapshotId }
    );
  }
  const convertedLiquidityRaw = BigInt(conversion.value);
  if (convertedLiquidityRaw > MAX_POSTGRES_BIGINT_RAW) {
    throw new YieldVaultExposureUnitError(
      "yield_vault_exposure_conversion_evidence_out_of_range",
      { reserve: args.reserve, snapshotId: args.snapshotId }
    );
  }
  return convertedLiquidityRaw;
}
