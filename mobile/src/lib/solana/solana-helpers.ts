import {
  AnchorProvider,
  BorshInstructionCoder,
  Idl,
  Program,
} from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import telegramPrivateTransferIdl from "./idl/telegram_private_transfer.json";
import telegramTransferIdl from "./idl/telegram_transfer.json";
import telegramVerificationIdl from "./idl/telegram_verification.json";
import type { TelegramVerification } from "./idl/telegram_verification";
import { getSessionSeedBytes } from "./constants";

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
    [getSessionSeedBytes(), user.toBuffer()],
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
