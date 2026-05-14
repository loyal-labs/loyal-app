import { Connection, PublicKey } from "@solana/web3.js";
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
}): Promise<KaminoReserveSnapshot | null>;
