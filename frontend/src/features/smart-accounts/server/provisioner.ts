import "server-only";

import type { PublicKey } from "@solana/web3.js";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import { createSponsoredSmartAccount } from "./onchain";

export type SmartAccountProvisionRequest = {
  solanaEnv: SolanaEnv;
  programId: string;
  settingsPda: string;
  treasury: PublicKey;
  walletAddress: string;
};

export interface SmartAccountProvisioner {
  createSmartAccount(input: SmartAccountProvisionRequest): Promise<string>;
}

export function createOnchainSmartAccountProvisioner(): SmartAccountProvisioner {
  return {
    createSmartAccount(input) {
      return createSponsoredSmartAccount(input);
    },
  };
}
