import { Connection, PublicKey } from "@solana/web3.js";
import {
  KLEND_ALT_MARKET,
  KLEND_MAIN_MARKET,
  KLEND_PROGRAM_ID,
  KLEND_SOL_RESERVE,
  KLEND_USDC_RESERVE,
  KLEND_USDT_RESERVE,
  USDC_MINT,
  USDT_MINT,
  WSOL_MINT,
} from "./constants";

const KLEND_RESERVE_DISCRIMINATOR = Buffer.from([
  43, 242, 204, 202, 26, 247, 59, 127,
]);
const KLEND_LENDING_MARKET_DISCRIMINATOR = Buffer.from([
  246, 114, 50, 98, 72, 157, 28, 120,
]);
const FRACTION_BITS = 60n;
const FRACTION_SCALE = 1n << FRACTION_BITS;
const BPS_DENOMINATOR = 10_000n;
const PCT_DENOMINATOR = 100n;
const SLOTS_PER_YEAR = 63_072_000n;
const RESERVE_CONFIG_OFFSET = 4_848;

const RESERVE_OFFSETS = {
  lastUpdateSlot: 8,
  lendingMarket: 24,
  reserveLiquidityMint: 120,
  reserveLiquiditySupply: 152,
  availableAmount: 216,
  borrowedAmountSf: 224,
  accumulatedProtocolFeesSf: 336,
  accumulatedReferrerFeesSf: 352,
  pendingReferrerFeesSf: 368,
  liquidityTokenProgram: 400,
  reserveCollateralMint: 2552,
  reserveCollateralMintSupply: 2584,
  hostFixedInterestRateBps: RESERVE_CONFIG_OFFSET + 2,
  protocolTakeRatePct: RESERVE_CONFIG_OFFSET + 10,
  borrowRateCurve: RESERVE_CONFIG_OFFSET + 60,
} as const;

const LENDING_MARKET_OFFSETS = {
  referralFeeBps: 112,
} as const;

const BORROW_RATE_CURVE_POINTS = 11;
const CURVE_POINT_SIZE = 8;

interface BorrowRateCurvePoint {
  utilizationRateBps: number;
  borrowRateBps: number;
}

export interface KlendSupportedReserve {
  lendingMarket: PublicKey;
  reserve: PublicKey;
}

export interface KlendReserveSnapshot extends KlendSupportedReserve {
  reserveLiquidityMint: PublicKey;
  reserveLiquiditySupply: PublicKey;
  reserveCollateralMint: PublicKey;
  liquidityTokenProgram: PublicKey;
  availableAmount: bigint;
  collateralSupply: bigint;
  staleTotalSupplySf: bigint;
  totalSupplySf: bigint;
  currentSlot: bigint;
  lastUpdateSlot: bigint;
  borrowedAmountSf: bigint;
  accumulatedProtocolFeesSf: bigint;
  accumulatedReferrerFeesSf: bigint;
  pendingReferrerFeesSf: bigint;
  hostFixedInterestRateBps: number;
  protocolTakeRatePct: number;
  referralFeeBps: number;
  borrowRateCurve: BorrowRateCurvePoint[];
}

export function getSupportedKlendReserve(
  tokenMint: PublicKey
): KlendSupportedReserve | null {
  if (tokenMint.equals(WSOL_MINT)) {
    return { lendingMarket: KLEND_MAIN_MARKET, reserve: KLEND_SOL_RESERVE };
  }
  if (tokenMint.equals(USDC_MINT)) {
    return { lendingMarket: KLEND_ALT_MARKET, reserve: KLEND_USDC_RESERVE };
  }
  if (tokenMint.equals(USDT_MINT)) {
    return { lendingMarket: KLEND_MAIN_MARKET, reserve: KLEND_USDT_RESERVE };
  }
  return null;
}

