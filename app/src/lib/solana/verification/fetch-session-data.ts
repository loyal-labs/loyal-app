import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import type { TelegramVerification } from "../../../../../target/types/telegram_verification";
import { getSessionPda } from "../solana-helpers";
import type { TelegramSessionData } from "./types";

export const fetchSessionData = async (
  verificationProgram: Program<TelegramVerification>,
  user: PublicKey
): Promise<TelegramSessionData> => {
  const sessionPda = getSessionPda(user, verificationProgram);
  const session = await verificationProgram.account.telegramSession.fetch(
    sessionPda
  );
  return {
    userWallet: session.userWallet,
    usernameHash: session.usernameHash,
    validationBytes: session.validationBytes,
    verified: session.verified,
    authAt: session.authAt.toNumber(),
    verifiedAt: session.verifiedAt?.toNumber() ?? null,
  };
};
