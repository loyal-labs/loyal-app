import { AccountInfo, PublicKey } from "@solana/web3.js";

import { getConnection } from "./connection";

export const getAccountInfo = async (
  publicKey: PublicKey
): Promise<AccountInfo<Buffer>> => {
  const connection = getConnection();

  const accountInfo = await connection.getAccountInfo(publicKey, {
    dataSlice: { offset: 0, length: 100 },
    commitment: "confirmed",
  });
  if (!accountInfo) {
    throw new Error(`Account ${publicKey.toBase58()} not found`);
  }

  return accountInfo;
};