export async function fetchKlendReserveSnapshot(
  connection: Connection,
  tokenMint: PublicKey
): Promise<KlendReserveSnapshot> {
  const supported = getSupportedKlendReserve(tokenMint);
  if (!supported) {
    throw new Error(`Unsupported Kamino token mint ${tokenMint.toBase58()}`);
  }

  const [accounts, currentSlot] = await Promise.all([
    connection.getMultipleAccountsInfo(
      [supported.reserve, supported.lendingMarket],
      "confirmed"
    ),
    connection.getSlot("confirmed"),
  ]);
  const [reserveAccountInfo, lendingMarketAccountInfo] = accounts;

  if (!reserveAccountInfo) {
    throw new Error(`KLend reserve ${supported.reserve.toBase58()} not found`);
  }
  if (!lendingMarketAccountInfo) {
    throw new Error(
      `KLend market ${supported.lendingMarket.toBase58()} not found`
    );
  }
  if (!reserveAccountInfo.owner.equals(KLEND_PROGRAM_ID)) {
    throw new Error(
      `KLend reserve ${supported.reserve.toBase58()} has unexpected owner ${reserveAccountInfo.owner.toBase58()}`
    );
  }
  if (!lendingMarketAccountInfo.owner.equals(KLEND_PROGRAM_ID)) {
    throw new Error(
      `KLend market ${supported.lendingMarket.toBase58()} has unexpected owner ${lendingMarketAccountInfo.owner.toBase58()}`
    );
  }
  if (
    !reserveAccountInfo.data.subarray(0, 8).equals(KLEND_RESERVE_DISCRIMINATOR)
  ) {
    throw new Error(
      `KLend reserve ${supported.reserve.toBase58()} has invalid discriminator`
    );
  }
  if (
    !lendingMarketAccountInfo.data
      .subarray(0, 8)
      .equals(KLEND_LENDING_MARKET_DISCRIMINATOR)
  ) {
    throw new Error(
      `KLend market ${supported.lendingMarket.toBase58()} has invalid discriminator`
    );
  }

  const reserveData = reserveAccountInfo.data.subarray(8);
  const lendingMarketData = lendingMarketAccountInfo.data.subarray(8);
  const lendingMarket = readPublicKey(
    reserveData,
    RESERVE_OFFSETS.lendingMarket
  );
  const reserveLiquidityMint = readPublicKey(
    reserveData,
    RESERVE_OFFSETS.reserveLiquidityMint
  );
  const reserveLiquiditySupply = readPublicKey(
    reserveData,
    RESERVE_OFFSETS.reserveLiquiditySupply
  );
  const reserveCollateralMint = readPublicKey(
    reserveData,
    RESERVE_OFFSETS.reserveCollateralMint
  );
  const liquidityTokenProgram = readPublicKey(
    reserveData,
    RESERVE_OFFSETS.liquidityTokenProgram
  );
  const availableAmount = readU64(reserveData, RESERVE_OFFSETS.availableAmount);
  const borrowedAmountSf = readU128(
    reserveData,
    RESERVE_OFFSETS.borrowedAmountSf
  );
  const accumulatedProtocolFeesSf = readU128(
    reserveData,
    RESERVE_OFFSETS.accumulatedProtocolFeesSf
  );
  const accumulatedReferrerFeesSf = readU128(
    reserveData,
    RESERVE_OFFSETS.accumulatedReferrerFeesSf
  );
  const pendingReferrerFeesSf = readU128(
    reserveData,
    RESERVE_OFFSETS.pendingReferrerFeesSf
  );
  const collateralSupply = readU64(
    reserveData,
    RESERVE_OFFSETS.reserveCollateralMintSupply
  );
  const lastUpdateSlot = readU64(reserveData, RESERVE_OFFSETS.lastUpdateSlot);
  const hostFixedInterestRateBps = readU16(
    reserveData,
    RESERVE_OFFSETS.hostFixedInterestRateBps
  );
  const protocolTakeRatePct = reserveData.readUInt8(
    RESERVE_OFFSETS.protocolTakeRatePct
  );
  const borrowRateCurve = readBorrowRateCurvePoints(
    reserveData,
    RESERVE_OFFSETS.borrowRateCurve
  );
  const referralFeeBps = readU16(
    lendingMarketData,
    LENDING_MARKET_OFFSETS.referralFeeBps
  );
  const staleTotalSupplySf =
    (availableAmount << FRACTION_BITS) +
    borrowedAmountSf -
    accumulatedProtocolFeesSf -
    accumulatedReferrerFeesSf -
    pendingReferrerFeesSf;

  if (!lendingMarket.equals(supported.lendingMarket)) {
    throw new Error(
      `KLend reserve ${supported.reserve.toBase58()} points at unexpected market ${lendingMarket.toBase58()}`
    );
  }
  if (!reserveLiquidityMint.equals(tokenMint)) {
    throw new Error(
      `KLend reserve ${supported.reserve.toBase58()} points at unexpected mint ${reserveLiquidityMint.toBase58()}`
    );
  }

  const snapshot: KlendReserveSnapshot = {
    lendingMarket,
    reserve: supported.reserve,
    reserveLiquidityMint,
    reserveLiquiditySupply,
    reserveCollateralMint,
    liquidityTokenProgram,
    availableAmount,
    collateralSupply,
    staleTotalSupplySf,
    totalSupplySf: staleTotalSupplySf,
    currentSlot: BigInt(currentSlot),
    lastUpdateSlot,
    borrowedAmountSf,
    accumulatedProtocolFeesSf,
    accumulatedReferrerFeesSf,
    pendingReferrerFeesSf,
    hostFixedInterestRateBps,
    protocolTakeRatePct,
    referralFeeBps,
    borrowRateCurve,
  };
  snapshot.totalSupplySf = estimateRefreshedTotalSupplySf(snapshot);

  return snapshot;
}

