import "server-only";

import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { Keypair } from "@solana/web3.js";

import { serverEnv } from "@/lib/core/config/server";

export const getGaslessKeypair = async (): Promise<Keypair> => {
  const privateKey = serverEnv.deploymentPrivateKey;
  return Keypair.fromSecretKey(bs58.decode(privateKey));
};
