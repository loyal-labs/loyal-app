import { PublicKey } from "@solana/web3.js";
import {
  DEPOSIT_SEED_BYTES,
  USERNAME_DEPOSIT_SEED_BYTES,
  VAULT_SEED_BYTES,
  PERMISSION_SEED_BYTES,
  PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  DELEGATION_PROGRAM_ID,
} from "./constants";
import { sha256hash } from "./utils";

/**
 * Derive the deposit PDA for a user and token mint
 *
 * @param user - The user's public key
 * @param tokenMint - The SPL token mint
 * @param programId - Optional program ID (defaults to PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export function findDepositPda(
  user: PublicKey,
  tokenMint: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DEPOSIT_SEED_BYTES, user.toBuffer(), tokenMint.toBuffer()],
    programId
  );
}

/**
 * Derive the username deposit PDA for a username and token mint
 *
 * @param username - The Telegram username
 * @param tokenMint - The SPL token mint
 * @param programId - Optional program ID (defaults to PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export async function findUsernameDepositPda(
  username: string,
  tokenMint: PublicKey,
  programId: PublicKey = PROGRAM_ID
): Promise<[PublicKey, number]> {
  const usernameHash = await sha256hash(username);
  return PublicKey.findProgramAddressSync(
    [
      USERNAME_DEPOSIT_SEED_BYTES,
      Buffer.from(usernameHash),
      tokenMint.toBuffer(),
    ],
    programId
  );
}

/**
 * Derive the vault PDA
 *
 * @param tokenMint - The SPL token mint
 * @param programId - Optional program ID (defaults to PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export function findVaultPda(
  tokenMint: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED_BYTES, tokenMint.toBuffer()],
    programId
  );
}

/**
 * Derive the permission PDA for an account
 *
 * @param account - The account to derive permission for
 * @param permissionProgramId - Optional permission program ID (defaults to PERMISSION_PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export function findPermissionPda(
  account: PublicKey,
  permissionProgramId: PublicKey = PERMISSION_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PERMISSION_SEED_BYTES, account.toBuffer()],
    permissionProgramId
  );
}

/**
 * Derive the delegation record PDA for an account
 *
 * @param account - The delegated account
 * @param delegationProgramId - Optional delegation program ID (defaults to DELEGATION_PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export function findDelegationRecordPda(
  account: PublicKey,
  delegationProgramId: PublicKey = DELEGATION_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), account.toBuffer()],
    delegationProgramId
  );
}

/**
 * Derive the delegation metadata PDA for an account
 *
 * @param account - The delegated account
 * @param delegationProgramId - Optional delegation program ID (defaults to DELEGATION_PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export function findDelegationMetadataPda(
  account: PublicKey,
  delegationProgramId: PublicKey = DELEGATION_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("delegation-metadata"), account.toBuffer()],
    delegationProgramId
  );
}

/**
 * Derive the buffer PDA for an account (used in delegation)
 *
 * @param account - The account to derive buffer for
 * @param delegationProgramId - Optional delegation program ID (defaults to DELEGATION_PROGRAM_ID)
 * @returns [PDA address, bump seed]
 */
export function findBufferPda(
  account: PublicKey,
  ownerProgramId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), account.toBuffer()],
    ownerProgramId
  );
}
