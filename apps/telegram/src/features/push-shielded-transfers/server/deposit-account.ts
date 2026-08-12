import "server-only";

import { type Connection, PublicKey } from "@solana/web3.js";

import { DEPOSIT_DISCRIMINATOR } from "./constants";

// Anchor Deposit layout: 8B discriminator + 32B user + 32B token_mint + 8B amount.
// We only need the user pubkey, sitting right after the discriminator.
const DEPOSIT_USER_OFFSET = 8;
const PUBKEY_BYTES = 32;
const MIN_DEPOSIT_ACCOUNT_SIZE = 8 + 32 + 32 + 8;

function decodeDepositUser(data: Buffer): string | null {
  if (data.length < MIN_DEPOSIT_ACCOUNT_SIZE) return null;
  for (let i = 0; i < DEPOSIT_DISCRIMINATOR.length; i += 1) {
    if (data[i] !== DEPOSIT_DISCRIMINATOR[i]) return null;
  }
  const userBytes = data.subarray(
    DEPOSIT_USER_OFFSET,
    DEPOSIT_USER_OFFSET + PUBKEY_BYTES
  );
  return new PublicKey(userBytes).toBase58();
}

// Chunk size matches the getMultipleAccountsInfo RPC cap on most
// providers; Helius accepts 100 safely.
const GET_ACCOUNTS_BATCH_SIZE = 100;

export async function resolveDepositUsers(
  connection: Connection,
  depositAddresses: string[]
): Promise<Map<string, string>> {
  const userByDepositAddress = new Map<string, string>();
  if (depositAddresses.length === 0) return userByDepositAddress;

  const uniqueAddresses = Array.from(new Set(depositAddresses));
  for (let i = 0; i < uniqueAddresses.length; i += GET_ACCOUNTS_BATCH_SIZE) {
    const batch = uniqueAddresses.slice(i, i + GET_ACCOUNTS_BATCH_SIZE);
    const publicKeys = batch.map((address) => new PublicKey(address));
    const accountInfos = await connection.getMultipleAccountsInfo(publicKeys);
    for (let j = 0; j < batch.length; j += 1) {
      const address = batch[j];
      const info = accountInfos[j];
      if (!address || !info) continue;
      const user = decodeDepositUser(info.data as Buffer);
      if (user) userByDepositAddress.set(address, user);
    }
  }

  return userByDepositAddress;
}
