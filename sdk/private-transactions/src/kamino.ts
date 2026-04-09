import { Connection, PublicKey } from "@solana/web3.js";

import {
  getKaminoModifyBalanceAccountsForTokenMint,
  type KaminoModifyBalanceAccounts,
} from "./constants";
import type {
  KaminoPositionYieldInfo,
  KaminoReserveSnapshot,
} from "./types";

const KAMINO_RESERVE_DISCRIMINATOR = Buffer.from([
  43, 242, 204, 202, 26, 247, 59, 127,
]);
const KAMINO_FRACTION_BITS = 60n;
const KAMINO_FRACTION_SCALE = 1n << KAMINO_FRACTION_BITS;

const KAMINO_RESERVE_LAYOUT_OFFSETS = {
  liquidityAvailableAmount: 216,
  liquidityBorrowedAmountSf: 224,
  liquidityMintDecimals: 264,
  liquidityAccumulatedProtocolFeesSf: 336,
  liquidityAccumulatedReferrerFeesSf: 352,
  liquidityPendingReferrerFeesSf: 368,
  collateralMintTotalSupply: 2584,
} as const;

function readUint64LE(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

function readUint128LE(data: Buffer, offset: number): bigint {
  const low = data.readBigUInt64LE(offset);
  const high = data.readBigUInt64LE(offset + 8);
  return low + (high << 64n);
}

function toRawBigInt(value: bigint | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function divCeil(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error("Cannot divide by zero");
  }

  return (numerator + denominator - 1n) / denominator;
}

export function parseKaminoReserveSnapshotFromAccountData(args: {
  data: Buffer;
  reserve: PublicKey;
  tokenMint: PublicKey;
}): KaminoReserveSnapshot {
  const { data, reserve, tokenMint } = args;

  if (data.length < 8 || !data.subarray(0, 8).equals(KAMINO_RESERVE_DISCRIMINATOR)) {
    throw new Error(`Kamino reserve ${reserve.toBase58()} has an invalid discriminator`);
  }

  const accountData = data.subarray(8);
  const requiredLength =
    KAMINO_RESERVE_LAYOUT_OFFSETS.collateralMintTotalSupply + 8;

  if (accountData.length < requiredLength) {
    throw new Error(
      `Kamino reserve ${reserve.toBase58()} is too small: expected at least ${requiredLength} bytes`
    );
  }

  const liquidityAvailableAmount = readUint64LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAvailableAmount
  );
  const liquidityBorrowedAmountSf = readUint128LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityBorrowedAmountSf
  );
  const liquidityAccumulatedProtocolFeesSf = readUint128LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAccumulatedProtocolFeesSf
  );
  const liquidityAccumulatedReferrerFeesSf = readUint128LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAccumulatedReferrerFeesSf
  );
  const liquidityPendingReferrerFeesSf = readUint128LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityPendingReferrerFeesSf
  );
  const collateralSupplyRaw = readUint64LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.collateralMintTotalSupply
  );
  const liquidityDecimals = Number(
    readUint64LE(accountData, KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityMintDecimals)
  );

  const grossLiquiditySupplyScaled =
    (liquidityAvailableAmount << KAMINO_FRACTION_BITS) +
    liquidityBorrowedAmountSf;
  const totalFeeAmountScaled =
    liquidityAccumulatedProtocolFeesSf +
    liquidityAccumulatedReferrerFeesSf +
    liquidityPendingReferrerFeesSf;

  return {
    reserve,
    tokenMint,
    liquidityDecimals,
    collateralSupplyRaw,
    totalLiquiditySupplyScaled:
      grossLiquiditySupplyScaled > totalFeeAmountScaled
        ? grossLiquiditySupplyScaled - totalFeeAmountScaled
        : 0n,
    collateralExchangeRateSf:
      collateralSupplyRaw === 0n ||
      grossLiquiditySupplyScaled <= totalFeeAmountScaled
        ? KAMINO_FRACTION_SCALE
        : (collateralSupplyRaw *
            KAMINO_FRACTION_SCALE *
            KAMINO_FRACTION_SCALE) /
          (grossLiquiditySupplyScaled - totalFeeAmountScaled),
  };
}

export function calculateKaminoRedeemableLiquidityAmountRaw(
  snapshot: KaminoReserveSnapshot,
  shareAmountRaw: bigint | number
): bigint {
  const shareAmount = toRawBigInt(shareAmountRaw);
  if (shareAmount <= 0n) {
    return 0n;
  }

  if (
    snapshot.collateralSupplyRaw === 0n ||
    snapshot.totalLiquiditySupplyScaled === 0n
  ) {
    return shareAmount;
  }

  const numerator = shareAmount * snapshot.totalLiquiditySupplyScaled;
  const denominator = snapshot.collateralSupplyRaw * KAMINO_FRACTION_SCALE;
  return numerator / denominator;
}

export function calculateKaminoShareAmountForLiquidityAmountRaw(args: {
  snapshot: KaminoReserveSnapshot;
  liquidityAmountRaw: bigint | number;
  rounding?: "floor" | "ceil";
}): bigint {
  const liquidityAmount = toRawBigInt(args.liquidityAmountRaw);
  if (liquidityAmount <= 0n) {
    return 0n;
  }

  if (
    args.snapshot.collateralSupplyRaw === 0n ||
    args.snapshot.totalLiquiditySupplyScaled === 0n
  ) {
    return liquidityAmount;
  }

  const numerator =
    liquidityAmount *
    args.snapshot.collateralSupplyRaw *
    KAMINO_FRACTION_SCALE;

  return args.rounding === "ceil"
    ? divCeil(numerator, args.snapshot.totalLiquiditySupplyScaled)
    : numerator / args.snapshot.totalLiquiditySupplyScaled;
}