export function quoteSharesFromUnderlyingFloor(
  underlyingAmount: bigint,
  snapshot: KlendReserveSnapshot
): bigint {
  if (underlyingAmount <= 0n) return 0n;
  if (snapshot.collateralSupply === 0n || snapshot.totalSupplySf === 0n) {
    return underlyingAmount;
  }
  return (
    (underlyingAmount * snapshot.collateralSupply * FRACTION_SCALE) /
    snapshot.totalSupplySf
  );
}

export function quoteSharesFromUnderlyingCeil(
  underlyingAmount: bigint,
  snapshot: KlendReserveSnapshot
): bigint {
  if (underlyingAmount <= 0n) return 0n;
  if (snapshot.collateralSupply === 0n || snapshot.totalSupplySf === 0n) {
    return underlyingAmount;
  }
  const numerator =
    underlyingAmount * snapshot.collateralSupply * FRACTION_SCALE;
  return (numerator + snapshot.totalSupplySf - 1n) / snapshot.totalSupplySf;
}

export function quoteUnderlyingFromSharesFloor(
  shareAmount: bigint,
  snapshot: KlendReserveSnapshot
): bigint {
  if (shareAmount <= 0n) return 0n;
  if (snapshot.collateralSupply === 0n || snapshot.totalSupplySf === 0n) {
    return shareAmount;
  }
  return (
    (shareAmount * snapshot.totalSupplySf) /
    snapshot.collateralSupply /
    FRACTION_SCALE
  );
}

export function estimateSupplyApr(snapshot: KlendReserveSnapshot): number {
  if (snapshot.borrowedAmountSf === 0n || snapshot.totalSupplySf === 0n) {
    return 0;
  }

  const utilization =
    snapshot.borrowedAmountSf > snapshot.totalSupplySf
      ? 1
      : Number(snapshot.borrowedAmountSf) / Number(snapshot.totalSupplySf);
  const borrowApr =
    Number(computeCurrentBorrowRateSf(snapshot)) / Number(FRACTION_SCALE);
  const protocolTakeRate = 1 - snapshot.protocolTakeRatePct / 100;
  return utilization * borrowApr * protocolTakeRate;
}

export function estimateSupplyApy(snapshot: KlendReserveSnapshot): number {
  const apr = estimateSupplyApr(snapshot);
  if (apr <= 0) return 0;
  return (1 + apr / 365) ** 365 - 1;
}

export function estimateFutureReserveSnapshot(
  snapshot: KlendReserveSnapshot,
  futureSlot: bigint
): KlendReserveSnapshot {
  const nextCurrentSlot =
    futureSlot > snapshot.currentSlot ? futureSlot : snapshot.currentSlot;
  const estimatedSnapshot: KlendReserveSnapshot = {
    ...snapshot,
    currentSlot: nextCurrentSlot,
    totalSupplySf: snapshot.staleTotalSupplySf,
  };
  estimatedSnapshot.totalSupplySf =
    estimateRefreshedTotalSupplySf(estimatedSnapshot);
  return estimatedSnapshot;
}

