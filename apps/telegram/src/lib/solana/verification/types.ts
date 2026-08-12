import { PublicKey } from "@solana/web3.js";

export type TelegramSessionData = {
  userWallet: PublicKey;
  usernameHash: number[];
  validationBytes: Buffer<ArrayBufferLike>;
  verified: boolean;
  authAt: number;
  verifiedAt: number | null;
};
