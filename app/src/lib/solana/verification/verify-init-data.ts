import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";

import type { TelegramVerification } from "../../../../../target/types/telegram_verification";
import { getSessionPda } from "../solana-helpers";

export const verifyInitData = async (
  anchorProvider: AnchorProvider,
  anchorWallet: Wallet,
  user: PublicKey,
  verificationProgram: Program<TelegramVerification>,
  processedInitDataBytes: Uint8Array,
  telegramSignatureBytes: Uint8Array,
  telegramPublicKeyBytes: Uint8Array
): Promise<boolean> => {
  const sessionPda = getSessionPda(user, verificationProgram);
  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: telegramPublicKeyBytes,
    message: processedInitDataBytes,
    signature: telegramSignatureBytes,
  });

  const verifyIx = await verificationProgram.methods
    .verifyTelegramInitData()
    .accounts({
      session: sessionPda,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .instruction();
  const tx = new Transaction().add(ed25519Ix, verifyIx);
  tx.feePayer = user;
  const { blockhash } = await anchorProvider.connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  anchorWallet.signTransaction(tx);

  let threw = false;
  try {
    const sig = await anchorProvider.connection.sendRawTransaction(
      tx.serialize(),
      {
        skipPreflight: false,
      }
    );
    await anchorProvider.connection.confirmTransaction(sig, "confirmed");
  } catch (e) {
    threw = true;
    console.error("Error:", e);
  }
  return !threw;
};
