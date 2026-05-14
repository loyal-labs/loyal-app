import type { Connection, PublicKey } from "@solana/web3.js";
export declare const MAGICBLOCK_UNDELEGATE_SESSION_FEE_LAMPORTS = 300000;
export declare const DEPOSIT_ACCOUNT_SIZE: number;
export declare const VAULT_ACCOUNT_SIZE: number;
export declare const PERMISSION_ACCOUNT_SIZE = 567;
export declare const DELEGATION_RECORD_ACCOUNT_SIZE: number;
export type RentAccountEstimate = {
    address: PublicKey;
    space: number;
    forceCreate?: boolean;
};
export declare function estimateNewAccountRentLamports(params: {
    connection: Connection;
    accounts: RentAccountEstimate[];
}): Promise<number>;
export declare function estimateExistingAccountLamports(params: {
    connection: Connection;
    accounts: PublicKey[];
}): Promise<number>;
export declare function estimateDepositRentLamports(params: {
    connection: Connection;
    depositPda: PublicKey;
    forceCreate?: boolean;
}): Promise<number>;
export declare function estimateModifyBalanceRentLamports(params: {
    connection: Connection;
    user: PublicKey;
    tokenMint: PublicKey;
    isNativeSol: boolean;
}): Promise<number>;
export declare function estimatePermissionRentLamports(params: {
    connection: Connection;
    permissionPda: PublicKey;
    forceCreate?: boolean;
}): Promise<number>;
export declare function estimateDepositDelegationRentLamports(params: {
    connection: Connection;
    user: PublicKey;
    tokenMint: PublicKey;
    depositPda: PublicKey;
    forceCreate?: boolean;
}): Promise<number>;
export declare function estimateDepositDelegationRentCreditLamports(params: {
    connection: Connection;
    depositPda: PublicKey;
}): Promise<number>;
