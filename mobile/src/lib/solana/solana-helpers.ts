import {
  AnchorProvider,
  BorshInstructionCoder,
  Idl,
  Program,
} from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import telegramPrivateTransferIdl from "../../../../target/idl/telegram_private_transfer.json";
import telegramTransferIdl from "../../../../target/idl/telegram_transfer.json";
import telegramVerificationIdl from "../../../../target/idl/telegram_verification.json";
import type { TelegramVerification } from "../../../../target/types/telegram_verification";
import { SESSION_SEED_BYTES } from "./constants";

export function getTelegramVerificationProgram(
  provider: AnchorProvider,
): Program<TelegramVerification> {
  return new Program(telegramVerificationIdl as TelegramVerification, provider);
}

export function getSessionPda(
  user: PublicKey,
  verificationProgram: Program<TelegramVerification>,
): PublicKey {
  const [sessionPda] = PublicKey.findProgramAddressSync(
    [SESSION_SEED_BYTES, user.toBuffer()],
    verificationProgram.programId,
  );
  return sessionPda;
}

export function decodeTelegramTransferInstruction(data: string) {
  const coder = new BorshInstructionCoder(telegramTransferIdl as Idl);
  const decoded = coder.decode(data, "base58");
  return decoded;
}

export function decodeTelegramPrivateTransferInstruction(data: string) {
  const coder = new BorshInstructionCoder(telegramPrivateTransferIdl as Idl);
  const decoded = coder.decode(data, "base58");
  return decoded;
}

export function decodeTelegramVerificationInstruction(data: string) {
  const coder = new BorshInstructionCoder(telegramVerificationIdl as Idl);
  const decoded = coder.decode(data, "base58");
  return decoded;
}
