import { AnchorProvider } from "@coral-xyz/anchor";
import { NATIVE_MINT } from "@solana/spl-token";

import type { TelegramDeposit } from "../../../types/deposits";
import { getPrivateClient } from "./private-client";

export const getDeposit = async (
  provider: AnchorProvider,
  username: string
): Promise<TelegramDeposit> => {
  const privateClient = await getPrivateClient();
  const deposit = await privateClient.getEphemeralUsernameDeposit(
    username,
    NATIVE_MINT
  );
  if (!deposit) {
    throw new Error("Deposit account not found");
  }

  return {
    user: provider.publicKey,
    username,
    amount: Number(deposit.amount),
    lastNonce: 0,
    tokenMint: deposit.tokenMint,
    address: deposit.address,
  };
};
