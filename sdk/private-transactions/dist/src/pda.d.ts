import { PublicKey } from "@solana/web3.js";
/**
 * Derive the deposit PDA for a user and token mint
 *
 * @param user - The user's public key
 * @param tokenMint - The SPL token mint
 * @param programId - Optional program ID (defaults to PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export declare function findDepositPda(user: PublicKey, tokenMint: PublicKey, programId?: PublicKey): [PublicKey, number];
/**
 * Derive the username deposit PDA for a username and token mint
 *
 * @param username - The Telegram username
 * @param tokenMint - The SPL token mint
 * @param programId - Optional program ID (defaults to PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export declare function findUsernameDepositPda(username: string, tokenMint: PublicKey, programId?: PublicKey): Promise<[PublicKey, number]>;
/**
 * Derive the vault PDA
 *
 * @param tokenMint - The SPL token mint
 * @param programId - Optional program ID (defaults to PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export declare function findVaultPda(tokenMint: PublicKey, programId?: PublicKey): [PublicKey, number];
/**
 * Derive the permission PDA for an account
 *
 * @param account - The account to derive permission for
 * @param permissionProgramId - Optional permission program ID (defaults to PERMISSION_PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export declare function findPermissionPda(account: PublicKey, permissionProgramId?: PublicKey): [PublicKey, number];
/**
 * Derive the delegation record PDA for an account
 *
 * @param account - The delegated account
 * @param delegationProgramId - Optional delegation program ID (defaults to DELEGATION_PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export declare function findDelegationRecordPda(account: PublicKey, delegationProgramId?: PublicKey): [PublicKey, number];
/**
 * Derive the delegation metadata PDA for an account
 *
 * @param account - The delegated account
 * @param delegationProgramId - Optional delegation program ID (defaults to DELEGATION_PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export declare function findDelegationMetadataPda(account: PublicKey, delegationProgramId?: PublicKey): [PublicKey, number];
/**
 * Derive the buffer PDA for an account (used in delegation)
 *
 * @param account - The account to derive buffer for
 * @param delegationProgramId - Optional delegation program ID (defaults to DELEGATION_PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export declare function findBufferPda(account: PublicKey, ownerProgramId?: PublicKey): [PublicKey, number];