export function calculateKaminoTrackedLiquidityCostBasisRaw(args: {
  currentShareAmountRaw: bigint | number;
  trackedShareAmountRaw?: bigint | number | null;
  trackedLiquidityAmountRaw?: bigint | number | null;
}): bigint | null {
  if (
    args.trackedShareAmountRaw == null ||
    args.trackedLiquidityAmountRaw == null
  ) {
    return null;
  }

  const currentShareAmount = toRawBigInt(args.currentShareAmountRaw);
  const trackedShareAmount = toRawBigInt(args.trackedShareAmountRaw);
  const trackedLiquidityAmount = toRawBigInt(args.trackedLiquidityAmountRaw);

  if (currentShareAmount <= 0n || trackedShareAmount <= 0n) {
    return 0n;
  }

  if (trackedLiquidityAmount < 0n) {
    return null;
  }

  if (currentShareAmount > trackedShareAmount) {
    return null;
  }

  return (trackedLiquidityAmount * currentShareAmount) / trackedShareAmount;
}

export function calculateKaminoCollateralExchangeRateSfFromAmounts(args: {
  collateralAmount: bigint | number;
  liquidityAmount: bigint | number;
}): bigint | null {
  const collateralAmount = toRawBigInt(args.collateralAmount);
  const liquidityAmount = toRawBigInt(args.liquidityAmount);

  if (collateralAmount <= 0n || liquidityAmount <= 0n) {
    return null;
  }

  return (collateralAmount * KAMINO_FRACTION_SCALE) / liquidityAmount;
}

export function calculateKaminoCollateralValuation(args: {
  snapshot: KaminoReserveSnapshot;
  collateralAmount: bigint | number;
  principalLiquidityAmount?: bigint | number | null;
  shieldCollateralExchangeRateSf?: bigint | number | null;
}): {
  currentLiquidityAmount: bigint;
  principalLiquidityAmount: bigint | null;
  earnedLiquidityAmount: bigint | null;
} {
  const currentLiquidityAmount = calculateKaminoRedeemableLiquidityAmountRaw(
    args.snapshot,
    args.collateralAmount
  );

  let principalLiquidityAmount =
    args.principalLiquidityAmount == null
      ? null
      : toRawBigInt(args.principalLiquidityAmount);

  if (
    principalLiquidityAmount === null &&
    args.shieldCollateralExchangeRateSf != null
  ) {
    const shieldRate = toRawBigInt(args.shieldCollateralExchangeRateSf);
    if (shieldRate > 0n) {
      principalLiquidityAmount =
        (toRawBigInt(args.collateralAmount) * KAMINO_FRACTION_SCALE) /
        shieldRate;
    }
  }

  return {
    currentLiquidityAmount,
    principalLiquidityAmount,
    earnedLiquidityAmount:
      principalLiquidityAmount === null
        ? null
        : currentLiquidityAmount - principalLiquidityAmount,
  };
}

export function calculateKaminoPositionYieldInfoFromSnapshot(args: {
  snapshot: KaminoReserveSnapshot;
  shareAmountRaw: bigint | number;
  trackedShareAmountRaw?: bigint | number | null;
  trackedLiquidityAmountRaw?: bigint | number | null;
}): KaminoPositionYieldInfo {
  const shareAmount = toRawBigInt(args.shareAmountRaw);
  const currentLiquidityAmountRaw = calculateKaminoRedeemableLiquidityAmountRaw(
    args.snapshot,
    shareAmount
  );
  const currentTrackedLiquidityCostBasisRaw =
    calculateKaminoTrackedLiquidityCostBasisRaw({
      currentShareAmountRaw: shareAmount,
      trackedShareAmountRaw: args.trackedShareAmountRaw,
      trackedLiquidityAmountRaw: args.trackedLiquidityAmountRaw,
    });

  let earnedLiquidityAmountRaw: bigint | null = null;
  if (currentTrackedLiquidityCostBasisRaw !== null) {
    earnedLiquidityAmountRaw =
      currentLiquidityAmountRaw - currentTrackedLiquidityCostBasisRaw;
  }

  return {
    reserve: args.snapshot.reserve,
    tokenMint: args.snapshot.tokenMint,
    liquidityDecimals: args.snapshot.liquidityDecimals,
    shareAmountRaw: shareAmount,
    currentLiquidityAmountRaw,
    trackedShareAmountRaw:
      args.trackedShareAmountRaw == null
        ? null
        : toRawBigInt(args.trackedShareAmountRaw),
    trackedLiquidityAmountRaw:
      args.trackedLiquidityAmountRaw == null
        ? null
        : toRawBigInt(args.trackedLiquidityAmountRaw),
    currentTrackedLiquidityCostBasisRaw,
    earnedLiquidityAmountRaw,
  };
}

export async function fetchKaminoReserveSnapshot(args: {
  connection: Connection;
  tokenMint: PublicKey;
  kaminoAccounts?: KaminoModifyBalanceAccounts;
}): Promise<KaminoReserveSnapshot | null> {
  const kaminoAccounts =
    args.kaminoAccounts ??
    getKaminoModifyBalanceAccountsForTokenMint(args.tokenMint);
  if (!kaminoAccounts) {
    return null;
  }

  const accountInfo = await args.connection.getAccountInfo(
    kaminoAccounts.reserve,
    "confirmed"
  );
  if (!accountInfo) {
    throw new Error(
      `Kamino reserve ${kaminoAccounts.reserve.toBase58()} was not found`
    );
  }

  return parseKaminoReserveSnapshotFromAccountData({
    data: accountInfo.data,
    reserve: kaminoAccounts.reserve,
    tokenMint: args.tokenMint,
  });
}
