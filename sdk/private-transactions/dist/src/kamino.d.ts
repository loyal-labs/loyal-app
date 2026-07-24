import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import { type KaminoModifyBalanceAccounts } from "./constants";
import type { KaminoPositionYieldInfo, KaminoReserveSnapshot } from "./types";
export declare function parseKaminoReserveSnapshotFromAccountData(args: {
    data: Buffer | Uint8Array;
    reserve: PublicKey;
    tokenMint: PublicKey;
}): KaminoReserveSnapshot;
export declare function calculateKaminoRedeemableLiquidityAmountRaw(snapshot: KaminoReserveSnapshot, shareAmountRaw: bigint | number): bigint;
export declare function calculateKaminoShareAmountForLiquidityAmountRaw(args: {
    snapshot: KaminoReserveSnapshot;
    liquidityAmountRaw: bigint | number;
    rounding?: "floor" | "ceil";
}): bigint;
/**
 * Mirrors Kamino's deposit rounding: collateral shares round down, then the
 * liquidity consumed for those shares rounds up. The returned liquidity is a
 * fixed point for the snapshot, so the requested and consumed raw amounts
 * agree when the shield instruction checks them.
 */
export declare function calculateKaminoDepositableLiquidityAmountRaw(args: {
    snapshot: KaminoReserveSnapshot;
    requestedLiquidityAmountRaw: bigint | number;
}): bigint;
export declare function calculateKaminoTrackedLiquidityCostBasisRaw(args: {
    currentShareAmountRaw: bigint | number;
    trackedShareAmountRaw?: bigint | number | null;
    trackedLiquidityAmountRaw?: bigint | number | null;
}): bigint | null;
export declare function calculateKaminoCollateralExchangeRateSfFromAmounts(args: {
    collateralAmount: bigint | number;
    liquidityAmount: bigint | number;
}): bigint | null;
export declare function calculateKaminoCollateralValuation(args: {
    snapshot: KaminoReserveSnapshot;
    collateralAmount: bigint | number;
    principalLiquidityAmount?: bigint | number | null;
    shieldCollateralExchangeRateSf?: bigint | number | null;
}): {
    currentLiquidityAmount: bigint;
    principalLiquidityAmount: bigint | null;
    earnedLiquidityAmount: bigint | null;
};
export declare function calculateKaminoPositionYieldInfoFromSnapshot(args: {
    snapshot: KaminoReserveSnapshot;
    shareAmountRaw: bigint | number;
    trackedShareAmountRaw?: bigint | number | null;
    trackedLiquidityAmountRaw?: bigint | number | null;
}): KaminoPositionYieldInfo;
export declare function fetchKaminoReserveSnapshot(args: {
    connection: Connection;
    tokenMint: PublicKey;
    kaminoAccounts?: KaminoModifyBalanceAccounts;
    commitment?: Commitment;
}): Promise<KaminoReserveSnapshot | null>;