export function estimateUnderlyingFromSharesAtSlot(
  shareAmount: bigint,
  snapshot: KlendReserveSnapshot,
  futureSlot: bigint
): bigint {
  return quoteUnderlyingFromSharesFloor(
    shareAmount,
    estimateFutureReserveSnapshot(snapshot, futureSlot)
  );
}

export function estimateWarpSlotsForRequiredYield(
  snapshot: KlendReserveSnapshot,
  shareAmount: bigint,
  requiredYieldAmount: bigint,
  minWarpSlots = 0n,
  maxWarpSlots = SLOTS_PER_YEAR * 5n
): bigint {
  if (requiredYieldAmount <= 0n) {
    return minWarpSlots;
  }

  const principal = quoteUnderlyingFromSharesFloor(shareAmount, snapshot);
  if (principal === 0n) {
    return minWarpSlots;
  }

  const baseSlot = snapshot.currentSlot;
  const gainAt = (warpSlots: bigint) =>
    estimateUnderlyingFromSharesAtSlot(
      shareAmount,
      snapshot,
      baseSlot + warpSlots
    ) - principal;

  let lower = minWarpSlots;
  if (gainAt(lower) >= requiredYieldAmount) {
    return lower;
  }

  let upper = lower > 0n ? lower : 1n;
  while (upper < maxWarpSlots && gainAt(upper) < requiredYieldAmount) {
    upper *= 2n;
  }
  if (upper > maxWarpSlots) {
    upper = maxWarpSlots;
  }
  if (gainAt(upper) < requiredYieldAmount) {
    return upper;
  }

  while (lower + 1n < upper) {
    const middle = (lower + upper) / 2n;
    if (gainAt(middle) >= requiredYieldAmount) {
      upper = middle;
    } else {
      lower = middle;
    }
  }

  return upper;
}

function estimateRefreshedTotalSupplySf(
  snapshot: KlendReserveSnapshot
): bigint {
  const slotsElapsed =
    snapshot.currentSlot > snapshot.lastUpdateSlot
      ? snapshot.currentSlot - snapshot.lastUpdateSlot
      : 0n;
  if (slotsElapsed === 0n) {
    return snapshot.staleTotalSupplySf;
  }

  const currentBorrowRateSf = computeCurrentBorrowRateSf(snapshot);
  const hostFixedInterestRateSf = bpsToFraction(
    snapshot.hostFixedInterestRateBps
  );
  const protocolTakeRateSf = percentToFraction(snapshot.protocolTakeRatePct);
  const referralRateSf = bpsToFraction(snapshot.referralFeeBps);
  const compoundedInterestRateSf = approximateCompoundedInterest(
    currentBorrowRateSf + hostFixedInterestRateSf,
    slotsElapsed
  );
  const compoundedFixedRateSf = approximateCompoundedInterest(
    hostFixedInterestRateSf,
    slotsElapsed
  );
  const newDebtSf = mulFraction(
    snapshot.borrowedAmountSf,
    compoundedInterestRateSf
  );
  const fixedHostFeeSf =
    mulFraction(snapshot.borrowedAmountSf, compoundedFixedRateSf) -
    snapshot.borrowedAmountSf;
  const netNewVariableDebtSf =
    newDebtSf - snapshot.borrowedAmountSf - fixedHostFeeSf;
  const variableProtocolFeeSf = mulFraction(
    netNewVariableDebtSf,
    protocolTakeRateSf
  );
  const absoluteReferralRateSf = mulFraction(
    protocolTakeRateSf,
    referralRateSf
  );
  const maxReferralFeesSf = mulFraction(
    netNewVariableDebtSf,
    absoluteReferralRateSf
  );
  const newAccProtocolFeesSf =
    snapshot.accumulatedProtocolFeesSf +
    fixedHostFeeSf +
    variableProtocolFeeSf -
    maxReferralFeesSf;
  const pendingReferralFeesSf =
    snapshot.pendingReferrerFeesSf + maxReferralFeesSf;

  return (
    (snapshot.availableAmount << FRACTION_BITS) +
    newDebtSf -
    newAccProtocolFeesSf -
    snapshot.accumulatedReferrerFeesSf -
    pendingReferralFeesSf
  );
}

