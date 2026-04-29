import { ACCOUNT_SIZE, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";
import { DEPOSIT_SEED_BYTES } from "./constants";
import {
  findDelegationMetadataPda,
  findDelegationRecordPda,
  findVaultPda,
} from "./pda";

const DISCRIMINATOR_SIZE = 8;
const PUBLIC_KEY_SIZE = 32;
const U64_SIZE = 8;
const U8_SIZE = 1;
const BOOL_SIZE = 1;
const VEC_PREFIX_SIZE = 4;

export const DEPOSIT_ACCOUNT_SIZE =
  DISCRIMINATOR_SIZE + PUBLIC_KEY_SIZE + PUBLIC_KEY_SIZE + U64_SIZE;
export const VAULT_ACCOUNT_SIZE = DISCRIMINATOR_SIZE + U8_SIZE;
export const PERMISSION_ACCOUNT_SIZE = 567;
export const DELEGATION_RECORD_ACCOUNT_SIZE =
  DISCRIMINATOR_SIZE + PUBLIC_KEY_SIZE + PUBLIC_KEY_SIZE + U64_SIZE * 3;

export type RentAccountEstimate = {
  address: PublicKey;
  space: number;
  forceCreate?: boolean;
};

function getDelegationMetadataAccountSize(seeds: Uint8Array[]): number {
  return (
    DISCRIMINATOR_SIZE +
    U64_SIZE +
    BOOL_SIZE +
    PUBLIC_KEY_SIZE +
    VEC_PREFIX_SIZE +
    seeds.reduce((total, seed) => total + VEC_PREFIX_SIZE + seed.byteLength, 0)
  );
}

export async function estimateNewAccountRentLamports(params: {
  connection: Connection;
  accounts: RentAccountEstimate[];
}): Promise<number> {
  if (params.accounts.length === 0) {
    return 0;
  }

  const spaces = Array.from(
    new Set(params.accounts.map((account) => account.space))
  );
  const [accountInfos, rentEntries] = await Promise.all([
    params.connection.getMultipleAccountsInfo(
      params.accounts.map((account) => account.address)
    ),
    Promise.all(
      spaces.map(
        async (space) =>
          [
            space,
            await params.connection.getMinimumBalanceForRentExemption(space),
          ] as const
      )
    ),
  ]);
  const rentBySpace = new Map(rentEntries);

  return params.accounts.reduce((total, account, index) => {
    if (!account.forceCreate && accountInfos[index]) {
      return total;
    }

    return total + (rentBySpace.get(account.space) ?? 0);
  }, 0);
}

export async function estimateDepositRentLamports(params: {
  connection: Connection;
  depositPda: PublicKey;
  forceCreate?: boolean;
}): Promise<number> {
  return estimateNewAccountRentLamports({
    connection: params.connection,
    accounts: [
      {
        address: params.depositPda,
        space: DEPOSIT_ACCOUNT_SIZE,
        forceCreate: params.forceCreate,
      },
    ],
  });
}

export async function estimateModifyBalanceRentLamports(params: {
  connection: Connection;
  user: PublicKey;
  tokenMint: PublicKey;
  isNativeSol: boolean;
}): Promise<number> {
  const [vaultPda] = findVaultPda(params.tokenMint);
  const userTokenAccount = getAssociatedTokenAddressSync(
    params.tokenMint,
    params.user
  );
  const vaultTokenAccount = getAssociatedTokenAddressSync(
    params.tokenMint,
    vaultPda,
    true
  );
  const accounts: RentAccountEstimate[] = [
    { address: vaultPda, space: VAULT_ACCOUNT_SIZE },
    { address: vaultTokenAccount, space: ACCOUNT_SIZE },
  ];

  if (!params.isNativeSol) {
    accounts.push({ address: userTokenAccount, space: ACCOUNT_SIZE });
  }

  return estimateNewAccountRentLamports({
    connection: params.connection,
    accounts,
  });
}

export async function estimatePermissionRentLamports(params: {
  connection: Connection;
  permissionPda: PublicKey;
  forceCreate?: boolean;
}): Promise<number> {
  return estimateNewAccountRentLamports({
    connection: params.connection,
    accounts: [
      {
        address: params.permissionPda,
        space: PERMISSION_ACCOUNT_SIZE,
        forceCreate: params.forceCreate,
      },
    ],
  });
}

export async function estimateDepositDelegationRentLamports(params: {
  connection: Connection;
  user: PublicKey;
  tokenMint: PublicKey;
  depositPda: PublicKey;
  forceCreate?: boolean;
}): Promise<number> {
  const [delegationRecordPda] = findDelegationRecordPda(params.depositPda);
  const [delegationMetadataPda] = findDelegationMetadataPda(params.depositPda);
  const metadataSize = getDelegationMetadataAccountSize([
    DEPOSIT_SEED_BYTES,
    params.user.toBuffer(),
    params.tokenMint.toBuffer(),
  ]);

  return estimateNewAccountRentLamports({
    connection: params.connection,
    accounts: [
      {
        address: delegationRecordPda,
        space: DELEGATION_RECORD_ACCOUNT_SIZE,
        forceCreate: params.forceCreate,
      },
      {
        address: delegationMetadataPda,
        space: metadataSize,
        forceCreate: params.forceCreate,
      },
    ],
  });
}
