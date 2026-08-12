import { PublicKey } from "@solana/web3.js";

import { getAccountInfo } from "./get-account-info";

export const getAccountBalance = async (
  publicKey: PublicKey
): Promise<number> => {
  const accountInfo = await getAccountInfo(publicKey);
  return accountInfo.lamports;
};