function computeCurrentBorrowRateSf(snapshot: KlendReserveSnapshot): bigint {
  if (snapshot.borrowedAmountSf === 0n || snapshot.staleTotalSupplySf === 0n) {
    return 0n;
  }

  const utilizationRateSf =
    snapshot.borrowedAmountSf > snapshot.staleTotalSupplySf
      ? FRACTION_SCALE
      : (snapshot.borrowedAmountSf * FRACTION_SCALE) /
        snapshot.staleTotalSupplySf;
  const utilizationRateBps = Number(
    (utilizationRateSf * BPS_DENOMINATOR) / FRACTION_SCALE
  );

  for (let index = 0; index < snapshot.borrowRateCurve.length - 1; index += 1) {
    const start = snapshot.borrowRateCurve[index];
    const end = snapshot.borrowRateCurve[index + 1];
    if (
      utilizationRateBps >= start.utilizationRateBps &&
      utilizationRateBps <= end.utilizationRateBps
    ) {
      if (utilizationRateBps === start.utilizationRateBps) {
        return bpsToFraction(start.borrowRateBps);
      }
      if (utilizationRateBps === end.utilizationRateBps) {
        return bpsToFraction(end.borrowRateBps);
      }

      const startUtilizationRateSf = bpsToFraction(start.utilizationRateBps);
      const slopeNumerator = BigInt(end.borrowRateBps - start.borrowRateBps);
      const slopeDenominator = BigInt(
        end.utilizationRateBps - start.utilizationRateBps
      );

      return (
        ((utilizationRateSf - startUtilizationRateSf) * slopeNumerator) /
          slopeDenominator +
        bpsToFraction(start.borrowRateBps)
      );
    }
  }

  const lastPoint =
    snapshot.borrowRateCurve[snapshot.borrowRateCurve.length - 1];
  return bpsToFraction(lastPoint.borrowRateBps);
}

function approximateCompoundedInterest(
  rateSf: bigint,
  elapsedSlots: bigint
): bigint {
  const base = rateSf / SLOTS_PER_YEAR;

  switch (elapsedSlots) {
    case 0n:
      return FRACTION_SCALE;
    case 1n:
      return FRACTION_SCALE + base;
    case 2n:
      return mulFraction(FRACTION_SCALE + base, FRACTION_SCALE + base);
    case 3n:
      return mulFraction(
        mulFraction(FRACTION_SCALE + base, FRACTION_SCALE + base),
        FRACTION_SCALE + base
      );
    case 4n: {
      const squared = mulFraction(FRACTION_SCALE + base, FRACTION_SCALE + base);
      return mulFraction(squared, squared);
    }
  }

  const expMinusOne = elapsedSlots - 1n;
  const expMinusTwo = elapsedSlots - 2n;
  const basePowerTwo = mulFraction(base, base);
  const basePowerThree = mulFraction(basePowerTwo, base);
  const firstTerm = base * elapsedSlots;
  const secondTerm = (basePowerTwo * elapsedSlots * expMinusOne) / 2n;
  const thirdTerm =
    (basePowerThree * elapsedSlots * expMinusOne * expMinusTwo) / 6n;

  return FRACTION_SCALE + firstTerm + secondTerm + thirdTerm;
}

function mulFraction(value: bigint, fractionSf: bigint): bigint {
  return (value * fractionSf) / FRACTION_SCALE;
}

function bpsToFraction(bps: number): bigint {
  return (BigInt(bps) * FRACTION_SCALE) / BPS_DENOMINATOR;
}

function percentToFraction(pct: number): bigint {
  return (BigInt(pct) * FRACTION_SCALE) / PCT_DENOMINATOR;
}

function readBorrowRateCurvePoints(
  data: Buffer,
  offset: number
): BorrowRateCurvePoint[] {
  const points: BorrowRateCurvePoint[] = [];
  for (let index = 0; index < BORROW_RATE_CURVE_POINTS; index += 1) {
    const pointOffset = offset + index * CURVE_POINT_SIZE;
    points.push({
      utilizationRateBps: data.readUInt32LE(pointOffset),
      borrowRateBps: data.readUInt32LE(pointOffset + 4),
    });
  }
  return points;
}

function readPublicKey(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function readU16(data: Buffer, offset: number): number {
  return data.readUInt16LE(offset);
}

function readU64(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

function readU128(data: Buffer, offset: number): bigint {
  const low = data.readBigUInt64LE(offset);
  const high = data.readBigUInt64LE(offset + 8);
  return low + (high << 64n);
}
