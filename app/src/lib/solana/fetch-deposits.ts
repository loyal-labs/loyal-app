import { PublicKey } from "@solana/web3.js";

import { TelegramDeposit } from "@/types/deposits";

import { getDepositWithUsername, validateLowercaseUsername } from "./deposits";

export const fetchDeposits = async (
  user: PublicKey,
  username: string
): Promise<TelegramDeposit[]> => {
  validateLowercaseUsername(username);

  const deposits = await getDepositWithUsername(user, username);

  const filteredDeposits = deposits.filter((deposit) => deposit.amount > 0);

  return filteredDeposits;
};
