import { Keypair } from "@solana/web3.js";

export type WalletKeypairResult = {
  keypair: Keypair;
  isNew: boolean;
};

export type StoredKeypairStrings = {
  publicKey: string;
  secretKey: string;
};
