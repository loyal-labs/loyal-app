import { AnchorProvider } from "@coral-xyz/anchor";

import type { TelegramDeposit } from "../../../types/deposits";

export const refundDeposit = async (
  _provider: AnchorProvider,
  _username: string,
  _amount: number
): Promise<TelegramDeposit> => {
  throw new Error("Refund not yet supported for private transfers");
};
