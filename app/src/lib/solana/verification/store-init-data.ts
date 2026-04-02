import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Wallet } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import type { TelegramVerification } from "../../../../../target/types/telegram_verification";
import { getSessionPda } from "../solana-helpers";
import { fetchSessionData } from "./fetch-session-data";
import type { TelegramSessionData } from "./types";

export const storeInitData = async (
  provider: AnchorProvider,
  verificationProgram: Program<TelegramVerification>,
  user: PublicKey,
  initData: Uint8Array
): Promise<TelegramSessionData> => {
  const sessionPda = getSessionPda(user, verificationProgram);
  const userPublicKey = provider.wallet.publicKey;

  await verificationProgram.methods
    .store(Buffer.from(initData))
    .accountsPartial({
      payer: userPublicKey,
      user: userPublicKey,
      session: sessionPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: "confirmed" });

  return fetchSessionData(verificationProgram, user);
};

export const storeInitDataGasless = async (
  provider: AnchorProvider,
  verificationProgram: Program<TelegramVerification>,
  payer: PublicKey,
  initData: Uint8Array,
  userWallet: Wallet
): Promise<Transaction> => {
  const userPublicKey = userWallet.publicKey;
  const sessionPda = getSessionPda(userPublicKey, verificationProgram);

  const storeTx = await verificationProgram.methods
    .store(Buffer.from(initData))
    .accountsPartial({
      payer: payer,
      user: userPublicKey,
      session: sessionPda,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash();

  storeTx.feePayer = payer;
  storeTx.recentBlockhash = blockhash;
  storeTx.lastValidBlockHeight = lastValidBlockHeight;

  await userWallet.signTransaction(storeTx);

  return storeTx;
};
