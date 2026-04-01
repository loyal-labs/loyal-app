import { PublicKey } from "@solana/web3.js";

export type TelegramDeposit = {
  user: PublicKey;
  usernameHash: number[];
  amount: number;
  lastNonce: number;
  tokenMint?: PublicKey;
  address?: PublicKey;
};
