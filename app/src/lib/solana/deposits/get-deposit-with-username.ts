import {
  findUsernameDepositPda,
  type UsernameDepositData,
} from "@loyal-labs/private-transactions";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import type { TelegramDeposit } from "../../../types/deposits";
import { getPrivateClient } from "./private-client";

const mapUsernameDepositToTelegramDeposit = (
  user: PublicKey,
  username: string,
  deposit: UsernameDepositData
): TelegramDeposit => ({
  user,
  username,
  amount: Number(deposit.amount),
  lastNonce: 0,
  tokenMint: deposit.tokenMint,
  address: deposit.address,
});

export const getDepositWithUsername = async (
  user: PublicKey,
  username: string
): Promise<TelegramDeposit[]> => {
  const privateClient = await getPrivateClient();
  const deposit = await privateClient.getEphemeralUsernameDeposit(
    username,
    NATIVE_MINT
  );
  if (!deposit) {
    return [];
  }

  return [mapUsernameDepositToTelegramDeposit(user, username, deposit)];
};

export const subscribeToDepositsWithUsername = async (
  user: PublicKey,
  username: string,
  onChange: (deposit: TelegramDeposit) => void
): Promise<() => Promise<void>> => {
  const privateClient = await getPrivateClient();
  const [depositPda] = await findUsernameDepositPda(username, NATIVE_MINT);

  const connection = privateClient.ephemeralProgram.provider.connection;
  const subscriptionId = connection.onAccountChange(
    depositPda,
    async () => {
      try {
        const deposit = await privateClient.getEphemeralUsernameDeposit(
          username,
          NATIVE_MINT
        );
        if (!deposit || deposit.amount <= 0) {
          return;
        }

        onChange(mapUsernameDepositToTelegramDeposit(user, username, deposit));
      } catch (error) {
        console.error("Failed to fetch username deposit account change", error);
      }
    },
    { commitment: "confirmed" }
  );

  return async () => {
    try {
      await connection.removeAccountChangeListener(subscriptionId);
    } catch (error) {
      console.error("Failed to remove deposit subscription", error);
    }
  };
};
